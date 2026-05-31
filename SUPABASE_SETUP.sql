-- Supabase Database Setup for Resal Store
-- Run these queries in Supabase SQL Editor

-- Users Table
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

-- Products Table
CREATE TABLE IF NOT EXISTS products (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  price DECIMAL(10, 2) NOT NULL,
  category VARCHAR(100),
  image_url VARCHAR(500),
  stock INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);

-- Orders Table
CREATE TABLE IF NOT EXISTS orders (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  order_id VARCHAR(50) UNIQUE,
  customer_name VARCHAR(255),
  wilayat VARCHAR(255),
  area VARCHAR(255),
  phone VARCHAR(50),
  delivery VARCHAR(50),
  "deliveryCost" DECIMAL(10, 2) DEFAULT 0,
  total DECIMAL(10, 2) NOT NULL DEFAULT 0,
  total_price DECIMAL(10, 2),
  status VARCHAR(50) DEFAULT 'new',
  items JSONB,
  payment VARCHAR(50) DEFAULT 'cod',
  proof TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

-- Settings Table
CREATE TABLE IF NOT EXISTS settings (
  id BIGSERIAL PRIMARY KEY,
  key VARCHAR(255) UNIQUE NOT NULL,
  value TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Password Resets Table
CREATE TABLE IF NOT EXISTS password_resets (
  id BIGSERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  token VARCHAR(255) UNIQUE NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_password_resets_token ON password_resets(token);

-- Insert default admin user (password: resal2025)
INSERT INTO users (email, password, name, role) 
VALUES ('admin@resal.om', '$2b$10$IxuLhv/3fu10uhUBf8w2RuvGAB37chGwqZYAKRzOszmVIDxCY.sFK', 'Admin', 'admin')
ON CONFLICT (email) DO NOTHING;

-- If your orders table already exists, run these ALTER statements once.
ALTER TABLE orders ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_user_id_fkey;
ALTER TABLE orders ADD CONSTRAINT orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_id VARCHAR(50) UNIQUE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_name VARCHAR(255);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS wilayat VARCHAR(255);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS area VARCHAR(255);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS phone VARCHAR(50);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery VARCHAR(50);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS "deliveryCost" DECIMAL(10, 2) DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS total DECIMAL(10, 2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS total_price DECIMAL(10, 2);
ALTER TABLE orders ALTER COLUMN total_price DROP NOT NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment VARCHAR(50) DEFAULT 'cod';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS proof TEXT;

-- Sample products
INSERT INTO products (name, description, price, category, stock) VALUES
('منتج 1', 'وصف المنتج الأول', 99.99, 'الفئة 1', 10),
('منتج 2', 'وصف المنتج الثاني', 149.99, 'الفئة 2', 15),
('منتج 3', 'وصف المنتج الثالث', 199.99, 'الفئة 1', 8)
ON CONFLICT DO NOTHING;
