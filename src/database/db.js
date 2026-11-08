const { Pool } = require('pg');

let pool = null;

function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: /@(localhost|127\.0\.0\.1)[:\/]/.test(process.env.DATABASE_URL || '') ? false : { rejectUnauthorized: false },
      max: 3,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
  }
  return pool;
}

function toPostgres(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

async function all(sql, params = []) {
  const { rows } = await getPool().query(toPostgres(sql), params);
  return rows;
}

async function get(sql, params = []) {
  const rows = await all(sql, params);
  return rows[0] || null;
}

async function run(sql, params = []) {
  await getPool().query(toPostgres(sql), params);
}

async function initializeDatabase() {
  const p = getPool();

  await p.query(`
    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      capacity INTEGER DEFAULT 10,
      status TEXT DEFAULT 'active',
      created_at TIMESTAMPTZ DEFAULT NOW()
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
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
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
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS admin_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      details TEXT,
      performed_by TEXT NOT NULL,
      timestamp TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await p.query("ALTER TABLE bookings ADD COLUMN IF NOT EXISTS attendees TEXT DEFAULT '[]'");

  const { rows: rc } = await p.query('SELECT COUNT(*) as c FROM rooms');
  if (parseInt(rc[0].c) === 0) {
    await run('INSERT INTO rooms (id,name,description,capacity) VALUES (?,?,?,?)',
      ['oak_room', 'قاعة الاجتماعات · Boardroom', 'قاعة الاجتماع الرئيسية، تتسع لـ 12 شخصاً', 12]);
    await run('INSERT INTO rooms (id,name,description,capacity) VALUES (?,?,?,?)',
      ['tree_room', 'غرفة الاجتماعات · Meeting room', 'غرفة اجتماعات صغيرة، تتسع لـ 4 أشخاص', 4]);
  } else {
    // one-time rename of the original English defaults (admin edits are left alone)
    await run("UPDATE rooms SET name=?, description=?, capacity=? WHERE id='oak_room' AND name IN ('Oak Room','غرفة الاجتماعات · Boardroom')",
      ['قاعة الاجتماعات · Boardroom', 'قاعة الاجتماع الرئيسية، تتسع لـ 12 شخصاً', 12]);
    await run("UPDATE rooms SET name=?, description=?, capacity=? WHERE id='tree_room' AND name IN ('Tree Room','غرفة الاجتماعات الصغيرة · Meeting room')",
      ['غرفة الاجتماعات · Meeting room', 'غرفة اجتماعات صغيرة، تتسع لـ 4 أشخاص', 4]);
  }

  const { rows: sc } = await p.query('SELECT COUNT(*) as c FROM admin_settings');
  if (parseInt(sc[0].c) === 0) {
    const defaults = [
      ['office_hours_start', '08:00'], ['office_hours_end', '18:00'],
      ['max_booking_duration', '120'], ['min_booking_duration', '30'],
      ['booking_interval', '30'],     ['company_name', 'Oaktree Group'],
      ['logo_text', 'OG'],            ['email_notifications_enabled', 'false'],
      ['smtp_host', ''],              ['smtp_port', '587'],
      ['smtp_user', ''],              ['smtp_pass', ''],
      ['smtp_from', 'noreply@oaktree.com'],
    ];
    for (const [k, v] of defaults) {
      await run('INSERT INTO admin_settings (key,value) VALUES (?,?) ON CONFLICT (key) DO NOTHING', [k, v]);
    }
  }

  console.log('Database initialized (PostgreSQL / Supabase).');
}

module.exports = { all, get, run, initializeDatabase };
