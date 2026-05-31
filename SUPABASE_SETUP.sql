-- Supabase Database Setup for Resal Store
-- Run this file in Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  role VARCHAR(50) DEFAULT 'user',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

CREATE TABLE IF NOT EXISTS products (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  price DECIMAL(10, 3) NOT NULL,
  category VARCHAR(100),
  cat VARCHAR(100),
  emoji VARCHAR(32) DEFAULT '📦',
  "oldPrice" DECIMAL(10, 3),
  badge VARCHAR(50),
  "badgeType" VARCHAR(50),
  rating DECIMAL(3, 2) DEFAULT 5,
  reviews INT DEFAULT 0,
  "desc" TEXT,
  images JSONB DEFAULT '[]'::jsonb,
  image_url VARCHAR(500),
  stock INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_cat ON products(cat);

CREATE TABLE IF NOT EXISTS orders (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  order_id VARCHAR(50) UNIQUE,
  customer_name VARCHAR(255),
  wilayat VARCHAR(255),
  area VARCHAR(255),
  phone VARCHAR(50),
  delivery VARCHAR(50),
  "deliveryCost" DECIMAL(10, 3) DEFAULT 0,
  total DECIMAL(10, 3) NOT NULL DEFAULT 0,
  total_price DECIMAL(10, 3),
  status VARCHAR(50) DEFAULT 'new',
  items JSONB DEFAULT '[]'::jsonb,
  payment VARCHAR(50) DEFAULT 'cod',
  proof TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_order_id ON orders(order_id);

CREATE TABLE IF NOT EXISTS settings (
  id BIGSERIAL PRIMARY KEY,
  key VARCHAR(255) UNIQUE NOT NULL,
  value TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS password_resets (
  id BIGSERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  token VARCHAR(255) UNIQUE NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_password_resets_token ON password_resets(token);

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'product-images',
  'product-images',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']
)
ON CONFLICT (id) DO UPDATE
SET public = true,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Existing-project migrations.
ALTER TABLE orders ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_user_id_fkey;
ALTER TABLE orders ADD CONSTRAINT orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_id VARCHAR(50) UNIQUE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_name VARCHAR(255);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS wilayat VARCHAR(255);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS area VARCHAR(255);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS phone VARCHAR(50);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery VARCHAR(50);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS "deliveryCost" DECIMAL(10, 3) DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS total DECIMAL(10, 3) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS total_price DECIMAL(10, 3);
ALTER TABLE orders ALTER COLUMN total_price DROP NOT NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment VARCHAR(50) DEFAULT 'cod';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS proof TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS items JSONB DEFAULT '[]'::jsonb;

ALTER TABLE products ADD COLUMN IF NOT EXISTS cat VARCHAR(100);
ALTER TABLE products ADD COLUMN IF NOT EXISTS emoji VARCHAR(32) DEFAULT '📦';
ALTER TABLE products ADD COLUMN IF NOT EXISTS "oldPrice" DECIMAL(10, 3);
ALTER TABLE products ADD COLUMN IF NOT EXISTS badge VARCHAR(50);
ALTER TABLE products ADD COLUMN IF NOT EXISTS "badgeType" VARCHAR(50);
ALTER TABLE products ADD COLUMN IF NOT EXISTS rating DECIMAL(3, 2) DEFAULT 5;
ALTER TABLE products ADD COLUMN IF NOT EXISTS reviews INT DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS "desc" TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS images JSONB DEFAULT '[]'::jsonb;
ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url VARCHAR(500);
ALTER TABLE products ADD COLUMN IF NOT EXISTS stock INT DEFAULT 0;

-- Default admin: admin@resal.om / resal2025
INSERT INTO users (email, password, name, role)
VALUES ('admin@resal.om', '$2b$10$IxuLhv/3fu10uhUBf8w2RuvGAB37chGwqZYAKRzOszmVIDxCY.sFK', 'Admin', 'admin')
ON CONFLICT (email) DO UPDATE
SET password = EXCLUDED.password,
    name = EXCLUDED.name,
    role = EXCLUDED.role;

INSERT INTO products (name, description, price, category, cat, emoji, "oldPrice", badge, "badgeType", rating, reviews, "desc", images, stock)
SELECT *
FROM (VALUES
  ('سوني WH-1000XM6', 'إلغاء ضوضاء صناعي مع عمر بطارية طويل.', 89.900::decimal, 'headphones', 'headphones', '🎧', 109.900::decimal, 'جديد', 'badge-new', 4.9::decimal, 2341, 'إلغاء ضوضاء صناعي بمستوى لا مثيل له مع 30 ساعة عمر للبطارية.', '[]'::jsonb, 10),
  ('آبل AirPods Pro 2', 'سماعات لاسلكية بإلغاء ضوضاء ووضع شفافية.', 69.900::decimal, 'headphones', 'headphones', '🍎', NULL::decimal, NULL, '', 4.8::decimal, 5423, 'صوت متكيف يمزج بسلاسة بين إلغاء الضوضاء ووضع الشفافية.', '[]'::jsonb, 15),
  ('سامسونج أوديسي G9 49"', 'شاشة ألعاب مقوسة بمعدل تحديث عال.', 499.900::decimal, 'screens', 'screens', '🖥️', 649.900::decimal, 'ساخن', 'badge-hot', 4.7::decimal, 891, 'شاشة ألعاب مقوسة 49 بوصة مع معدل تحديث 240Hz وزمن استجابة 1ms.', '[]'::jsonb, 8)
) AS seed(name, description, price, category, cat, emoji, old_price, badge, badge_type, rating, reviews, product_desc, images, stock)
WHERE NOT EXISTS (SELECT 1 FROM products);
