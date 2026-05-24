const express = require('express');
const router = express.Router();
const { randomUUID } = require('crypto');
const { getDb } = require('../database/db');
const { sendBookingConfirmation, sendCancellationNotification } = require('../services/emailService');

function calcEndTime(startTime, durationMins) {
  const [h, m] = startTime.split(':').map(Number);
  const total = h * 60 + m + parseInt(durationMins);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function getSettings(db) {
  const rows = db.prepare('SELECT key, value FROM admin_settings').all();
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

// GET /api/bookings  — query by ?email= for employee view, or ?date= ?room_id= ?status=
router.get('/', (req, res) => {
  const db = getDb();
  const { email, date, room_id, status, upcoming } = req.query;

  let query = `SELECT b.*, r.name as room_name FROM bookings b JOIN rooms r ON b.room_id = r.id WHERE 1=1`;
  const params = [];

  if (email) { query += ' AND LOWER(b.employee_email) = LOWER(?)'; params.push(email); }
  if (date) { query += ' AND b.date = ?'; params.push(date); }
  if (room_id) { query += ' AND b.room_id = ?'; params.push(room_id); }
  if (status) { query += ' AND b.status = ?'; params.push(status); }
  if (upcoming === 'true') {
    query += " AND (b.date > date('now') OR (b.date = date('now') AND b.start_time >= strftime('%H:%M','now','localtime')))";
  }

  query += ' ORDER BY b.date, b.start_time';
  const bookings = db.prepare(query).all(...params);
  res.json({ success: true, data: bookings });
});

// GET /api/bookings/:id
router.get('/:id', (req, res) => {
  const db = getDb();
  const b = db.prepare('SELECT b.*, r.name as room_name FROM bookings b JOIN rooms r ON b.room_id = r.id WHERE b.id = ?').get(req.params.id);
  if (!b) return res.status(404).json({ success: false, error: 'Booking not found' });
  res.json({ success: true, data: b });
});

// POST /api/bookings — create booking
router.post('/', (req, res) => {
  const db = getDb();
  const { employee_name, employee_email, room_id, date, start_time, duration, purpose, category, notes } = req.body;

  if (!employee_name || !employee_email || !room_id || !date || !start_time || !duration || !purpose) {
    return res.status(400).json({ success: false, error: 'All required fields must be filled in.' });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(employee_email)) {
    return res.status(400).json({ success: false, error: 'Please enter a valid email address.' });
  }

  const cfg = getSettings(db);
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

  const now = new Date();
  const slotDT = new Date(`${date}T${start_time}:00`);
  if (slotDT <= now) {
    return res.status(400).json({ success: false, error: 'Cannot book a time slot in the past.' });
  }

  const overlap = db.prepare(`
    SELECT id FROM bookings
    WHERE room_id = ? AND date = ? AND status = 'confirmed'
    AND NOT (end_time <= ? OR start_time >= ?)
  `).get(room_id, date, start_time, end_time);
  if (overlap) return res.status(409).json({ success: false, error: 'This time slot is already booked. Please choose a different time.' });

  const blocked = db.prepare(`
    SELECT id FROM admin_blocks WHERE room_id = ? AND date = ?
    AND NOT (end_time <= ? OR start_time >= ?)
  `).get(room_id, date, start_time, end_time);
  if (blocked) return res.status(409).json({ success: false, error: 'This time slot has been blocked by administration.' });

  const room = db.prepare("SELECT * FROM rooms WHERE id = ? AND status = 'active'").get(room_id);
  if (!room) return res.status(400).json({ success: false, error: 'Room not found or unavailable.' });

  const id = randomUUID();
  db.prepare(`
    INSERT INTO bookings (id, employee_name, employee_email, room_id, date, start_time, end_time, duration, purpose, category, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, employee_name.trim(), employee_email.trim().toLowerCase(), room_id, date, start_time, end_time, durMins, purpose.trim(), category || 'meeting', notes || '');

  const booking = db.prepare('SELECT b.*, r.name as room_name FROM bookings b JOIN rooms r ON b.room_id = r.id WHERE b.id = ?').get(id);

  sendBookingConfirmation(booking).catch(e => console.error('Email err:', e));

  db.prepare(`INSERT INTO audit_log (id, action, entity_type, entity_id, details, performed_by) VALUES (?, 'CREATE', 'booking', ?, ?, ?)`)
    .run(randomUUID(), id, JSON.stringify({ employee_name, room_id, date, start_time, end_time }), employee_email.toLowerCase());

  res.status(201).json({ success: true, data: booking });
});

// PUT /api/bookings/:id — update booking (employee own only)
router.put('/:id', (req, res) => {
  const db = getDb();
  const { employee_email, date, start_time, duration, purpose, category, notes } = req.body;

  const existing = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ success: false, error: 'Booking not found.' });
  if (existing.employee_email.toLowerCase() !== (employee_email || '').toLowerCase()) {
    return res.status(403).json({ success: false, error: 'You can only edit your own bookings.' });
  }
  if (existing.status !== 'confirmed') {
    return res.status(400).json({ success: false, error: 'Cannot edit a cancelled or overridden booking.' });
  }

  const cfg = getSettings(db);
  const newDate  = date       || existing.date;
  const newStart = start_time || existing.start_time;
  const newDur   = duration   ? parseInt(duration) : existing.duration;
  const newEnd   = calcEndTime(newStart, newDur);

  if (new Date(`${newDate}T${newStart}:00`) <= new Date()) {
    return res.status(400).json({ success: false, error: 'Cannot move booking to a past time.' });
  }

  const officeStart = cfg.office_hours_start || '08:00';
  const officeEnd   = cfg.office_hours_end   || '18:00';
  if (newStart < officeStart || newEnd > officeEnd) {
    return res.status(400).json({ success: false, error: `Bookings must be within office hours (${officeStart}–${officeEnd}).` });
  }

  const overlap = db.prepare(`
    SELECT id FROM bookings WHERE room_id = ? AND date = ? AND status = 'confirmed' AND id != ?
    AND NOT (end_time <= ? OR start_time >= ?)
  `).get(existing.room_id, newDate, req.params.id, newStart, newEnd);
  if (overlap) return res.status(409).json({ success: false, error: 'This time slot is already booked.' });

  db.prepare(`
    UPDATE bookings SET date=?, start_time=?, end_time=?, duration=?, purpose=?, category=?, notes=?, updated_at=CURRENT_TIMESTAMP WHERE id=?
  `).run(newDate, newStart, newEnd, newDur, purpose || existing.purpose, category || existing.category, notes ?? existing.notes, req.params.id);

  const updated = db.prepare('SELECT b.*, r.name as room_name FROM bookings b JOIN rooms r ON b.room_id = r.id WHERE b.id = ?').get(req.params.id);

  db.prepare(`INSERT INTO audit_log (id, action, entity_type, entity_id, details, performed_by) VALUES (?, 'UPDATE', 'booking', ?, ?, ?)`)
    .run(randomUUID(), req.params.id, JSON.stringify({ changes: req.body }), employee_email);

  res.json({ success: true, data: updated });
});

// DELETE /api/bookings/:id — cancel booking (employee own only)
router.delete('/:id', (req, res) => {
  const db = getDb();
  const { employee_email } = req.body;

  const existing = db.prepare('SELECT b.*, r.name as room_name FROM bookings b JOIN rooms r ON b.room_id = r.id WHERE b.id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ success: false, error: 'Booking not found.' });
  if (existing.employee_email.toLowerCase() !== (employee_email || '').toLowerCase()) {
    return res.status(403).json({ success: false, error: 'You can only cancel your own bookings.' });
  }

  db.prepare("UPDATE bookings SET status='cancelled', updated_at=CURRENT_TIMESTAMP WHERE id=?").run(req.params.id);

  sendCancellationNotification(existing, 'Cancelled by employee').catch(e => console.error('Email err:', e));

  db.prepare(`INSERT INTO audit_log (id, action, entity_type, entity_id, details, performed_by) VALUES (?, 'CANCEL', 'booking', ?, ?, ?)`)
    .run(randomUUID(), req.params.id, 'Employee cancelled their booking', employee_email);

  res.json({ success: true, message: 'Booking cancelled successfully.' });
});

module.exports = router;
