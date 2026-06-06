const postgres = require('postgres');

const host = process.env.SUPABASE_DB_HOST;
const password = process.env.SUPABASE_DB_PASSWORD;

if (!host || !password) {
  console.error('Set SUPABASE_DB_HOST and SUPABASE_DB_PASSWORD before running this script.');
  process.exit(1);
}

const sql = postgres({
  host,
  port: Number(process.env.SUPABASE_DB_PORT || 5432),
  database: process.env.SUPABASE_DB_NAME || 'postgres',
  username: process.env.SUPABASE_DB_USER || 'postgres',
  password,
  ssl: 'require'
});

function isValidImage(src) {
  const value = String(src || '').trim();
  return /^https?:\/\//i.test(value) && !value.includes('/uploads/');
}

(async () => {
  const rows = await sql`
    SELECT id, name, image_url, images
    FROM products
    ORDER BY id ASC
  `;

  let changed = 0;
  for (const row of rows) {
    const currentImages = Array.isArray(row.images)
      ? row.images
      : (typeof row.images === 'string' ? JSON.parse(row.images || '[]') : []);
    const cleanedImages = currentImages.filter(isValidImage);
    const cleanedMain = isValidImage(row.image_url) ? row.image_url : (cleanedImages[0] || null);

    const imagesChanged = JSON.stringify(currentImages) !== JSON.stringify(cleanedImages);
    const mainChanged = (row.image_url || null) !== cleanedMain;
    if (!imagesChanged && !mainChanged) continue;

    await sql`
      UPDATE products
      SET image_url = ${cleanedMain}, images = ${sql.json(cleanedImages)}
      WHERE id = ${row.id}
    `;
    changed++;
    console.log(`Cleaned product ${row.id}: ${row.name}`);
  }

  console.log(`Done. Cleaned ${changed} product(s).`);
  await sql.end();
})().catch(async error => {
  console.error(error.message);
  try { await sql.end(); } catch {}
  process.exit(1);
});
