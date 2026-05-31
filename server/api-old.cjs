'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const session = require('express-session');
const multer = require('multer');
const bcrypt = require('bcrypt');

const router = express.Router();
let db = null;

// Initialize database (will be called from main server)
async function initializeAPI(database) {
  db = database;
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

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session || req.session.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  next();
}

function requireAdminOrMod(req, res, next) {
  if (!req.session || (req.session.role !== 'admin' && req.session.role !== 'moderator')) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

// Auth endpoints
router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Missing credentials' });

  try {
    const user = db.get('SELECT * FROM users WHERE email=?', [email.toLowerCase().trim()]);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    const ok = bcrypt.compareSync(password, user.password);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    req.session.userId = user.id;
    req.session.role = user.role;
    req.session.name = user.name;

    res.json({ ok: true, name: user.name, role: user.role });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// Test
router.get('/test', (req, res) => {
  res.json({
    status: 'ok',
    time: new Date().toISOString(),
    env: process.env.NODE_ENV,
    session: req.session ? { userId: req.session.userId, role: req.session.role } : null
  });
});

// Products
router.get('/products', (req, res) => {
  try {
    const rows = db.all('SELECT * FROM products ORDER BY id DESC');
    rows.forEach(r => { r.images = r.images ? JSON.parse(r.images) : []; });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/products', requireAdminOrMod, upload.array('images', 6), (req, res) => {
  const { name, cat, price, oldPrice, emoji, badge, desc } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });

  try {
    const images = [];
    if (req.files) {
      for (const f of req.files) {
        const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
        const url = saveImageBuffer(f.buffer, filename);
        images.push(url);
      }
    }

    const badgeType = badge === 'جديد' ? 'badge-new' : badge === 'خصم' ? 'badge-sale' : badge === 'ساخن' ? 'badge-hot' : '';
    db.run(
      'INSERT INTO products (name,cat,emoji,price,oldPrice,badge,badgeType,rating,reviews,desc,images) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [name, cat, emoji, parseFloat(price) || 0, oldPrice ? parseFloat(oldPrice) : null, badge || null, badgeType, 5.0, 0, desc, JSON.stringify(images)]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/products/:id', requireAdminOrMod, upload.array('images', 6), (req, res) => {
  const { name, cat, price, oldPrice, emoji, badge, desc } = req.body;
  const id = parseInt(req.params.id);
  
  try {
    const existing = db.get('SELECT * FROM products WHERE id=?', [id]);
    if (!existing) return res.status(404).json({ error: 'Not found' });

    let images = existing.images ? JSON.parse(existing.images) : [];
    if (req.files && req.files.length > 0) {
      images = [];
      for (const f of req.files) {
        const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
        const url = saveImageBuffer(f.buffer, filename);
        images.push(url);
      }
    }

    const badgeType = badge === 'جديد' ? 'badge-new' : badge === 'خصم' ? 'badge-sale' : badge === 'ساخن' ? 'badge-hot' : '';
    db.run(
      'UPDATE products SET name=?,cat=?,emoji=?,price=?,oldPrice=?,badge=?,badgeType=?,desc=?,images=? WHERE id=?',
      [
        name || existing.name, cat || existing.cat, emoji || existing.emoji,
        price ? parseFloat(price) : existing.price,
        oldPrice ? parseFloat(oldPrice) : existing.oldPrice,
        badge !== undefined ? (badge || null) : existing.badge,
        badgeType || existing.badgeType,
        desc !== undefined ? desc : existing.desc,
        JSON.stringify(images), id
      ]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/products/:id', requireAdminOrMod, (req, res) => {
  const id = parseInt(req.params.id);
  try {
    db.run('DELETE FROM products WHERE id=?', [id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Orders
router.post('/orders', (req, res) => {
  const { name, wilayat, area, phone, items, delivery, deliveryCost, total, payment } = req.body;
  if (!name || !wilayat || !area || !phone || !items) return res.status(400).json({ error: 'Missing required fields' });

  try {
    const orderId = 'RS-' + Math.floor(Date.now() / 1000);
    db.run(
      'INSERT INTO orders (order_id,customer_name,wilayat,area,phone,items,delivery,deliveryCost,total,status,payment,proof) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      [orderId, name, wilayat, area, phone, JSON.stringify(items), delivery, deliveryCost || 0, total || 0, 'new', payment || 'cod', null]
    );
    res.json({ ok: true, orderId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/orders', requireAuth, (req, res) => {
  try {
    const rows = db.all('SELECT * FROM orders ORDER BY id DESC');
    rows.forEach(r => { r.items = r.items ? JSON.parse(r.items) : []; });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/orders/:id/status', requireAuth, (req, res) => {
  const { status } = req.body;
  const validStatuses = ['new', 'processing', 'shipped', 'done'];
  if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  try {
    db.run('UPDATE orders SET status=? WHERE id=?', [status, parseInt(req.params.id)]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Settings
router.get('/settings', (req, res) => {
  try {
    const rows = db.all('SELECT key, value FROM settings');
    const settings = {};
    rows.forEach(r => { settings[r.key] = r.value; });
    res.json({
      thawani: {
        enabled: process.env.THAWANI_ENABLED === 'true',
        mode: process.env.THAWANI_MODE || 'test'
      },
      ...settings
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/settings', requireAdmin, (req, res) => {
  const updates = req.body || {};
  try {
    Object.entries(updates).forEach(([k, v]) => {
      db.run('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)', [k, String(v)]);
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Moderators
router.get('/moderators', requireAdmin, (req, res) => {
  try {
    const rows = db.all("SELECT id,email,name,role,created_at FROM users WHERE role != 'admin'");
    res.json(rows || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/moderators', requireAdmin, (req, res) => {
  const { email, name, password, role } = req.body;
  if (!email || !name || !password) return res.status(400).json({ error: 'Missing fields' });
  const validRoles = ['moderator', 'employee'];
  const userRole = validRoles.includes(role) ? role : 'moderator';
  const hash = bcrypt.hashSync(password, 10);
  
  try {
    db.run('INSERT INTO users (email,name,password,role) VALUES (?,?,?,?)',
      [email.toLowerCase(), name, hash, userRole]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: 'Email already exists' });
  }
});

router.delete('/moderators/:id', requireAdmin, (req, res) => {
  try {
    db.run("DELETE FROM users WHERE id=? AND role != 'admin'", [parseInt(req.params.id)]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// File upload
router.post('/uploads', requireAdminOrMod, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const url = saveImageBuffer(req.file.buffer, filename);
  res.json({ url });
});

// Password reset
router.post('/password-reset-request', (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Missing email' });
  
  try {
    const user = db.get('SELECT * FROM users WHERE email=?', [email.toLowerCase()]);
    if (!user) return res.json({ ok: true });
    const token = crypto.randomBytes(20).toString('hex');
    const tokenHash = hashToken(token);
    const expires = Date.now() + 1000 * 60 * 60;
    db.run('INSERT INTO password_resets (user_id,token_hash,expires_at) VALUES (?,?,?)', [user.id, tokenHash, expires]);
    const link = `${req.protocol}://${req.get('host')}/reset-password.html?token=${token}&email=${encodeURIComponent(user.email)}`;
    console.log('[Resal] Password reset link:', link);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/password-reset', (req, res) => {
  const { email, token, password } = req.body;
  if (!email || !token || !password) return res.status(400).json({ error: 'Missing fields' });
  
  try {
    const user = db.get('SELECT * FROM users WHERE email=?', [email.toLowerCase()]);
    if (!user) return res.status(400).json({ error: 'Invalid' });
    const tokenHash = hashToken(token);
    const pr = db.get('SELECT * FROM password_resets WHERE user_id=? AND token_hash=? AND expires_at>?', [user.id, tokenHash, Date.now()]);
    if (!pr) return res.status(400).json({ error: 'Invalid or expired token' });
    const pwdHash = bcrypt.hashSync(password, 10);
    db.run('UPDATE users SET password=? WHERE id=?', [pwdHash, user.id]);
    db.run('DELETE FROM password_resets WHERE id=?', [pr.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = { router, initializeAPI };
