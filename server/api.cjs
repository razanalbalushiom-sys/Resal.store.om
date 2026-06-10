const express = require('express');
const path = require('path');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const session = require('express-session');
const multer = require('multer');
const bcrypt = require('bcrypt');
const nodemailer = require('nodemailer');

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

  async deleteBy(table, column, value) {
    return this.request('DELETE', `${table}?${column}=eq.${encodeURIComponent(value)}`);
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

function isAdminRole(role) {
  return role === 'admin' || role === 'moderator';
}

function isOrderStaffRole(role) {
  return ['admin', 'moderator', 'employee'].includes(role);
}

function isProductStaffRole(role) {
  return isAdminRole(role) || role === 'employee';
}

// Initialize API
async function initializeAPI() {
  return router;
}

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024, files: 8 },
  fileFilter: (_req, file, cb) => {
    if (!/^image\/(jpe?g|png|webp|gif|avif)$/.test(file.mimetype)) {
      return cb(new Error('Only image files are allowed'));
    }
    cb(null, true);
  }
});

// Rate limiting
function requestIpKey(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = req.ip || forwarded || req.socket?.remoteAddress || '127.0.0.1';
  return rateLimit.ipKeyGenerator(ip);
}

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.API_RATE_LIMIT_MAX || 300),
  keyGenerator: requestIpKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests. Please try again later.' }
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.AUTH_RATE_LIMIT_MAX || 8),
  keyGenerator: requestIpKey,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { success: false, error: 'Too many login attempts. Please try again later.' }
});
const orderLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: Number(process.env.ORDER_RATE_LIMIT_MAX || 30),
  keyGenerator: requestIpKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many orders from this connection. Please try again later.' }
});
router.use(apiLimiter);

