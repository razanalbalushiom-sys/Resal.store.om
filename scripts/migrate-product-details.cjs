const postgres = require('postgres');

const host = process.env.SUPABASE_DB_HOST;
const password = process.env.SUPABASE_DB_PASSWORD;

if (!host || !password) {
  console.error('Set SUPABASE_DB_HOST and SUPABASE_DB_PASSWORD before running this script.');
  process.exit(1);
}

const sql = postgres({
  host,
  port: 5432,
  database: 'postgres',
  username: 'postgres',
  password,
  ssl: 'require'
});

(async () => {
  await sql.unsafe(`
    ALTER TABLE products ADD COLUMN IF NOT EXISTS product_details JSONB DEFAULT '{}'::jsonb;
    ALTER TABLE products ADD COLUMN IF NOT EXISTS stock INT DEFAULT 0;
    CREATE INDEX IF NOT EXISTS idx_products_stock ON products(stock);
  `);
  console.log('Supabase product details migration complete.');
  await sql.end();
})().catch(async error => {
  console.error(error.message);
  try { await sql.end(); } catch {}
  process.exit(1);
});
