const express  = require('express');
const router   = express.Router();
const path     = require('path');
const fs       = require('fs');
const { randomUUID } = require('crypto');
const { getDb } = require('../database/db');
const { sendCancellationNotification, sendOverrideNotification, sendTestEmail } = require('../services/emailService');

// ── MULTER (logo upload) ──────────────────────────────────────
const multer  = require('multer');
// UPLOADS_DIR can be overridden via env var (e.g. Render persistent disk at /var/data/uploads)
const uploadDir = process.env.UPLOADS_DIR || path.join(__dirname, '../../public/uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const logoStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename:    (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.png';
    cb(null, `logo${ext}`);
  }
});
const logoUpload = multer({
  storage: logoStorage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ['.jpg','.jpeg','.png','.gif','.svg','.webp'];
    cb(null, ok.includes(path.extname(file.originalname).toLowerCase()));
  }
});

const ADMIN_CODE = process.env.ADMIN_CODE || 'Fathima';

// POST /api/admin/login
router.post('/login', (req, res) => {
  const { code } = req.body;
  if (code !== ADMIN_CODE) {
    return res.status(401).json({ success: false, error: 'Invalid access code. Please try again.' });
  }
  const token = Buffer.from(`admin:${Date.now()}:${randomUUID()}`).toString('base64');
  res.json({ success: true, token });
});

function adminAuth(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (!token) return res.status(401).json({ success: false, error: 'Admin authentication required.' });
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf-8');
    if (!decoded.startsWith('admin:')) throw new Error();
    next();
  } catch {
    res.status(401).json({ success: false, error: 'Invalid or expired admin token.' });
  }
}

// GET /api/admin/bookings
router.get('/bookings', adminAuth, (req, res) => {
  const db = getDb();
  const { date, room_id, status, search } = req.query;
  let q = `SELECT b.*, r.name as room_name FROM bookings b JOIN rooms r ON b.room_id = r.id WHERE 1=1`;
  const p = [];
  if (date)    { q += ' AND b.date = ?'; p.push(date); }
  if (room_id) { q += ' AND b.room_id = ?'; p.push(room_id); }
  if (status)  { q += ' AND b.status = ?'; p.push(status); }
  if (search)  {
    q += ' AND (LOWER(b.employee_name) LIKE ? OR LOWER(b.employee_email) LIKE ?)';
    p.push(`%${search.toLowerCase()}%`, `%${search.toLowerCase()}%`);
  }
  q += ' ORDER BY b.date DESC, b.start_time';
  res.json({ success: true, data: db.prepare(q).all(...p) });
});

