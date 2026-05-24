const path = require('path');
const fs   = require('fs');

const DB_PATH = path.join(__dirname, '../../data/oaktree.db');
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

let sqlDb    = null; // sql.js Database instance
let dbWrap   = null; // better-sqlite3-compatible wrapper

// ── PERSIST ───────────────────────────────────────────────────
function save() {
  const data = sqlDb.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

// ── LOW-LEVEL HELPERS ─────────────────────────────────────────
function execAll(sql, params) {
  const stmt = sqlDb.prepare(sql);
  stmt.bind(params || []);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

// ── WRAPPER — mimics better-sqlite3 sync API ──────────────────
function makeWrapper() {
  return {
    prepare(sql) {
      return {
        all(...args) {
          const p = args.flat().filter(a => a !== undefined);
          return execAll(sql, p);
        },
        get(...args) {
          const p = args.flat().filter(a => a !== undefined);
          return execAll(sql, p)[0];
        },
        run(...args) {
          const p = args.flat().filter(a => a !== undefined);
          sqlDb.run(sql, p);
          save();
          return {};
        }
      };
    },
    exec(sql) {
      sqlDb.exec(sql);
      save();
    },
    pragma() {}   // no-op — WAL not needed for sql.js
  };
}

// ── INIT ──────────────────────────────────────────────────────
async function initializeDatabase() {
  if (sqlDb) return;

  const initSqlJs = require('sql.js');
  const wasmPath  = path.join(__dirname, '../../node_modules/sql.js/dist/');

  const SQL = await initSqlJs({ locateFile: f => wasmPath + f });

  if (fs.existsSync(DB_PATH)) {
    sqlDb = new SQL.Database(fs.readFileSync(DB_PATH));
  } else {
    sqlDb = new SQL.Database();
  }

  sqlDb.exec(`
    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      capacity INTEGER DEFAULT 10,
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY,
      employee_name TEXT NOT NULL,
      employee_email TEXT NOT NULL,
      room_id TEXT NOT NULL,
      date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      duration INTEGER NOT NULL,
      purpose TEXT NOT NULL,
      category TEXT DEFAULT 'meeting',
      status TEXT DEFAULT 'confirmed',
      is_recurring INTEGER DEFAULT 0,
      recurrence_pattern TEXT,
      recurrence_end_date TEXT,
      notes TEXT DEFAULT '',
      reminder_sent INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS admin_blocks (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      reason TEXT NOT NULL,
      is_recurring INTEGER DEFAULT 0,
      recurrence_pattern TEXT,
      recurrence_end_date TEXT,
      created_by TEXT DEFAULT 'admin',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS admin_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      details TEXT,
      performed_by TEXT NOT NULL,
      timestamp TEXT DEFAULT (datetime('now'))
    );
  `);

  // Default rooms
  const rc = execAll('SELECT COUNT(*) as c FROM rooms')[0].c;
  if (!rc) {
    sqlDb.run("INSERT INTO rooms (id,name,description,capacity) VALUES (?,?,?,?)",
      ['oak_room','Oak Room','Main conference room with projector, whiteboard, and video conferencing',12]);
    sqlDb.run("INSERT INTO rooms (id,name,description,capacity) VALUES (?,?,?,?)",
      ['tree_room','Tree Room','Smaller meeting room ideal for team huddles and 1:1s',6]);
  }

  // Default settings
  const sc = execAll('SELECT COUNT(*) as c FROM admin_settings')[0].c;
  if (!sc) {
    const defaults = [
      ['office_hours_start','08:00'],['office_hours_end','18:00'],
      ['max_booking_duration','120'],['min_booking_duration','30'],
      ['booking_interval','30'],['company_name','Oaktree Group'],
      ['logo_text','OG'],['email_notifications_enabled','false'],
      ['smtp_host',''],['smtp_port','587'],['smtp_user',''],
      ['smtp_pass',''],['smtp_from','noreply@oaktree.com'],
    ];
    for (const [k,v] of defaults)
      sqlDb.run('INSERT OR IGNORE INTO admin_settings (key,value) VALUES (?,?)',[k,v]);
  }

  save();
  dbWrap = makeWrapper();
  console.log('Database initialized (sql.js).');
}

function getDb() {
  if (!dbWrap) throw new Error('DB not ready — await initializeDatabase() first.');
  return dbWrap;
}

module.exports = { getDb, initializeDatabase };
