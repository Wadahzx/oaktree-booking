const express = require('express');
const router = express.Router();
const { randomUUID } = require('crypto');
const { all, get, run } = require('../database/db');
const { sendBookingConfirmation, sendCancellationNotification } = require('../services/emailService');

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

// GET /api/bookings
router.get('/', async (req, res) => {
  try {
    const { email, date, room_id, status, upcoming } = req.query;
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
    res.json({ success: true, data: bookings });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/bookings/:id
router.get('/:id', async (req, res) => {
  try {
    const b = await get('SELECT b.*, r.name as room_name FROM bookings b JOIN rooms r ON b.room_id = r.id WHERE b.id = ?', [req.params.id]);
    if (!b) return res.status(404).json({ success: false, error: 'Booking not found' });
    res.json({ success: true, data: b });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/bookings
router.post('/', async (req, res) => {
  try {
    const { employee_name, employee_email, room_id, date, start_time, duration, purpose, category, notes } = req.body;

    if (!employee_name || !employee_email || !room_id || !date || !start_time || !duration || !purpose) {
      return res.status(400).json({ success: false, error: 'All required fields must be filled in.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(employee_email)) {
      return res.status(400).json({ success: false, error: 'Please enter a valid email address.' });
    }

    const cfgRows = await all('SELECT key, value FROM admin_settings');
    const cfg = Object.fromEntries(cfgRows.map(r => [r.key, r.value]));
    const officeStart = cfg.office_hours_start || '08:00';
    const officeEnd   = cfg.office_hours_end   || '18:00';
    const maxDur      = parseInt(cfg.max_booking_duration || '120');
    const minDur      = parseInt(cfg.min_booking_duration || '30');
    const durMins     = parseInt(duration);

    if (durMins < minDur || durMins > maxDur) {
      return res.status(400).json({ success: false, error: `Duration must be between ${minDur} and ${maxDur} minutes.` });
    }

    const end_time = calcEndTime(start_time, durMins);
    if (start_time < officeStart || end_time > officeEnd) {
      return res.status(400).json({ success: false, error: `Bookings must be within office hours (${officeStart}–${officeEnd}).` });
    }

    const slotDT = new Date(`${date}T${start_time}:00`);
    if (slotDT <= nowInRiyadh()) {
      return res.status(400).json({ success: false, error: 'Cannot book a time slot in the past.' });
    }

    const overlap = await get(`
      SELECT id FROM bookings
      WHERE room_id = ? AND date = ? AND status = 'confirmed'
      AND NOT (end_time <= ? OR start_time >= ?)
    `, [room_id, date, start_time, end_time]);
    if (overlap) return res.status(409).json({ success: false, error: 'This time slot is already booked. Please choose a different time.' });

    const blocked = await get(`
      SELECT id FROM admin_blocks WHERE room_id = ? AND date = ?
      AND NOT (end_time <= ? OR start_time >= ?)
    `, [room_id, date, start_time, end_time]);
    if (blocked) return res.status(409).json({ success: false, error: 'This time slot has been blocked by administration.' });

    const room = await get("SELECT * FROM rooms WHERE id = ? AND status = 'active'", [room_id]);
    if (!room) return res.status(400).json({ success: false, error: 'Room not found or unavailable.' });

    const id = randomUUID();
    await run(`
      INSERT INTO bookings (id, employee_name, employee_email, room_id, date, start_time, end_time, duration, purpose, category, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [id, employee_name.trim(), employee_email.trim().toLowerCase(), room_id, date, start_time, end_time, durMins, purpose.trim(), category || 'meeting', notes || '']);

    const booking = await get('SELECT b.*, r.name as room_name FROM bookings b JOIN rooms r ON b.room_id = r.id WHERE b.id = ?', [id]);
    sendBookingConfirmation(booking).catch(e => console.error('Email err:', e));

    await run(`INSERT INTO audit_log (id, action, entity_type, entity_id, details, performed_by) VALUES (?, 'CREATE', 'booking', ?, ?, ?)`,
      [randomUUID(), id, JSON.stringify({ employee_name, room_id, date, start_time, end_time }), employee_email.toLowerCase()]);

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
    if (!existing) return res.status(404).json({ success: false, error: 'Booking not found.' });
    if (existing.employee_email.toLowerCase() !== (employee_email || '').toLowerCase()) {
      return res.status(403).json({ success: false, error: 'You can only edit your own bookings.' });
    }
    if (existing.status !== 'confirmed') {
      return res.status(400).json({ success: false, error: 'Cannot edit a cancelled or overridden booking.' });
    }

    const cfgRows = await all('SELECT key, value FROM admin_settings');
    const cfg = Object.fromEntries(cfgRows.map(r => [r.key, r.value]));
    const newDate  = date       || existing.date;
    const newStart = start_time || existing.start_time;
    const newDur   = duration   ? parseInt(duration) : existing.duration;
    const newEnd   = calcEndTime(newStart, newDur);

    if (new Date(`${newDate}T${newStart}:00`) <= nowInRiyadh()) {
      return res.status(400).json({ success: false, error: 'Cannot move booking to a past time.' });
    }
    const officeStart = cfg.office_hours_start || '08:00';
    const officeEnd   = cfg.office_hours_end   || '18:00';
    if (newStart < officeStart || newEnd > officeEnd) {
      return res.status(400).json({ success: false, error: `Bookings must be within office hours (${officeStart}–${officeEnd}).` });
    }

    const overlap = await get(`
      SELECT id FROM bookings WHERE room_id = ? AND date = ? AND status = 'confirmed' AND id != ?
      AND NOT (end_time <= ? OR start_time >= ?)
    `, [existing.room_id, newDate, req.params.id, newStart, newEnd]);
    if (overlap) return res.status(409).json({ success: false, error: 'This time slot is already booked.' });

    await run(`
      UPDATE bookings SET date=?, start_time=?, end_time=?, duration=?, purpose=?, category=?, notes=?, updated_at=NOW() WHERE id=?
    `, [newDate, newStart, newEnd, newDur, purpose || existing.purpose, category || existing.category, notes ?? existing.notes, req.params.id]);

    const updated = await get('SELECT b.*, r.name as room_name FROM bookings b JOIN rooms r ON b.room_id = r.id WHERE b.id = ?', [req.params.id]);
    await run(`INSERT INTO audit_log (id, action, entity_type, entity_id, details, performed_by) VALUES (?, 'UPDATE', 'booking', ?, ?, ?)`,
      [randomUUID(), req.params.id, JSON.stringify({ changes: req.body }), employee_email]);

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
    if (!existing) return res.status(404).json({ success: false, error: 'Booking not found.' });
    if (existing.employee_email.toLowerCase() !== (employee_email || '').toLowerCase()) {
      return res.status(403).json({ success: false, error: 'You can only cancel your own bookings.' });
    }

    await run("UPDATE bookings SET status='cancelled', updated_at=NOW() WHERE id=?", [req.params.id]);
    sendCancellationNotification(existing, 'Cancelled by employee').catch(e => console.error('Email err:', e));

    await run(`INSERT INTO audit_log (id, action, entity_type, entity_id, details, performed_by) VALUES (?, 'CANCEL', 'booking', ?, ?, ?)`,
      [randomUUID(), req.params.id, 'Employee cancelled their booking', employee_email]);

    res.json({ success: true, message: 'Booking cancelled successfully.' });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
