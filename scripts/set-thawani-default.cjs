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
  await sql.unsafe("ALTER TABLE orders ALTER COLUMN payment SET DEFAULT 'thawani';");
  console.log('orders payment default set to thawani');
  await sql.end();
})().catch(async error => {
  console.error(error.message);
  try { await sql.end(); } catch {}
  process.exit(1);
});
