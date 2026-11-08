const express  = require('express');
const router   = express.Router();
const multer   = require('multer');
const { randomUUID } = require('crypto');
const { all, get, run } = require('../database/db');
const { sendCancellationNotification, sendOverrideNotification, sendTestEmail } = require('../services/emailService');

// Logo upload: memory storage → base64 in DB (works on Vercel + any host)
const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ['.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp'];
    const ext = require('path').extname(file.originalname).toLowerCase();
    cb(null, ok.includes(ext));
  }
});

const ADMIN_CODE = process.env.ADMIN_CODE || 'Fathima';

const crypto = require('crypto');
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const sessionSecret = () => process.env.SESSION_SECRET || (ADMIN_CODE + '|' + (process.env.DATABASE_URL || ''));
const sign = payload => crypto.createHmac('sha256', sessionSecret()).update(payload).digest('base64url');

router.post('/login', (req, res) => {
  const { code } = req.body;
  if (code !== ADMIN_CODE) {
    return res.status(401).json({ success: false, error: 'رمز الدخول غير صحيح. حاول مرة أخرى.' });
  }
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + TOKEN_TTL_MS, id: randomUUID() })).toString('base64url');
  res.json({ success: true, token: `${payload}.${sign(payload)}` });
});

function adminAuth(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (!token) return res.status(401).json({ success: false, error: 'يلزم تسجيل دخول الإدارة.' });
  try {
    const [payload, sig] = String(token).split('.');
    const expected = sign(payload);
    if (!sig || sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) throw new Error();
    if (JSON.parse(Buffer.from(payload, 'base64url').toString()).exp < Date.now()) throw new Error();
    next();
  } catch {
    res.status(401).json({ success: false, error: 'انتهت الجلسة أو الرمز غير صالح.' });
  }
}

