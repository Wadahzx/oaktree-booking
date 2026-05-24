const express = require('express');
const router = express.Router();
const { getDb } = require('../database/db');

router.get('/', (req, res) => {
  const db = getDb();
  res.json({ success: true, data: db.prepare("SELECT * FROM rooms WHERE status != 'inactive' ORDER BY name").all() });
});

router.get('/availability', (req, res) => {
  const db = getDb();
  const { date } = req.query;
  if (!date) return res.status(400).json({ success: false, error: 'Date required.' });

  const rooms = db.prepare("SELECT * FROM rooms WHERE status = 'active'").all();
  const availability = rooms.map(room => {
    const bookingCount = db.prepare("SELECT COUNT(*) as c FROM bookings WHERE room_id=? AND date=? AND status='confirmed'").get(room.id, date).c;
    const blockCount   = db.prepare("SELECT COUNT(*) as c FROM admin_blocks WHERE room_id=? AND date=?").get(room.id, date).c;
    return { ...room, bookingCount, blockCount };
  });
  res.json({ success: true, data: availability });
});

router.get('/:id/availability', (req, res) => {
  const db = getDb();
  const { date } = req.query;
  if (!date) return res.status(400).json({ success: false, error: 'Date required.' });

  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(req.params.id);
  if (!room) return res.status(404).json({ success: false, error: 'Room not found.' });

  const bookings = db.prepare("SELECT * FROM bookings WHERE room_id=? AND date=? AND status='confirmed' ORDER BY start_time").all(req.params.id, date);
  const blocks   = db.prepare("SELECT * FROM admin_blocks WHERE room_id=? AND date=? ORDER BY start_time").all(req.params.id, date);

  const cfg = db.prepare('SELECT key, value FROM admin_settings').all();
  const s   = Object.fromEntries(cfg.map(r => [r.key, r.value]));
  const officeStart = s.office_hours_start || '08:00';
  const officeEnd   = s.office_hours_end   || '18:00';
  const interval    = parseInt(s.booking_interval || '30');

  const slots = [];
  const [sh, sm] = officeStart.split(':').map(Number);
  const [eh, em] = officeEnd.split(':').map(Number);
  let cur = sh * 60 + sm;
  const end = eh * 60 + em;
  const now = new Date();

  while (cur < end) {
    const t1 = `${String(Math.floor(cur/60)).padStart(2,'0')}:${String(cur%60).padStart(2,'0')}`;
    const t2 = `${String(Math.floor((cur+interval)/60)).padStart(2,'0')}:${String((cur+interval)%60).padStart(2,'0')}`;
    const isPast    = new Date(`${date}T${t1}:00`) <= now;
    const isBooked  = bookings.some(b => !(t2 <= b.start_time || t1 >= b.end_time));
    const isBlocked = blocks.some(b   => !(t2 <= b.start_time || t1 >= b.end_time));
    const booking   = isBooked  ? bookings.find(b => !(t2 <= b.start_time || t1 >= b.end_time)) : null;
    const block     = isBlocked ? blocks.find(b   => !(t2 <= b.start_time || t1 >= b.end_time)) : null;

    let status = 'available';
    if (isBlocked) status = 'blocked';
    else if (isBooked) status = 'booked';
    else if (isPast)   status = 'past';

    slots.push({
      time: t1, end_time: t2, status,
      booking: booking ? { id: booking.id, employee_name: booking.employee_name, purpose: booking.purpose, end_time: booking.end_time } : null,
      block:   block   ? { reason: block.reason } : null
    });
    cur += interval;
  }

  res.json({ success: true, data: { room, bookings, blocks, slots, officeStart, officeEnd } });
});

module.exports = router;
