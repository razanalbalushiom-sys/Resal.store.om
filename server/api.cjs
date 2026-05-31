const express = require('express');
const path = require('path');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const session = require('express-session');
const multer = require('multer');
const bcrypt = require('bcrypt');

const router = express.Router();

// Supabase client using fetch (no SDK dependency)
class SupabaseClient {
  constructor() {
    this.url = process.env.SUPABASE_URL;
    this.key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    this.storageBucket = process.env.SUPABASE_STORAGE_BUCKET || 'product-images';
    this.storageBucketReady = false;
    
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

  async updateBy(table, column, value, updates) {
    return this.request('PATCH', `${table}?${column}=eq.${encodeURIComponent(value)}`, { body: updates });
  }

  async delete(table, id) {
    return this.request('DELETE', `${table}?id=eq.${id}`);
  }

  async ensureStorageBucket() {
    if (this.storageBucketReady) return;
    const response = await fetch(`${this.url}/storage/v1/bucket`, {
      method: 'POST',
      headers: {
        'apikey': this.key,
        'Authorization': `Bearer ${this.key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        id: this.storageBucket,
        name: this.storageBucket,
        public: true,
        file_size_limit: 5242880,
        allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']
      })
    });

    if (!response.ok) {
      const text = await response.text();
      if (response.status !== 409 && !text.toLowerCase().includes('already')) {
        throw new Error(`Storage bucket setup failed: ${text}`);
      }
    }

    this.storageBucketReady = true;
  }

  async uploadImage(buffer, filename, contentType = 'application/octet-stream') {
    await this.ensureStorageBucket();
    const response = await fetch(`${this.url}/storage/v1/object/${this.storageBucket}/${filename}`, {
      method: 'POST',
      headers: {
        'apikey': this.key,
        'Authorization': `Bearer ${this.key}`,
        'Content-Type': contentType,
        'x-upsert': 'true'
      },
      body: buffer
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Image upload failed: ${text}`);
    }

    return `${this.url}/storage/v1/object/public/${this.storageBucket}/${filename}`;
  }
}

const supabase = new SupabaseClient();

// Initialize API
async function initializeAPI() {
  return router;
}

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
function safeUploadName(originalName = 'image') {
  const ext = path.extname(originalName).toLowerCase().replace(/[^a-z0-9.]/g, '') || '.jpg';
  return `products/${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
}

async function saveImageBuffer(file) {
  return supabase.uploadImage(file.buffer, safeUploadName(file.originalname), file.mimetype);
}

function normalizeOrder(row) {
  if (!row) return row;
  const items = typeof row.items === 'string' ? JSON.parse(row.items || '[]') : (row.items || []);
  return {
    ...row,
    id: row.order_id || row.id,
    name: row.customer_name || row.name || '',
    items,
    total: Number(row.total ?? row.total_price ?? 0),
    deliveryCost: Number(row.deliveryCost ?? row.delivery_cost ?? 0),
    statusLabel: row.status === 'new' ? 'جديد' : row.status
  };
}

function normalizeProduct(row) {
  if (!row) return row;
  const images = typeof row.images === 'string' ? JSON.parse(row.images || '[]') : (row.images || []);
  const firstImage = row.image_url ? [row.image_url] : [];
  return {
    ...row,
    cat: row.cat || row.category || '',
    category: row.category || row.cat || '',
    emoji: row.emoji || '📦',
    oldPrice: row.oldPrice == null ? null : Number(row.oldPrice),
    badgeType: row.badgeType || '',
    rating: Number(row.rating || 5),
    reviews: Number(row.reviews || 0),
    desc: row.desc || row.description || '',
    images: images.length ? images : firstImage,
    price: Number(row.price || 0)
  };
}

function isPasswordMatch(password, storedPassword) {
  if (!storedPassword) return false;
  if (storedPassword.startsWith('$2a$') || storedPassword.startsWith('$2b$') || storedPassword.startsWith('$2y$')) {
    return bcrypt.compareSync(password, storedPassword);
  }
  return storedPassword === password;
}

// ============ LOGIN / LOGOUT ============

router.post('/login', async (req, res) => {
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
    
    if (!isPasswordMatch(password, user.password)) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    // Set session
    req.session.userId = user.id;
    req.session.userEmail = user.email;
    req.session.userRole = user.role;

    res.json({ 
      success: true, 
      ok: true,
      name: user.name,
      role: user.role,
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

router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ success: false, error: 'Logout failed' });
    }
    res.json({ success: true });
  });
});

// ============ PRODUCTS ============

router.get('/products', async (req, res) => {
  try {
    const category = req.query.category;
    
    let filter = '';
    if (category) {
      filter = `?category=eq.${encodeURIComponent(category)}`;
    }

    const products = await supabase.select('products', filter);
    res.json({ success: true, products: (products || []).map(normalizeProduct) });
  } catch (error) {
    console.error('Get products error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/products', upload.any(), async (req, res) => {
  try {
    if (req.session.userRole !== 'admin') {
      return res.status(403).json({ success: false, error: 'Admin only' });
    }

    const { name, description, price, category, cat, stock, oldPrice, emoji, badge, desc } = req.body;
    
    if (!name || !price) {
      return res.status(400).json({ success: false, error: 'Name and price required' });
    }

    const images = [];
    for (const file of req.files || []) {
      images.push(await saveImageBuffer(file));
    }

    const product = {
      name,
      description: description || desc || '',
      price: parseFloat(price),
      category: category || cat || '',
      cat: cat || category || '',
      emoji: emoji || '📦',
      oldPrice: oldPrice ? parseFloat(oldPrice) : null,
      badge: badge || null,
      badgeType: badge === 'جديد' ? 'badge-new' : badge === 'خصم' ? 'badge-sale' : badge === 'ساخن' ? 'badge-hot' : '',
      rating: 5,
      reviews: 0,
      desc: desc || description || '',
      stock: parseInt(stock) || 0,
      image_url: images[0] || null,
      images
    };

    const result = await supabase.insert('products', product);
    res.json({ success: true, ok: true, product: normalizeProduct(result[0]) });
  } catch (error) {
    console.error('Create product error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put('/products/:id', upload.any(), async (req, res) => {
  try {
    if (req.session.userRole !== 'admin') {
      return res.status(403).json({ success: false, error: 'Admin only' });
    }

    const { id } = req.params;
    const { name, description, price, category, cat, stock, oldPrice, emoji, badge, desc } = req.body;

    const updates = {};
    if (name) updates.name = name;
    if (description) updates.description = description;
    if (desc) updates.desc = desc;
    if (price) updates.price = parseFloat(price);
    if (category || cat) {
      updates.category = category || cat;
      updates.cat = cat || category;
    }
    if (stock) updates.stock = parseInt(stock);
    if (oldPrice !== undefined) updates.oldPrice = oldPrice ? parseFloat(oldPrice) : null;
    if (emoji) updates.emoji = emoji;
    if (badge !== undefined) {
      updates.badge = badge || null;
      updates.badgeType = badge === 'جديد' ? 'badge-new' : badge === 'خصم' ? 'badge-sale' : badge === 'ساخن' ? 'badge-hot' : '';
    }

    if (req.files && req.files.length) {
      const images = await Promise.all(req.files.map(file => saveImageBuffer(file)));
      updates.image_url = images[0];
      updates.images = images;
    }

    const result = await supabase.update('products', id, updates);
    res.json({ success: true, ok: true, product: normalizeProduct(result[0]) });
  } catch (error) {
    console.error('Update product error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/products/:id', async (req, res) => {
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

router.get('/orders', async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const status = req.query.status;
    
    let filter = req.session.userRole === 'admin' || req.session.userRole === 'moderator'
      ? '?order=id.desc'
      : `?user_id=eq.${req.session.userId}&order=id.desc`;
    if (status) {
      filter += `&status=eq.${encodeURIComponent(status)}`;
    }

    const orders = await supabase.select('orders', filter);
    res.json({ success: true, orders: (orders || []).map(normalizeOrder) });
  } catch (error) {
    console.error('Get orders error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/orders', async (req, res) => {
  try {
    const { name, wilayat, area, phone, items, delivery, deliveryCost, total, totalPrice, payment } = req.body;

    if (!name || !wilayat || !area || !phone || !items) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }

    const orderId = 'RS-' + Math.floor(Date.now() / 1000);
    const order = {
      user_id: req.session.userId || null,
      order_id: orderId,
      customer_name: name,
      wilayat,
      area,
      phone,
      items,
      delivery: delivery || 'without',
      deliveryCost: parseFloat(deliveryCost) || 0,
      total: parseFloat(total ?? totalPrice) || 0,
      status: 'new',
      payment: payment || 'cod',
      proof: null
    };

    const result = await supabase.insert('orders', order);
    res.json({ success: true, ok: true, orderId, order: normalizeOrder(result[0]) });
  } catch (error) {
    console.error('Create order error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put('/orders/:id', async (req, res) => {
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

router.get('/settings', async (req, res) => {
  try {
    const rows = await supabase.select('settings', '');
    const settings = {};
    for (const row of rows || []) {
      settings[row.key] = row.value;
    }
    res.json({ success: true, settings, rows: rows || [] });
  } catch (error) {
    console.error('Get settings error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/settings', async (req, res) => {
  try {
    if (req.session.userRole !== 'admin') {
      return res.status(403).json({ success: false, error: 'Admin only' });
    }

    const updates = req.body || {};
    const saved = {};

    for (const [key, rawValue] of Object.entries(updates)) {
      if (!key) continue;
      const value = rawValue == null ? '' : String(rawValue);
      const updated = await supabase.updateBy('settings', 'key', key, { value });
      if (updated && updated.length) {
        saved[key] = updated[0].value;
      } else {
        const inserted = await supabase.insert('settings', { key, value });
        saved[key] = inserted[0]?.value ?? value;
      }
    }

    res.json({ success: true, ok: true, settings: saved });
  } catch (error) {
    console.error('Upsert setting error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============ TEST ============

router.get('/test', (req, res) => {
  res.json({ 
    success: true, 
    message: 'API is working',
    session: req.session,
    supabaseConnected: !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
  });
});

module.exports = { router, initializeAPI };
