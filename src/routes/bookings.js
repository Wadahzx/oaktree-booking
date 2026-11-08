const express = require('express');
const router = express.Router();
const { randomUUID } = require('crypto');
const { all, get, run } = require('../database/db');
const { sendBookingConfirmation, sendMeetingInvitations, sendCancellationNotification, sendLoginCode } = require('../services/emailService');
const { issueUserToken, userEmail, isAdmin, hashCode, newCode, sameHash } = require('../services/userAuth');
const { getDaySchedule } = require('../services/schedule');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Clean the invitee list: valid unique emails, organizer excluded.
// Returns { list } or { error } when an address is malformed.
function normalizeAttendees(raw, organizerEmail) {
  const seen = new Set([String(organizerEmail || '').trim().toLowerCase()]);
  const list = [];
  for (const a of Array.isArray(raw) ? raw : []) {
    const email = String((a && a.email) || '').trim().toLowerCase();
    if (!email) continue;
    if (!EMAIL_RE.test(email)) return { error: `البريد الإلكتروني للمدعو غير صالح: ${email}` };
    if (seen.has(email)) continue;
    seen.add(email);
    list.push({ name: String((a && a.name) || '').trim().slice(0, 100), email });
  }
  return { list };
}

function calcEndTime(startTime, durationMins) {
  const [h, m] = startTime.split(':').map(Number);
  const total = h * 60 + m + parseInt(durationMins);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

const TZ = 'Asia/Riyadh';
function nowInRiyadh() {
  const d = new Date();
  return new Date(d.toLocaleString('en-US', { timeZone: TZ }));
}

const NEED_AUTH = { success: false, need_auth: true, error: 'يلزم التحقق من بريدك الإلكتروني أولاً.' };

// Hide private fields from anyone who is not the booking owner or an admin
function scrub(rows, req) {
  const me = userEmail(req), admin = isAdmin(req);
  const clean = b => {
    if (admin || (me && String(b.employee_email).toLowerCase() === me)) return b;
    const { employee_email, notes, attendees, ...rest } = b;
    return rest;
  };
  return Array.isArray(rows) ? rows.map(clean) : clean(rows);
}

// POST /api/bookings/auth/request  { email }  - emails a 6 digit code
router.post('/auth/request', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return res.status(400).json({ success: false, error: 'يرجى إدخال بريد إلكتروني صحيح.' });
    const recent = await get("SELECT COUNT(*) AS c FROM email_codes WHERE email = ? AND created_at > NOW() - INTERVAL '60 seconds'", [email]);
    if (parseInt(recent.c) > 0) return res.status(429).json({ success: false, error: 'تم إرسال رمز قبل قليل. انتظر دقيقة ثم حاول مرة أخرى.' });
    const hour = await get("SELECT COUNT(*) AS c FROM email_codes WHERE email = ? AND created_at > NOW() - INTERVAL '1 hour'", [email]);
    if (parseInt(hour.c) >= 5) return res.status(429).json({ success: false, error: 'تجاوزت عدد المحاولات المسموح. حاول بعد ساعة.' });
    const code = newCode();
    await run("DELETE FROM email_codes WHERE expires_at < NOW()");
    await run("INSERT INTO email_codes (id, email, code_hash, expires_at) VALUES (?, ?, ?, NOW() + INTERVAL '10 minutes')", [randomUUID(), email, hashCode(email, code)]);
    await sendLoginCode(email, code);
    res.json({ success: true, message: 'أرسلنا رمز التحقق إلى بريدك الإلكتروني.' });
  } catch (e) {
    console.error('Login code error:', e);
    res.status(500).json({ success: false, error: 'تعذّر إرسال الرمز، حاول مرة أخرى.' });
  }
});