// PUT /api/admin/bookings/:id/override
router.put('/bookings/:id/override', adminAuth, (req, res) => {
  const db = getDb();
  const { reason } = req.body;
  const existing = db.prepare('SELECT b.*, r.name as room_name FROM bookings b JOIN rooms r ON b.room_id = r.id WHERE b.id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ success: false, error: 'Booking not found.' });

  db.prepare("UPDATE bookings SET status='overridden', notes=?, updated_at=CURRENT_TIMESTAMP WHERE id=?")
    .run(reason || 'Overridden by admin for priority use', req.params.id);

  sendOverrideNotification(existing, reason).catch(e => console.error('Email err:', e));

  db.prepare(`INSERT INTO audit_log (id, action, entity_type, entity_id, details, performed_by) VALUES (?, 'OVERRIDE', 'booking', ?, ?, 'admin')`)
    .run(randomUUID(), req.params.id, JSON.stringify({ reason, employee: existing.employee_email }));

  res.json({ success: true, message: 'Booking overridden successfully.' });
});

// DELETE /api/admin/bookings/:id (admin cancel)
router.delete('/bookings/:id', adminAuth, (req, res) => {
  const db = getDb();
  const { reason } = req.body;
  const existing = db.prepare('SELECT b.*, r.name as room_name FROM bookings b JOIN rooms r ON b.room_id = r.id WHERE b.id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ success: false, error: 'Booking not found.' });

  db.prepare("UPDATE bookings SET status='cancelled', notes=?, updated_at=CURRENT_TIMESTAMP WHERE id=?")
    .run(reason || 'Cancelled by admin', req.params.id);

  sendCancellationNotification(existing, reason || 'Cancelled by admin').catch(e => console.error('Email err:', e));

  db.prepare(`INSERT INTO audit_log (id, action, entity_type, entity_id, details, performed_by) VALUES (?, 'ADMIN_CANCEL', 'booking', ?, ?, 'admin')`)
    .run(randomUUID(), req.params.id, JSON.stringify({ reason }));

  res.json({ success: true, message: 'Booking cancelled.' });
});

// POST /api/admin/blocks
router.post('/blocks', adminAuth, (req, res) => {
  const db = getDb();
  const { room_id, date, start_time, end_time, reason, is_recurring, recurrence_pattern, recurrence_end_date } = req.body;
  if (!room_id || !date || !start_time || !end_time || !reason) {
    return res.status(400).json({ success: false, error: 'Missing required fields.' });
  }
  const id = randomUUID();
  db.prepare(`INSERT INTO admin_blocks (id, room_id, date, start_time, end_time, reason, is_recurring, recurrence_pattern, recurrence_end_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, room_id, date, start_time, end_time, reason, is_recurring ? 1 : 0, recurrence_pattern || null, recurrence_end_date || null);

  db.prepare(`INSERT INTO audit_log (id, action, entity_type, entity_id, details, performed_by) VALUES (?, 'BLOCK', 'room', ?, ?, 'admin')`)
    .run(randomUUID(), id, JSON.stringify({ room_id, date, start_time, end_time, reason }));

  res.status(201).json({ success: true, data: { id, room_id, date, start_time, end_time, reason } });
});

// GET /api/admin/blocks
router.get('/blocks', adminAuth, (req, res) => {
  const db = getDb();
  const { date, room_id } = req.query;
  let q = `SELECT ab.*, r.name as room_name FROM admin_blocks ab JOIN rooms r ON ab.room_id = r.id WHERE 1=1`;
  const p = [];
  if (date)    { q += ' AND ab.date = ?'; p.push(date); }
  if (room_id) { q += ' AND ab.room_id = ?'; p.push(room_id); }
  q += ' ORDER BY ab.date, ab.start_time';
  res.json({ success: true, data: db.prepare(q).all(...p) });
});

// DELETE /api/admin/blocks/:id
router.delete('/blocks/:id', adminAuth, (req, res) => {
  const db = getDb();
  const block = db.prepare('SELECT * FROM admin_blocks WHERE id = ?').get(req.params.id);
  if (!block) return res.status(404).json({ success: false, error: 'Block not found.' });
  db.prepare('DELETE FROM admin_blocks WHERE id = ?').run(req.params.id);
  db.prepare(`INSERT INTO audit_log (id, action, entity_type, entity_id, details, performed_by) VALUES (?, 'UNBLOCK', 'room', ?, ?, 'admin')`)
    .run(randomUUID(), req.params.id, JSON.stringify(block));
  res.json({ success: true, message: 'Block removed.' });
});

// GET /api/admin/settings
router.get('/settings', adminAuth, (req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM admin_settings').all();
  const s = Object.fromEntries(rows.map(r => [r.key, r.value]));
  // Don't expose secrets — return boolean presence instead
  s.smtp_pass      = s.smtp_pass      ? 'set' : '';
  s.resend_api_key = s.resend_api_key ? 'set' : '';
  s.brevo_smtp_key = s.brevo_smtp_key ? 'set' : '';
  res.json({ success: true, data: s });
});

// PUT /api/admin/settings
router.put('/settings', adminAuth, (req, res) => {
  const db = getDb();
  const upsert = db.prepare(`INSERT INTO admin_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP`);
  for (const [k, v] of Object.entries(req.body)) upsert.run(k, String(v));
  db.prepare(`INSERT INTO audit_log (id, action, entity_type, entity_id, details, performed_by) VALUES (?, 'SETTINGS_UPDATE', 'settings', null, ?, 'admin')`)
    .run(randomUUID(), JSON.stringify(Object.keys(req.body)));
  res.json({ success: true, message: 'Settings updated.' });
});

// GET /api/admin/rooms
router.get('/rooms', adminAuth, (req, res) => {
  const db = getDb();
  res.json({ success: true, data: db.prepare('SELECT * FROM rooms').all() });
});

// PUT /api/admin/rooms/:id
router.put('/rooms/:id', adminAuth, (req, res) => {
  const db = getDb();
  const { name, description, capacity, status } = req.body;
  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(req.params.id);
  if (!room) return res.status(404).json({ success: false, error: 'Room not found.' });
  db.prepare('UPDATE rooms SET name=?, description=?, capacity=?, status=? WHERE id=?')
    .run(name || room.name, description ?? room.description, capacity || room.capacity, status || room.status, req.params.id);
  db.prepare(`INSERT INTO audit_log (id, action, entity_type, entity_id, details, performed_by) VALUES (?, 'UPDATE_ROOM', 'room', ?, ?, 'admin')`)
    .run(randomUUID(), req.params.id, JSON.stringify({ name, status }));
  res.json({ success: true, message: 'Room updated.' });
});

// GET /api/admin/analytics
router.get('/analytics', adminAuth, (req, res) => {
  const db = getDb();
  const total     = db.prepare("SELECT COUNT(*) as c FROM bookings WHERE status='confirmed'").get().c;
  const cancelled = db.prepare("SELECT COUNT(*) as c FROM bookings WHERE status='cancelled'").get().c;
  const overridden= db.prepare("SELECT COUNT(*) as c FROM bookings WHERE status='overridden'").get().c;
  const today     = db.prepare("SELECT COUNT(*) as c FROM bookings WHERE date=date('now') AND status='confirmed'").get().c;
  const byRoom    = db.prepare("SELECT room_id, r.name as room_name, COUNT(*) as count FROM bookings b JOIN rooms r ON b.room_id=r.id WHERE b.status='confirmed' GROUP BY room_id").all();
  const byHour    = db.prepare("SELECT SUBSTR(start_time,1,2) as hour, COUNT(*) as count FROM bookings WHERE status='confirmed' GROUP BY hour ORDER BY hour").all();
  const byCategory= db.prepare("SELECT category, COUNT(*) as count FROM bookings WHERE status='confirmed' GROUP BY category").all();
  const byDay     = db.prepare("SELECT strftime('%w', date) as dow, COUNT(*) as count FROM bookings WHERE status='confirmed' GROUP BY dow").all();
  const recent    = db.prepare("SELECT b.*, r.name as room_name FROM bookings b JOIN rooms r ON b.room_id=r.id ORDER BY b.created_at DESC LIMIT 10").all();
  res.json({ success: true, data: { total, cancelled, overridden, today, byRoom, byHour, byCategory, byDay, recent } });
});

// GET /api/admin/audit-log
router.get('/audit-log', adminAuth, (req, res) => {
  const db = getDb();
  res.json({ success: true, data: db.prepare('SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT 200').all() });
});

// POST /api/admin/bookings/recurring
router.post('/bookings/recurring', adminAuth, (req, res) => {
  const db = getDb();
  const { employee_name, employee_email, room_id, start_date, end_date, start_time, duration, purpose, category, recurrence_pattern, notes } = req.body;

  if (!employee_name || !employee_email || !room_id || !start_date || !end_date || !start_time || !duration || !purpose || !recurrence_pattern) {
    return res.status(400).json({ success: false, error: 'All fields required for recurring booking.' });
  }

  const durMins = parseInt(duration);
  const end_time = (() => {
    const [h, m] = start_time.split(':').map(Number);
    const t = h * 60 + m + durMins;
    return `${String(Math.floor(t/60)).padStart(2,'0')}:${String(t%60).padStart(2,'0')}`;
  })();

  const dates = [];
  const cur = new Date(start_date + 'T12:00:00');
  const fin = new Date(end_date + 'T12:00:00');
  while (cur <= fin) {
    const dow = cur.getDay();
    if (recurrence_pattern === 'daily' ||
       (recurrence_pattern === 'weekdays' && dow >= 1 && dow <= 5) ||
       (recurrence_pattern === 'weekly')) {
      dates.push(cur.toISOString().split('T')[0]);
    }
    cur.setDate(cur.getDate() + (recurrence_pattern === 'weekly' ? 7 : 1));
  }

  const ins = db.prepare(`INSERT INTO bookings (id, employee_name, employee_email, room_id, date, start_time, end_time, duration, purpose, category, notes, is_recurring, recurrence_pattern, recurrence_end_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`);
  let created = 0, skipped = [];

  for (const date of dates) {
    const overlap = db.prepare("SELECT id FROM bookings WHERE room_id=? AND date=? AND status='confirmed' AND NOT (end_time<=? OR start_time>=?)").get(room_id, date, start_time, end_time);
    if (!overlap) { ins.run(randomUUID(), employee_name, employee_email.toLowerCase(), room_id, date, start_time, end_time, durMins, purpose, category||'meeting', notes||'', recurrence_pattern, end_date); created++; }
    else skipped.push(date);
  }

  db.prepare(`INSERT INTO audit_log (id, action, entity_type, entity_id, details, performed_by) VALUES (?, 'CREATE_RECURRING', 'booking', null, ?, 'admin')`)
    .run(randomUUID(), JSON.stringify({ employee_name, room_id, created, skipped: skipped.length }));

  res.status(201).json({ success: true, data: { created, skipped: skipped.length, skippedDates: skipped } });
});

// POST /api/admin/upload-logo
router.post('/upload-logo', adminAuth, logoUpload.single('logo'), (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: 'No valid image uploaded. Accepted: JPG, PNG, SVG, GIF, WebP (max 2 MB).' });
  const db = getDb();
  const logoUrl = `/uploads/${req.file.filename}`;
  db.prepare(`INSERT INTO admin_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP`).run('logo_url', logoUrl);
  db.prepare(`INSERT INTO audit_log (id, action, entity_type, entity_id, details, performed_by) VALUES (?, 'LOGO_UPLOAD', 'settings', null, ?, 'admin')`)
    .run(randomUUID(), JSON.stringify({ logo_url: logoUrl }));
  res.json({ success: true, data: { logo_url: logoUrl } });
});

// DELETE /api/admin/logo
router.delete('/logo', adminAuth, (req, res) => {
  const db = getDb();
  const row = db.prepare("SELECT value FROM admin_settings WHERE key='logo_url'").get();
  if (row && row.value) {
    const filePath = path.join(uploadDir, path.basename(row.value));
    try { fs.unlinkSync(filePath); } catch {}
  }
  db.prepare(`INSERT INTO admin_settings (key, value, updated_at) VALUES ('logo_url', '', CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value='', updated_at=CURRENT_TIMESTAMP`).run();
  db.prepare(`INSERT INTO audit_log (id, action, entity_type, entity_id, details, performed_by) VALUES (?, 'LOGO_REMOVE', 'settings', null, '{}', 'admin')`)
    .run(randomUUID());
  res.json({ success: true, message: 'Logo removed.' });
});

// POST /api/admin/test-email
router.post('/test-email', adminAuth, async (req, res) => {
  const { to } = req.body;
  if (!to) return res.status(400).json({ success: false, error: 'Recipient email address is required.' });
  try {
    const result = await sendTestEmail(to);
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