// GET /api/admin/bookings
router.get('/bookings', adminAuth, async (req, res) => {
  try {
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
    res.json({ success: true, data: await all(q, p) });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// PUT /api/admin/bookings/:id/override
router.put('/bookings/:id/override', adminAuth, async (req, res) => {
  try {
    const { reason } = req.body;
    const existing = await get('SELECT b.*, r.name as room_name FROM bookings b JOIN rooms r ON b.room_id = r.id WHERE b.id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ success: false, error: 'الحجز غير موجود.' });

    await run("UPDATE bookings SET status='overridden', notes=?, updated_at=NOW() WHERE id=?",
      [reason || 'Overridden by admin for priority use', req.params.id]);
    sendOverrideNotification(existing, reason).catch(e => console.error('Email err:', e));

    await run(`INSERT INTO audit_log (id, action, entity_type, entity_id, details, performed_by) VALUES (?, 'OVERRIDE', 'booking', ?, ?, 'admin')`,
      [randomUUID(), req.params.id, JSON.stringify({ reason, employee: existing.employee_email })]);

    res.json({ success: true, message: 'تم إلغاء الحجز بالأولوية.' });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// DELETE /api/admin/bookings/:id
router.delete('/bookings/:id', adminAuth, async (req, res) => {
  try {
    const { reason } = req.body;
    const existing = await get('SELECT b.*, r.name as room_name FROM bookings b JOIN rooms r ON b.room_id = r.id WHERE b.id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ success: false, error: 'الحجز غير موجود.' });

    await run("UPDATE bookings SET status='cancelled', notes=?, updated_at=NOW() WHERE id=?",
      [reason || 'Cancelled by admin', req.params.id]);
    sendCancellationNotification(existing, reason || 'Cancelled by admin').catch(e => console.error('Email err:', e));

    await run(`INSERT INTO audit_log (id, action, entity_type, entity_id, details, performed_by) VALUES (?, 'ADMIN_CANCEL', 'booking', ?, ?, 'admin')`,
      [randomUUID(), req.params.id, JSON.stringify({ reason })]);

    res.json({ success: true, message: 'تم إلغاء الحجز.' });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/admin/blocks
router.post('/blocks', adminAuth, async (req, res) => {
  try {
    const { room_id, date, start_time, end_time, reason, is_recurring, recurrence_pattern, recurrence_end_date } = req.body;
    if (!room_id || !date || !start_time || !end_time || !reason) {
      return res.status(400).json({ success: false, error: 'هناك حقول مطلوبة ناقصة.' });
    }
    const id = randomUUID();
    await run(`INSERT INTO admin_blocks (id, room_id, date, start_time, end_time, reason, is_recurring, recurrence_pattern, recurrence_end_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, room_id, date, start_time, end_time, reason, is_recurring ? 1 : 0, recurrence_pattern || null, recurrence_end_date || null]);
    await run(`INSERT INTO audit_log (id, action, entity_type, entity_id, details, performed_by) VALUES (?, 'BLOCK', 'room', ?, ?, 'admin')`,
      [randomUUID(), id, JSON.stringify({ room_id, date, start_time, end_time, reason })]);

    res.status(201).json({ success: true, data: { id, room_id, date, start_time, end_time, reason } });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/admin/blocks
router.get('/blocks', adminAuth, async (req, res) => {
  try {
    const { date, room_id } = req.query;
    let q = `SELECT ab.*, r.name as room_name FROM admin_blocks ab JOIN rooms r ON ab.room_id = r.id WHERE 1=1`;
    const p = [];
    if (date)    { q += ' AND ab.date = ?'; p.push(date); }
    if (room_id) { q += ' AND ab.room_id = ?'; p.push(room_id); }
    q += ' ORDER BY ab.date, ab.start_time';
    res.json({ success: true, data: await all(q, p) });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// DELETE /api/admin/blocks/:id
router.delete('/blocks/:id', adminAuth, async (req, res) => {
  try {
    const block = await get('SELECT * FROM admin_blocks WHERE id = ?', [req.params.id]);
    if (!block) return res.status(404).json({ success: false, error: 'الحظر غير موجود.' });
    await run('DELETE FROM admin_blocks WHERE id = ?', [req.params.id]);
    await run(`INSERT INTO audit_log (id, action, entity_type, entity_id, details, performed_by) VALUES (?, 'UNBLOCK', 'room', ?, ?, 'admin')`,
      [randomUUID(), req.params.id, JSON.stringify(block)]);
    res.json({ success: true, message: 'تمت إزالة الحظر.' });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/admin/settings
router.get('/settings', adminAuth, async (req, res) => {
  try {
    const rows = await all('SELECT key, value FROM admin_settings');
    const s = Object.fromEntries(rows.map(r => [r.key, r.value]));
    s.smtp_pass      = s.smtp_pass      ? 'set' : '';
    s.resend_api_key = s.resend_api_key ? 'set' : '';
    s.brevo_smtp_key = s.brevo_smtp_key ? 'set' : '';
    res.json({ success: true, data: s });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// PUT /api/admin/settings
router.put('/settings', adminAuth, async (req, res) => {
  try {
    for (const [k, v] of Object.entries(req.body)) {
      await run(`INSERT INTO admin_settings (key, value, updated_at) VALUES (?, ?, NOW())
        ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()`, [k, String(v)]);
    }
    await run(`INSERT INTO audit_log (id, action, entity_type, entity_id, details, performed_by) VALUES (?, 'SETTINGS_UPDATE', 'settings', null, ?, 'admin')`,
      [randomUUID(), JSON.stringify(Object.keys(req.body))]);
    res.json({ success: true, message: 'تم تحديث الإعدادات.' });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/admin/rooms
router.get('/rooms', adminAuth, async (req, res) => {
  try {
    res.json({ success: true, data: await all('SELECT * FROM rooms') });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// PUT /api/admin/rooms/:id
router.put('/rooms/:id', adminAuth, async (req, res) => {
  try {
    const { name, description, capacity, status } = req.body;
    const room = await get('SELECT * FROM rooms WHERE id = ?', [req.params.id]);
    if (!room) return res.status(404).json({ success: false, error: 'الغرفة غير موجودة.' });
    await run('UPDATE rooms SET name=?, description=?, capacity=?, status=? WHERE id=?',
      [name || room.name, description ?? room.description, capacity || room.capacity, status || room.status, req.params.id]);
    await run(`INSERT INTO audit_log (id, action, entity_type, entity_id, details, performed_by) VALUES (?, 'UPDATE_ROOM', 'room', ?, ?, 'admin')`,
      [randomUUID(), req.params.id, JSON.stringify({ name, status })]);
    res.json({ success: true, message: 'تم تحديث الغرفة.' });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/admin/analytics
router.get('/analytics', adminAuth, async (req, res) => {
  try {
    const tz = 'Asia/Riyadh';
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: tz });
    const [totRow, canRow, ovrRow, todRow, byRoom, byHour, byCat, byDay, recent] = await Promise.all([
      get("SELECT COUNT(*) as c FROM bookings WHERE status='confirmed'"),
      get("SELECT COUNT(*) as c FROM bookings WHERE status='cancelled'"),
      get("SELECT COUNT(*) as c FROM bookings WHERE status='overridden'"),
      get("SELECT COUNT(*) as c FROM bookings WHERE date=? AND status='confirmed'", [todayStr]),
      all("SELECT room_id, r.name as room_name, COUNT(*) as count FROM bookings b JOIN rooms r ON b.room_id=r.id WHERE b.status='confirmed' GROUP BY room_id, r.name"),
      all("SELECT SUBSTRING(start_time, 1, 2) as hour, COUNT(*) as count FROM bookings WHERE status='confirmed' GROUP BY hour ORDER BY hour"),
      all("SELECT category, COUNT(*) as count FROM bookings WHERE status='confirmed' GROUP BY category"),
      all("SELECT EXTRACT(DOW FROM date::date)::text as dow, COUNT(*) as count FROM bookings WHERE status='confirmed' GROUP BY dow"),
      all("SELECT b.*, r.name as room_name FROM bookings b JOIN rooms r ON b.room_id=r.id ORDER BY b.created_at DESC LIMIT 10"),
    ]);
    res.json({ success: true, data: {
      total: parseInt(totRow.c), cancelled: parseInt(canRow.c), overridden: parseInt(ovrRow.c),
      today: parseInt(todRow.c), byRoom, byHour, byCategory: byCat, byDay, recent
    }});
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/admin/audit-log
router.get('/audit-log', adminAuth, async (req, res) => {
  try {
    res.json({ success: true, data: await all('SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT 200') });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/admin/bookings/recurring
router.post('/bookings/recurring', adminAuth, async (req, res) => {
  try {
    const { employee_name, employee_email, room_id, start_date, end_date, start_time, duration, purpose, category, recurrence_pattern, notes } = req.body;
    if (!employee_name || !employee_email || !room_id || !start_date || !end_date || !start_time || !duration || !purpose || !recurrence_pattern) {
      return res.status(400).json({ success: false, error: 'جميع الحقول مطلوبة للحجز المتكرر.' });
    }

    const durMins = parseInt(duration);
    const [h, m] = start_time.split(':').map(Number);
    const t = h * 60 + m + durMins;
    const end_time = `${String(Math.floor(t/60)).padStart(2,'0')}:${String(t%60).padStart(2,'0')}`;

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

    let created = 0;
    const skipped = [];
    for (const date of dates) {
      const overlap = await get("SELECT id FROM bookings WHERE room_id=? AND date=? AND status='confirmed' AND NOT (end_time<=? OR start_time>=?)", [room_id, date, start_time, end_time]);
      if (!overlap) {
        await run(`INSERT INTO bookings (id, employee_name, employee_email, room_id, date, start_time, end_time, duration, purpose, category, notes, is_recurring, recurrence_pattern, recurrence_end_date)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
          [randomUUID(), employee_name, employee_email.toLowerCase(), room_id, date, start_time, end_time, durMins, purpose, category || 'meeting', notes || '', recurrence_pattern, end_date]);
        created++;
      } else {
        skipped.push(date);
      }
    }

    await run(`INSERT INTO audit_log (id, action, entity_type, entity_id, details, performed_by) VALUES (?, 'CREATE_RECURRING', 'booking', null, ?, 'admin')`,
      [randomUUID(), JSON.stringify({ employee_name, room_id, created, skipped: skipped.length })]);

    res.status(201).json({ success: true, data: { created, skipped: skipped.length, skippedDates: skipped } });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/admin/upload-logo  — stores as base64 data URI in the DB (no disk needed)
router.post('/upload-logo', adminAuth, logoUpload.single('logo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'لم تُرفع صورة صالحة. المسموح: JPG, PNG, SVG, GIF, WebP (حتى 2 ميجابايت).' });
    const dataUri = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
    await run(`INSERT INTO admin_settings (key, value, updated_at) VALUES ('logo_url', ?, NOW())
      ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()`, [dataUri]);
    await run(`INSERT INTO audit_log (id, action, entity_type, entity_id, details, performed_by) VALUES (?, 'LOGO_UPLOAD', 'settings', null, '{}', 'admin')`,
      [randomUUID()]);
    res.json({ success: true, data: { logo_url: dataUri } });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// DELETE /api/admin/logo
router.delete('/logo', adminAuth, async (req, res) => {
  try {
    await run(`INSERT INTO admin_settings (key, value, updated_at) VALUES ('logo_url', '', NOW())
      ON CONFLICT(key) DO UPDATE SET value='', updated_at=NOW()`);
    await run(`INSERT INTO audit_log (id, action, entity_type, entity_id, details, performed_by) VALUES (?, 'LOGO_REMOVE', 'settings', null, '{}', 'admin')`,
      [randomUUID()]);
    res.json({ success: true, message: 'تم حذف الشعار.' });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/admin/test-email
router.post('/test-email', adminAuth, async (req, res) => {
  const { to } = req.body;
  if (!to) return res.status(400).json({ success: false, error: 'بريد المستلم مطلوب.' });
  try {
    const result = await sendTestEmail(to);
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
