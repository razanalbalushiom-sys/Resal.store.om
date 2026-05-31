const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const session = require('express-session');
const multer = require('multer');

const router = express.Router();

// Supabase client using fetch (no SDK dependency)
class SupabaseClient {
  constructor() {
    this.url = process.env.SUPABASE_URL;
    this.key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    if (!this.url || !this.key) {
      console.error('Missing Supabase credentials');
    }
  }

  async request(method, table, options = {}) {
    const url = `${this.url}/rest/v1/${table}`;
    
    const headers = {
      'apikey': this.key,
      'Authorization': `Bearer ${this.key}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    };

    const config = {
      method,
      headers,
      ...options
    };

    if (options.body) {
      config.body = JSON.stringify(options.body);
    }

    try {
      const response = await fetch(url, config);
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.message || 'Supabase request failed');
      }
      
      return data;
    } catch (error) {
      console.error('Supabase error:', error);
      throw error;
    }
  }

  async select(table, filter = '') {
    const url = `${this.url}/rest/v1/${table}${filter}`;
    const headers = {
      'apikey': this.key,
      'Authorization': `Bearer ${this.key}`,
    };

    try {
      const response = await fetch(url, { headers });
      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Supabase select error:', error);
      return [];
    }
  }

  async insert(table, records) {
    return this.request('POST', table, { body: Array.isArray(records) ? records : [records] });
  }

  async update(table, id, updates) {
    return this.request('PATCH', `${table}?id=eq.${id}`, { body: updates });
  }

  async delete(table, id) {
    return this.request('DELETE', `${table}?id=eq.${id}`);
  }
}

const supabase = new SupabaseClient();

// Initialize API
async function initializeAPI() {
  return router;
}

// Upload directory
const UPLOAD_DIR = path.resolve(process.cwd(), process.env.UPLOAD_DIR || 'public/uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.memoryStorage();
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

// Rate limiting
const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 300 });
router.use(apiLimiter);

// Session middleware
const isProd = process.env.NODE_ENV === 'production';
router.use(session({
  secret: process.env.SESSION_SECRET || 'resal_dev_secret_change_in_prod',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
    maxAge: 24 * 60 * 60 * 1000,
  }
}));

// Helpers
function saveImageBuffer(buffer, filename) {
  const filepath = path.join(UPLOAD_DIR, filename);
  fs.writeFileSync(filepath, buffer);
  return '/uploads/' + filename;
}

// ============ LOGIN / LOGOUT ============

router.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password required' });
    }

    // Get user from Supabase
    const users = await supabase.select('users', `?email=eq.${encodeURIComponent(email)}`);

    if (!users || users.length === 0) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    const user = users[0];
    
    // Check password (in production, should be hashed)
    if (user.password !== password) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    // Set session
    req.session.userId = user.id;
    req.session.userEmail = user.email;
    req.session.userRole = user.role;

    res.json({ 
      success: true, 
      user: { 
        id: user.id, 
        email: user.email, 
        name: user.name, 
        role: user.role 
      } 
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/api/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ success: false, error: 'Logout failed' });
    }
    res.json({ success: true });
  });
});

// ============ PRODUCTS ============

router.get('/api/products', async (req, res) => {
  try {
    const category = req.query.category;
    
    let filter = '';
    if (category) {
      filter = `?category=eq.${encodeURIComponent(category)}`;
    }

    const products = await supabase.select('products', filter);
    res.json({ success: true, products: products || [] });
  } catch (error) {
    console.error('Get products error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/api/products', upload.single('image'), async (req, res) => {
  try {
    if (req.session.userRole !== 'admin') {
      return res.status(403).json({ success: false, error: 'Admin only' });
    }

    const { name, description, price, category, stock } = req.body;
    
    if (!name || !price) {
      return res.status(400).json({ success: false, error: 'Name and price required' });
    }

    let imageUrl = null;
    if (req.file) {
      const filename = `product_${Date.now()}_${req.file.originalname}`;
      imageUrl = saveImageBuffer(req.file.buffer, filename);
    }

    const product = {
      name,
      description,
      price: parseFloat(price),
      category,
      stock: parseInt(stock) || 0,
      image_url: imageUrl
    };

    const result = await supabase.insert('products', product);
    res.json({ success: true, product: result[0] });
  } catch (error) {
    console.error('Create product error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put('/api/products/:id', upload.single('image'), async (req, res) => {
  try {
    if (req.session.userRole !== 'admin') {
      return res.status(403).json({ success: false, error: 'Admin only' });
    }

    const { id } = req.params;
    const { name, description, price, category, stock } = req.body;

    const updates = {};
    if (name) updates.name = name;
    if (description) updates.description = description;
    if (price) updates.price = parseFloat(price);
    if (category) updates.category = category;
    if (stock) updates.stock = parseInt(stock);

    if (req.file) {
      const filename = `product_${Date.now()}_${req.file.originalname}`;
      updates.image_url = saveImageBuffer(req.file.buffer, filename);
    }

    const result = await supabase.update('products', id, updates);
    res.json({ success: true, product: result[0] });
  } catch (error) {
    console.error('Update product error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/api/products/:id', async (req, res) => {
  try {
    if (req.session.userRole !== 'admin') {
      return res.status(403).json({ success: false, error: 'Admin only' });
    }

    const { id } = req.params;
    await supabase.delete('products', id);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete product error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============ ORDERS ============

router.get('/api/orders', async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const status = req.query.status;
    
    let filter = `?user_id=eq.${req.session.userId}`;
    if (status) {
      filter += `&status=eq.${encodeURIComponent(status)}`;
    }

    const orders = await supabase.select('orders', filter);
    res.json({ success: true, orders: orders || [] });
  } catch (error) {
    console.error('Get orders error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/api/orders', async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const { items, totalPrice } = req.body;

    if (!items || !totalPrice) {
      return res.status(400).json({ success: false, error: 'Items and totalPrice required' });
    }

    const order = {
      user_id: req.session.userId,
      items,
      total_price: parseFloat(totalPrice),
      status: 'new'
    };

    const result = await supabase.insert('orders', order);
    res.json({ success: true, order: result[0] });
  } catch (error) {
    console.error('Create order error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put('/api/orders/:id', async (req, res) => {
  try {
    if (req.session.userRole !== 'admin') {
      return res.status(403).json({ success: false, error: 'Admin only' });
    }

    const { id } = req.params;
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({ success: false, error: 'Status required' });
    }

    const result = await supabase.update('orders', id, { status });
    res.json({ success: true, order: result[0] });
  } catch (error) {
    console.error('Update order error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============ SETTINGS ============

router.get('/api/settings', async (req, res) => {
  try {
    const settings = await supabase.select('settings', '');
    res.json({ success: true, settings: settings || [] });
  } catch (error) {
    console.error('Get settings error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/api/settings', async (req, res) => {
  try {
    if (req.session.userRole !== 'admin') {
      return res.status(403).json({ success: false, error: 'Admin only' });
    }

    const { key, value } = req.body;

    if (!key) {
      return res.status(400).json({ success: false, error: 'Key required' });
    }

    // Try to update first, if not found, insert
    try {
      const result = await supabase.update('settings', key, { value });
      res.json({ success: true, setting: result[0] });
    } catch {
      const result = await supabase.insert('settings', { key, value });
      res.json({ success: true, setting: result[0] });
    }
  } catch (error) {
    console.error('Upsert setting error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============ TEST ============

router.get('/api/test', (req, res) => {
  res.json({ 
    success: true, 
    message: 'API is working',
    session: req.session,
    supabaseConnected: !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
  });
});

module.exports = { router, initializeAPI };
