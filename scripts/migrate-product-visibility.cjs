const postgres = require('postgres');

const sql = postgres({
  host: process.env.SUPABASE_DB_HOST,
  port: Number(process.env.SUPABASE_DB_PORT || 5432),
  database: process.env.SUPABASE_DB_NAME || 'postgres',
  username: process.env.SUPABASE_DB_USER || 'postgres',
  password: process.env.SUPABASE_DB_PASSWORD,
  ssl: 'require'
});

async function main() {
  await sql`
    ALTER TABLE products ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true
  `;
  await sql`
    UPDATE products SET is_active = true WHERE is_active IS NULL
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_products_is_active ON products(is_active)
  `;
  await sql.end();
  console.log('Product visibility migration complete.');
}

main().catch(async error => {
  console.error(error);
  await sql.end({ timeout: 1 }).catch(() => {});
  process.exit(1);
});
