const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

let SQL;
let db;
let dbPath;

async function initDB() {
  SQL = await initSqlJs();
  const DATA_DIR = path.resolve(process.cwd(), 'data');
  fs.mkdirSync(DATA_DIR, { recursive: true });
  dbPath = process.env.DB_FILE || path.join(DATA_DIR, 'resal.db');

  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }
  return { get, all, run, exec, saveDB };
}

function saveDB() {
  if (db && dbPath) {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbPath, buffer);
  }
}

function run(sql, params = []) {
  try {
    db.run(sql, params);
    saveDB();
    return { lastID: null, changes: db.getRowsModified() };
  } catch (err) {
    throw err;
  }
}

function get(sql, params = []) {
  try {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    let result = undefined;
    if (stmt.step()) {
      result = stmt.getAsObject();
    }
    stmt.free();
    return result;
  } catch (err) {
    console.error('[DB] Error in get():', err.message, 'SQL:', sql);
    throw err;
  }
}

function all(sql, params = []) {
  try {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
  } catch (err) {
    console.error('[DB] Error in all():', err.message, 'SQL:', sql);
    throw err;
  }
}

function exec(sql) {
  try {
    const statements = sql.split(';').filter(s => s.trim());
    statements.forEach(stmt => {
      if (stmt.trim()) db.run(stmt);
    });
    saveDB();
  } catch (err) {
    console.error('[DB] Error:', err.message);
    throw err;
  }
}

module.exports = { initDB };