// POST /api/bookings/auth/verify  { email, code }  - returns a session token
router.post('/auth/verify', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const code  = String(req.body.code || '').trim();
    const row = await get('SELECT * FROM email_codes WHERE email = ? AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1', [email]);
    if (!row) return res.status(400).json({ success: false, error: 'انتهت صلاحية الرمز. اطلب رمزاً جديداً.' });
    if (row.attempts >= 5) {
      await run('DELETE FROM email_codes WHERE email = ?', [email]);
      return res.status(429).json({ success: false, error: 'محاولات كثيرة خاطئة. اطلب رمزاً جديداً.' });
    }
    if (!/^\d{6}$/.test(code) || !sameHash(row.code_hash, hashCode(email, code))) {
      await run('UPDATE email_codes SET attempts = attempts + 1 WHERE id = ?', [row.id]);
      return res.status(400).json({ success: false, error: 'الرمز غير صحيح.' });
    }
    await run('DELETE FROM email_codes WHERE email = ?', [email]);
    const { token, exp } = issueUserToken(email);
    res.json({ success: true, token, email, expires: exp });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/bookings
router.get('/', async (req, res) => {
  try {
    const { email, date, room_id, status, upcoming } = req.query;
    if (email && !isAdmin(req) && userEmail(req) !== String(email).trim().toLowerCase()) return res.status(401).json(NEED_AUTH);
    let query = `SELECT b.*, r.name as room_name FROM bookings b JOIN rooms r ON b.room_id = r.id WHERE 1=1`;
    const params = [];

    if (email)    { query += ' AND LOWER(b.employee_email) = LOWER(?)'; params.push(email); }
    if (date)     { query += ' AND b.date = ?'; params.push(date); }
    if (room_id)  { query += ' AND b.room_id = ?'; params.push(room_id); }
    if (status)   { query += ' AND b.status = ?'; params.push(status); }
    if (upcoming === 'true') {
      const now = nowInRiyadh();
      const todayStr = now.toLocaleDateString('en-CA');
      const timeStr  = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
      query += ` AND (b.date > ? OR (b.date = ? AND b.start_time >= ?))`;
      params.push(todayStr, todayStr, timeStr);
    }

    query += ' ORDER BY b.date, b.start_time';
    const bookings = await all(query, params);
    res.json({ success: true, data: scrub(bookings, req) });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/bookings/people  - names + emails seen before (for the invitee picker; no booking details)
router.get('/people', async (req, res) => {
  try {
    const rows = await all('SELECT employee_name, employee_email, attendees FROM bookings ORDER BY created_at DESC LIMIT 1000');
    const map = new Map();
    const add = (name, email) => {
      email = String(email || '').trim().toLowerCase();
      if (!email) return;
      const cur = map.get(email);
      if (!cur || (!cur.name && name)) map.set(email, { name: name || '', email });
    };
    for (const r of rows) {
      add(r.employee_name, r.employee_email);
      try { for (const a of JSON.parse(r.attendees || '[]')) add(a.name, a.email); } catch { /* ignore */ }
    }
    res.json({ success: true, data: [...map.values()].sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email)) });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/bookings/:id
router.get('/:id', async (req, res) => {
  try {
    const b = await get('SELECT b.*, r.name as room_name FROM bookings b JOIN rooms r ON b.room_id = r.id WHERE b.id = ?', [req.params.id]);
    if (!b) return res.status(404).json({ success: false, error: 'الحجز غير موجود' });
    res.json({ success: true, data: scrub(b, req) });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/bookings
router.post('/', async (req, res) => {
  try {
    const { employee_name, employee_email, room_id, date, start_time, duration, purpose, category, notes } = req.body;

    if (!employee_name || !employee_email || !room_id || !date || !start_time || !duration || !purpose) {
      return res.status(400).json({ success: false, error: 'يرجى تعبئة جميع الحقول المطلوبة.' });
    }
    if (!EMAIL_RE.test(employee_email)) {
      return res.status(400).json({ success: false, error: 'يرجى إدخال بريد إلكتروني صحيح.' });
    }
    const att = normalizeAttendees(req.body.attendees, employee_email);
    if (att.error) return res.status(400).json({ success: false, error: att.error });

    const cfgRows = await all('SELECT key, value FROM admin_settings');
    const cfg = Object.fromEntries(cfgRows.map(r => [r.key, r.value]));
    const officeStart = cfg.office_hours_start || '08:00';
    const officeEnd   = cfg.office_hours_end   || '18:00';
    const maxDur      = parseInt(cfg.max_booking_duration || '120');
    const minDur      = parseInt(cfg.min_booking_duration || '30');
    const durMins     = parseInt(duration);

    if (durMins < minDur || durMins > maxDur) {
      return res.status(400).json({ success: false, error: `يجب أن تكون المدة بين ${minDur} و ${maxDur} دقيقة.` });
    }

    const end_time = calcEndTime(start_time, durMins);
    if (start_time < officeStart || end_time > officeEnd) {
      return res.status(400).json({ success: false, error: `يجب أن يكون الحجز ضمن ساعات العمل من ${officeStart} إلى ${officeEnd}.` });
    }

    const slotDT = new Date(`${date}T${start_time}:00`);
    if (slotDT <= nowInRiyadh()) {
      return res.status(400).json({ success: false, error: 'لا يمكن الحجز في وقت مضى.' });
    }

    const room = await get("SELECT * FROM rooms WHERE id = ? AND status = 'active'", [room_id]);
    if (!room) return res.status(400).json({ success: false, error: 'القاعة غير موجودة أو غير متاحة.' });

    if (att.list.length + 1 > room.capacity) {
      return res.status(400).json({ success: false, error: `سعة ${room.name} هي ${room.capacity} أشخاص، وعدد المشاركين (مع المنظم) ${att.list.length + 1}.` });
    }

    // Conflict: tell the user who has the room and what is free instead
    const overlap = await get(`
      SELECT start_time, end_time, purpose, employee_name FROM bookings
      WHERE room_id = ? AND date = ? AND status = 'confirmed'
      AND NOT (end_time <= ? OR start_time >= ?)
    `, [room_id, date, start_time, end_time]);
    const blocked = overlap ? null : await get(`
      SELECT start_time, end_time, reason FROM admin_blocks WHERE room_id = ? AND date = ?
      AND NOT (end_time <= ? OR start_time >= ?)
    `, [room_id, date, start_time, end_time]);
    if (overlap || blocked) {
      return res.status(409).json({
        success: false,
        error: overlap
          ? 'هذا الوقت محجوز مسبقاً. اختر وقتاً من الأوقات المتاحة أدناه.'
          : 'هذا الوقت محجوب من قبل الإدارة. اختر وقتاً من الأوقات المتاحة أدناه.',
        conflict: overlap
          ? { type: 'booking', start_time: overlap.start_time, end_time: overlap.end_time, purpose: overlap.purpose, employee_name: overlap.employee_name }
          : { type: 'block', start_time: blocked.start_time, end_time: blocked.end_time, reason: blocked.reason },
        schedule: await getDaySchedule(date, durMins)
      });
    }

    const id = randomUUID();
    await run(`
      INSERT INTO bookings (id, employee_name, employee_email, room_id, date, start_time, end_time, duration, purpose, category, notes, attendees)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [id, employee_name.trim(), employee_email.trim().toLowerCase(), room_id, date, start_time, end_time, durMins, purpose.trim(), category || 'meeting', notes || '', JSON.stringify(att.list)]);

    const booking = await get('SELECT b.*, r.name as room_name FROM bookings b JOIN rooms r ON b.room_id = r.id WHERE b.id = ?', [id]);
    sendBookingConfirmation(booking).catch(e => console.error('Email err:', e));
    sendMeetingInvitations(booking).catch(e => console.error('Invite err:', e));

    await run(`INSERT INTO audit_log (id, action, entity_type, entity_id, details, performed_by) VALUES (?, 'CREATE', 'booking', ?, ?, ?)`,
      [randomUUID(), id, JSON.stringify({ employee_name, room_id, date, start_time, end_time, attendees: att.list.length }), employee_email.toLowerCase()]);

    res.status(201).json({ success: true, data: booking });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// PUT /api/bookings/:id
router.put('/:id', async (req, res) => {
  try {
    const { employee_email, date, start_time, duration, purpose, category, notes } = req.body;

    const existing = await get('SELECT * FROM bookings WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ success: false, error: 'الحجز غير موجود.' });
    if (!isAdmin(req) && userEmail(req) !== existing.employee_email.toLowerCase()) {
      return res.status(userEmail(req) ? 403 : 401).json(userEmail(req) ? { success: false, error: 'يمكنك تعديل حجوزاتك فقط.' } : NEED_AUTH);
    }
    if (existing.status !== 'confirmed') {
      return res.status(400).json({ success: false, error: 'لا يمكن تعديل حجز ملغي.' });
    }

    const cfgRows = await all('SELECT key, value FROM admin_settings');
    const cfg = Object.fromEntries(cfgRows.map(r => [r.key, r.value]));
    const newDate  = date       || existing.date;
    const newStart = start_time || existing.start_time;
    const newDur   = duration   ? parseInt(duration) : existing.duration;
    const newEnd   = calcEndTime(newStart, newDur);

    if (new Date(`${newDate}T${newStart}:00`) <= nowInRiyadh()) {
      return res.status(400).json({ success: false, error: 'لا يمكن نقل الحجز إلى وقت مضى.' });
    }
    const officeStart = cfg.office_hours_start || '08:00';
    const officeEnd   = cfg.office_hours_end   || '18:00';
    if (newStart < officeStart || newEnd > officeEnd) {
      return res.status(400).json({ success: false, error: `يجب أن يكون الحجز ضمن ساعات العمل من ${officeStart} إلى ${officeEnd}.` });
    }

    const overlap = await get(`
      SELECT id FROM bookings WHERE room_id = ? AND date = ? AND status = 'confirmed' AND id != ?
      AND NOT (end_time <= ? OR start_time >= ?)
    `, [existing.room_id, newDate, req.params.id, newStart, newEnd]);
    if (overlap) return res.status(409).json({ success: false, error: 'هذا الوقت محجوز مسبقاً.' });

    let attendeesJson = existing.attendees || '[]';
    if (Array.isArray(req.body.attendees)) {
      const att = normalizeAttendees(req.body.attendees, existing.employee_email);
      if (att.error) return res.status(400).json({ success: false, error: att.error });
      const room = await get('SELECT capacity, name FROM rooms WHERE id = ?', [existing.room_id]);
      if (room && att.list.length + 1 > room.capacity) {
        return res.status(400).json({ success: false, error: `سعة ${room.name} هي ${room.capacity} أشخاص.` });
      }
      attendeesJson = JSON.stringify(att.list);
    }

    await run(`
      UPDATE bookings SET date=?, start_time=?, end_time=?, duration=?, purpose=?, category=?, notes=?, attendees=?, updated_at=NOW() WHERE id=?
    `, [newDate, newStart, newEnd, newDur, purpose || existing.purpose, category || existing.category, notes ?? existing.notes, attendeesJson, req.params.id]);

    const updated = await get('SELECT b.*, r.name as room_name FROM bookings b JOIN rooms r ON b.room_id = r.id WHERE b.id = ?', [req.params.id]);
    sendMeetingInvitations(updated, { updated: true }).catch(e => console.error('Invite err:', e));
    await run(`INSERT INTO audit_log (id, action, entity_type, entity_id, details, performed_by) VALUES (?, 'UPDATE', 'booking', ?, ?, ?)`,
      [randomUUID(), req.params.id, JSON.stringify({ changes: req.body }), existing.employee_email]);

    res.json({ success: true, data: updated });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// DELETE /api/bookings/:id
router.delete('/:id', async (req, res) => {
  try {
    const { employee_email } = req.body;
    const existing = await get('SELECT b.*, r.name as room_name FROM bookings b JOIN rooms r ON b.room_id = r.id WHERE b.id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ success: false, error: 'الحجز غير موجود.' });
    if (!isAdmin(req) && userEmail(req) !== existing.employee_email.toLowerCase()) {
      return res.status(userEmail(req) ? 403 : 401).json(userEmail(req) ? { success: false, error: 'يمكنك إلغاء حجوزاتك فقط.' } : NEED_AUTH);
    }

    await run("UPDATE bookings SET status='cancelled', updated_at=NOW() WHERE id=?", [req.params.id]);
    sendCancellationNotification(existing, 'ألغاه الموظف').catch(e => console.error('Email err:', e));

    await run(`INSERT INTO audit_log (id, action, entity_type, entity_id, details, performed_by) VALUES (?, 'CANCEL', 'booking', ?, ?, ?)`,
      [randomUUID(), req.params.id, 'ألغى الموظف حجزه', existing.employee_email]);

    res.json({ success: true, message: 'تم إلغاء الحجز بنجاح.' });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