// Session middleware
const isProd = process.env.NODE_ENV === 'production';
if (isProd && !process.env.SESSION_SECRET) {
  console.warn('[Security] SESSION_SECRET is not set. Add a strong SESSION_SECRET in Render environment variables.');
}
router.use(session({
  name: 'resal.sid',
  secret: process.env.SESSION_SECRET || 'resal_dev_secret_change_in_prod',
  resave: false,
  saveUninitialized: false,
  proxy: isProd,
  cookie: {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
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

function isRenderableProductImage(src) {
  const value = String(src || '').trim();
  return /^https?:\/\//i.test(value) && !value.includes('/uploads/');
}

function normalizeOrder(row) {
  if (!row) return row;
  const items = typeof row.items === 'string' ? JSON.parse(row.items || '[]') : (row.items || []);
  const statusLabels = {
    new: 'جديد',
    processing: 'قيد التجهيز',
    shipped: 'تم الشحن',
    done: 'مكتمل',
    cancelled: 'ملغي'
  };
  return {
    ...row,
    id: row.order_id || row.id,
    dbId: row.id,
    name: row.customer_name || row.name || '',
    items,
    total: Number(row.total ?? row.total_price ?? 0),
    deliveryCost: Number(row.deliveryCost ?? row.delivery_cost ?? 0),
    vatRate: Number(row.vatRate ?? row.vat_rate ?? 0),
    vatAmount: Number(row.vatAmount ?? row.vat_amount ?? 0),
    statusLabel: statusLabels[row.status] || row.status,
    statusLabel: row.status === 'new' ? 'جديد' : row.status
    , statusLabel: statusLabels[row.status] || row.status
  };
}

function normalizeProduct(row) {
  if (!row) return row;
  const rawImages = typeof row.images === 'string' ? JSON.parse(row.images || '[]') : (row.images || []);
  const images = rawImages.filter(isRenderableProductImage);
  const productDetails = typeof row.product_details === 'string'
    ? JSON.parse(row.product_details || '{}')
    : (row.product_details || {});
  const firstImage = isRenderableProductImage(row.image_url) ? [row.image_url] : [];
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
    productDetails,
    specs: Array.isArray(productDetails.specs) ? productDetails.specs : [],
    boxContents: Array.isArray(productDetails.boxContents) ? productDetails.boxContents : [],
    warranty: productDetails.warranty || '',
    deliveryTime: productDetails.deliveryTime || '',
    images: images.length ? images : firstImage,
    isActive: row.is_active !== false && row.isActive !== false,
    stock: Number(row.stock || 0),
    price: Number(row.price || 0)
  };
}

function parseLines(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map(v => v.trim())
    .filter(Boolean);
}

function buildProductDetails(body) {
  return {
    specs: parseLines(body.specs),
    boxContents: parseLines(body.boxContents),
    warranty: String(body.warranty || '').trim(),
    deliveryTime: String(body.deliveryTime || '').trim()
  };
}

function hasProductDetailsInput(body) {
  return ['specs', 'boxContents', 'warranty', 'deliveryTime'].some(key => Object.prototype.hasOwnProperty.call(body || {}, key));
}

async function getSettingsMap() {
  const rows = await supabase.select('settings', '');
  const settings = {};
  for (const row of rows || []) {
    settings[row.key] = row.value;
  }
  return settings;
}

function orderText(order) {
  const items = (order.items || [])
    .map(item => `${item.name || item.id} x ${item.qty || 1}`)
    .join(', ');
  return [
    `Order: ${order.order_id}`,
    `Customer: ${order.customer_name}`,
    `Phone: ${order.phone}`,
    `Address: ${order.wilayat} / ${order.area}`,
    `Items: ${items}`,
    `Delivery: ${order.delivery}`,
    `Payment: ${order.payment}`,
    `Total: ${order.total}`
  ].join('\n');
}

function cleanPhone(value) {
  const digits = String(value || '').replace(/[^\d]/g, '');
  if (!digits) return '';
  if (digits.startsWith('968')) return digits;
  if (digits.length === 8) return `968${digits}`;
  return digits;
}

function omanLocalPhone(value) {
  const digits = String(value || '').replace(/[^\d]/g, '');
  if (digits.startsWith('968') && digits.length === 11) return digits.slice(3);
  return digits.slice(-8);
}

function staffOrderWhatsAppText(order) {
  const items = (order.items || [])
    .map(item => `${item.name || item.id} × ${item.qty || 1}`)
    .join('، ');
  return [
    `طلب جديد من رسال شوب`,
    `رقم الطلب: ${order.order_id}`,
    `العميل: ${order.customer_name}`,
    `الهاتف: ${order.phone}`,
    `العنوان: ${order.wilayat} / ${order.area}`,
    `المنتجات: ${items}`,
    `الإجمالي: ${order.total} ر.ع`,
    `الحالة: جديد`
  ].join('\n');
}

async function sendWhatsAppText(to, text) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN || process.env.META_WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.META_WHATSAPP_PHONE_NUMBER_ID;
  const templateName = process.env.WHATSAPP_NEW_ORDER_TEMPLATE || process.env.META_WHATSAPP_NEW_ORDER_TEMPLATE;
  const templateLanguage = process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'ar';
  const recipient = cleanPhone(to);
  if (!token || !phoneNumberId || !recipient) return false;
  const payload = templateName
    ? {
        messaging_product: 'whatsapp',
        to: recipient,
        type: 'template',
        template: {
          name: templateName,
          language: { code: templateLanguage }
        }
      }
    : {
        messaging_product: 'whatsapp',
        to: recipient,
        type: 'text',
        text: {
          preview_url: false,
          body: text
        }
      };

  const response = await fetch(`https://graph.facebook.com/v20.0/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`WhatsApp send failed (${response.status}): ${body}`);
  }
  return true;
}

async function notifyStaffWhatsApp(order) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN || process.env.META_WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.META_WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) return false;

  const staff = await supabase.select('users', '?select=*&order=id.asc');
  const recipients = [...new Set((staff || [])
    .filter(user => ['admin', 'moderator', 'employee'].includes(user.role))
    .map(user => cleanPhone(user.phone))
    .filter(Boolean))];
  if (!recipients.length) return false;

  const text = staffOrderWhatsAppText(order);
  const results = await Promise.allSettled(recipients.map(phone => sendWhatsAppText(phone, text)));
  results
    .filter(result => result.status === 'rejected')
    .forEach(result => console.warn('Staff WhatsApp notification failed:', result.reason?.message || result.reason));
  return results.some(result => result.status === 'fulfilled');
}

async function notifyNewOrder(order) {
  let sent = false;
  try {
    const settings = await getSettingsMap();
    if (settings.smtp_host && settings.smtp_user && settings.notifyEmail) {
      const transporter = nodemailer.createTransport({
        host: settings.smtp_host,
        port: Number(settings.smtp_port || 587),
        secure: Number(settings.smtp_port || 587) === 465,
        auth: {
          user: settings.smtp_user,
          pass: settings.smtp_pass || process.env.SMTP_PASS || ''
        }
      });

      await transporter.sendMail({
        from: settings.smtp_from || settings.smtp_user,
        to: settings.notifyEmail,
        subject: `New Resal order ${order.order_id}`,
        text: orderText(order)
      });
      sent = true;
    }
  } catch (error) {
    console.warn('Order email notification failed:', error.message);
  }

  try {
    sent = await notifyStaffWhatsApp(order) || sent;
  } catch (error) {
    console.warn('Order WhatsApp notification failed:', error.message);
  }

  return sent;
}

function isPasswordMatch(password, storedPassword) {
  if (!storedPassword) return false;
  if (storedPassword.startsWith('$2a$') || storedPassword.startsWith('$2b$') || storedPassword.startsWith('$2y$')) {
    return bcrypt.compareSync(password, storedPassword);
  }
  return storedPassword === password;
}

// ============ LOGIN / LOGOUT ============

router.post('/login', authLimiter, async (req, res) => {
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

// ============ STAFF USERS ============

router.get('/users', async (req, res) => {
  try {
    if (!isAdminRole(req.session.userRole)) {
      return res.status(403).json({ success: false, error: 'Admin only' });
    }

    const users = await supabase.select('users', '?select=*&order=id.asc');
    res.json({ success: true, users: users || [] });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/users', async (req, res) => {
  try {
    if (!isAdminRole(req.session.userRole)) {
      return res.status(403).json({ success: false, error: 'Admin only' });
    }

    const email = String(req.body.email || '').trim().toLowerCase();
    const name = String(req.body.name || '').trim();
    const phone = omanLocalPhone(req.body.phone || '');
    const password = String(req.body.password || '');
    const role = ['admin', 'moderator', 'employee'].includes(req.body.role) ? req.body.role : 'employee';

    if (!email || !name || !password) {
      return res.status(400).json({ success: false, error: 'Name, email, and password are required' });
    }
    if (phone && phone.length !== 8) {
      return res.status(400).json({ success: false, error: 'Phone must be an 8-digit Oman number' });
    }

    const existing = await supabase.select('users', `?email=eq.${encodeURIComponent(email)}&select=id`);
    if (existing && existing.length) {
      return res.status(409).json({ success: false, error: 'Email already exists' });
    }

    const passwordHash = bcrypt.hashSync(password, 10);
    const inserted = await supabase.insert('users', {
      email,
      name,
      phone,
      role,
      password: passwordHash
    });
    const user = inserted && inserted[0];
    res.json({
      success: true,
      ok: true,
      user: user ? { id: user.id, email: user.email, name: user.name, phone: user.phone || '', role: user.role, created_at: user.created_at } : null
    });
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put('/users/:id', async (req, res) => {
  try {
    if (!isAdminRole(req.session.userRole)) {
      return res.status(403).json({ success: false, error: 'Admin only' });
    }

    const { id } = req.params;
    const updates = {};
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'name')) {
      updates.name = String(req.body.name || '').trim();
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'phone')) {
      updates.phone = omanLocalPhone(req.body.phone || '');
      if (updates.phone && updates.phone.length !== 8) {
        return res.status(400).json({ success: false, error: 'Phone must be an 8-digit Oman number' });
      }
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'role')) {
      const role = String(req.body.role || '').trim();
      if (['admin', 'moderator', 'employee'].includes(role)) updates.role = role;
    }

    if (!Object.keys(updates).length) {
      return res.status(400).json({ success: false, error: 'No updates provided' });
    }

    const result = await supabase.update('users', id, updates);
    const user = result && result[0];
    res.json({ success: true, ok: true, user });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/users/:id', async (req, res) => {
  try {
    if (!isAdminRole(req.session.userRole)) {
      return res.status(403).json({ success: false, error: 'Admin only' });
    }

    const { id } = req.params;
    if (String(id) === String(req.session.userId)) {
      return res.status(400).json({ success: false, error: 'Cannot delete your own account' });
    }

    const rows = await supabase.select('users', `?id=eq.${encodeURIComponent(id)}&select=id,role`);
    const user = rows && rows[0];
    if (user?.role === 'admin') {
      return res.status(400).json({ success: false, error: 'Cannot delete admin account' });
    }

    await supabase.delete('users', id);
    res.json({ success: true, ok: true });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============ PRODUCTS ============

router.get('/products', async (req, res) => {
  try {
    const category = req.query.category;
    const isStaff = isProductStaffRole(req.session?.userRole);
    const filters = [];
    if (category) {
      filters.push(`category=eq.${encodeURIComponent(category)}`);
    }
    if (!isStaff) filters.push('is_active=eq.true');

    const filter = filters.length ? `?${filters.join('&')}` : '';
    const products = await supabase.select('products', filter);
    res.json({ success: true, products: (products || []).map(normalizeProduct) });
  } catch (error) {
    console.error('Get products error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/products', upload.array('images', 8), async (req, res) => {
  try {
    if (!isProductStaffRole(req.session.userRole)) {
      return res.status(403).json({ success: false, error: 'Product staff only' });
    }

    const { name, description, price, category, cat, stock, oldPrice, emoji, badge, desc, isActive, is_active } = req.body;
    
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
      product_details: buildProductDetails(req.body),
      image_url: images[0] || null,
      images,
      is_active: isActive !== 'false' && is_active !== 'false'
    };

    const result = await supabase.insert('products', product);
    res.json({ success: true, ok: true, product: normalizeProduct(result[0]) });
  } catch (error) {
    console.error('Create product error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put('/products/:id', upload.array('images', 8), async (req, res) => {
  try {
    if (!isProductStaffRole(req.session.userRole)) {
      return res.status(403).json({ success: false, error: 'Product staff only' });
    }

    const { id } = req.params;
    const { name, description, price, category, cat, stock, oldPrice, emoji, badge, desc, isActive, is_active } = req.body;

    const updates = {};
    if (name) updates.name = name;
    if (description) updates.description = description;
    if (desc) updates.desc = desc;
    if (price) updates.price = parseFloat(price);
    if (category || cat) {
      updates.category = category || cat;
      updates.cat = cat || category;
    }
    if (stock !== undefined) updates.stock = parseInt(stock) || 0;
    if (oldPrice !== undefined) updates.oldPrice = oldPrice ? parseFloat(oldPrice) : null;
    if (emoji) updates.emoji = emoji;
    if (badge !== undefined) {
      updates.badge = badge || null;
      updates.badgeType = badge === 'جديد' ? 'badge-new' : badge === 'خصم' ? 'badge-sale' : badge === 'ساخن' ? 'badge-hot' : '';
    }

    if (isActive !== undefined || is_active !== undefined) {
      updates.is_active = isActive !== 'false' && is_active !== 'false';
    }

    if (req.files && req.files.length) {
      const images = await Promise.all(req.files.map(file => saveImageBuffer(file)));
      updates.image_url = images[0];
      updates.images = images;
    }

    if (hasProductDetailsInput(req.body)) {
      updates.product_details = buildProductDetails(req.body);
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
    if (!isAdminRole(req.session.userRole)) {
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

// ============ IMAGE UPLOADS ============

router.post('/uploads/image', upload.single('image'), async (req, res) => {
  try {
    if (!isAdminRole(req.session.userRole)) {
      return res.status(403).json({ success: false, error: 'Admin only' });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'Image file is required' });
    }

    const url = await saveImageBuffer(req.file);
    res.json({ success: true, ok: true, url });
  } catch (error) {
    console.error('Upload image error:', error);
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
    
    let filter = isOrderStaffRole(req.session.userRole)
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

router.post('/orders', orderLimiter, async (req, res) => {
  try {
    const { name, wilayat, area, phone, items, delivery, deliveryCost, vatRate, vatAmount, total, totalPrice, payment } = req.body;

    if (!name || !wilayat || !area || !phone || !items) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }
    const customerPhone = omanLocalPhone(phone);
    if (customerPhone.length !== 8) {
      return res.status(400).json({ success: false, error: 'Phone must be an 8-digit Oman number' });
    }

    const orderItems = Array.isArray(items) ? items : JSON.parse(items || '[]');
    for (const item of orderItems) {
      const productId = item.id;
      const qty = Number(item.qty || 1);
      if (!productId || qty <= 0) continue;
      const rows = await supabase.select('products', `?id=eq.${encodeURIComponent(productId)}`);
      const product = rows && rows[0];
      if (!product) continue;
      const stock = Number(product.stock || 0);
      if (stock > 0 && qty > stock) {
        return res.status(409).json({ success: false, error: `${product.name} is out of stock` });
      }
    }

    const orderId = 'RS-' + Math.floor(Date.now() / 1000);
    const order = {
      user_id: req.session.userId || null,
      order_id: orderId,
      customer_name: name,
      wilayat,
      area,
      phone: customerPhone,
      items: orderItems,
      delivery: delivery || 'without',
      deliveryCost: parseFloat(deliveryCost) || 0,
      vatRate: parseFloat(vatRate) || 0,
      vatAmount: parseFloat(vatAmount) || 0,
      total: parseFloat(total ?? totalPrice) || 0,
      status: 'new',
      payment: payment || 'thawani',
      proof: null
    };

    const result = await supabase.insert('orders', order);
    for (const item of orderItems) {
      const productId = item.id;
      const qty = Number(item.qty || 1);
      if (!productId || qty <= 0) continue;
      const rows = await supabase.select('products', `?id=eq.${encodeURIComponent(productId)}`);
      const product = rows && rows[0];
      if (!product) continue;
      const stock = Number(product.stock || 0);
      if (stock > 0) {
        await supabase.update('products', productId, { stock: Math.max(0, stock - qty) });
      }
    }
    notifyNewOrder(result[0]).catch(error => console.warn('Order notification failed:', error.message));
    res.json({ success: true, ok: true, orderId, order: normalizeOrder(result[0]) });
  } catch (error) {
    console.error('Create order error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/orders/track', async (req, res) => {
  try {
    const orderId = String(req.query.orderId || '').trim();
    const phone = String(req.query.phone || '').replace(/[^\d]/g, '');

    if (!orderId || !phone) {
      return res.status(400).json({ success: false, error: 'Order ID and phone are required' });
    }

    const rows = await supabase.select('orders', `?order_id=eq.${encodeURIComponent(orderId)}`);
    const order = rows && rows[0];
    const orderPhone = String(order?.phone || '').replace(/[^\d]/g, '');

    if (!order || !orderPhone.endsWith(phone.slice(-8))) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    const normalized = normalizeOrder(order);
    res.json({
      success: true,
      order: {
        id: normalized.id,
        name: normalized.name,
        wilayat: normalized.wilayat,
        area: normalized.area,
        items: normalized.items,
        total: normalized.total,
        status: normalized.status,
        statusLabel: normalized.statusLabel,
        delivery: normalized.delivery,
        payment: normalized.payment,
        created_at: normalized.created_at
      }
    });
  } catch (error) {
    console.error('Track order error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put('/orders/:id', async (req, res) => {
  try {
    if (!isOrderStaffRole(req.session.userRole)) {
      return res.status(403).json({ success: false, error: 'Staff only' });
    }

    const { id } = req.params;
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({ success: false, error: 'Status required' });
    }

    const updates = { status };
    const result = String(id).startsWith('RS-')
      ? await supabase.updateBy('orders', 'order_id', id, updates)
      : await supabase.update('orders', id, updates);
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
    if (!isAdminRole(req.session.userRole)) {
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

// ============ BACKUP ============

router.get('/backup', async (req, res) => {
  try {
    if (!isAdminRole(req.session.userRole)) {
      return res.status(403).json({ success: false, error: 'Admin only' });
    }

    const [products, orders, settings, users] = await Promise.all([
      supabase.select('products', '?order=id.asc'),
      supabase.select('orders', '?order=id.desc'),
      supabase.select('settings', '?order=key.asc'),
      supabase.select('users', '?select=*&order=id.asc')
    ]);

    res.setHeader('Content-Disposition', `attachment; filename="resal-backup-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json({
      success: true,
      exportedAt: new Date().toISOString(),
      products: products || [],
      orders: orders || [],
      settings: settings || [],
      users: users || []
    });
  } catch (error) {
    console.error('Backup error:', error);
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
