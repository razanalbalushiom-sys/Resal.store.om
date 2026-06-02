const postgres = require('postgres');

const sql = postgres({
  host: process.env.SUPABASE_DB_HOST,
  port: 5432,
  database: 'postgres',
  username: 'postgres',
  password: process.env.SUPABASE_DB_PASSWORD,
  ssl: 'require'
});

(async () => {
  await sql.unsafe(`
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS "vatRate" DECIMAL(5, 2) DEFAULT 5;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS "vatAmount" DECIMAL(10, 3) DEFAULT 0;
    ALTER TABLE orders ALTER COLUMN payment SET DEFAULT 'thawani';
    INSERT INTO settings (key, value) VALUES ('vatRate', '5') ON CONFLICT (key) DO NOTHING;
  `);
  console.log('VAT fields migration complete.');
  await sql.end();
})().catch(async error => {
  console.error(error.message);
  try { await sql.end(); } catch {}
  process.exit(1);
});
