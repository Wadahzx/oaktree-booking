const express = require('express');
const router = express.Router();
const { all, get } = require('../database/db');

const TZ = 'Asia/Riyadh';
function nowInRiyadh() {
  const d = new Date();
  return new Date(d.toLocaleString('en-US', { timeZone: TZ }));
}

router.get('/', async (req, res) => {
  try {
    const rooms = await all("SELECT * FROM rooms WHERE status != 'inactive' ORDER BY name");
    res.json({ success: true, data: rooms });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/availability', async (req, res) => {
  try {
    const { date } = req.query;
    if (!date) return res.status(400).json({ success: false, error: 'Date required.' });

    const rooms = await all("SELECT * FROM rooms WHERE status = 'active'");
    const availability = await Promise.all(rooms.map(async room => {
      const bc = await get("SELECT COUNT(*) as c FROM bookings WHERE room_id=? AND date=? AND status='confirmed'", [room.id, date]);
      const blk = await get("SELECT COUNT(*) as c FROM admin_blocks WHERE room_id=? AND date=?", [room.id, date]);
      return { ...room, bookingCount: parseInt(bc.c), blockCount: parseInt(blk.c) };
    }));
    res.json({ success: true, data: availability });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/:id/availability', async (req, res) => {
  try {
    const { date } = req.query;
    if (!date) return res.status(400).json({ success: false, error: 'Date required.' });

    const room = await get('SELECT * FROM rooms WHERE id = ?', [req.params.id]);
    if (!room) return res.status(404).json({ success: false, error: 'Room not found.' });

    const bookings = await all("SELECT * FROM bookings WHERE room_id=? AND date=? AND status='confirmed' ORDER BY start_time", [req.params.id, date]);
    const blocks   = await all("SELECT * FROM admin_blocks WHERE room_id=? AND date=? ORDER BY start_time", [req.params.id, date]);

    const cfgRows = await all('SELECT key, value FROM admin_settings');
    const s = Object.fromEntries(cfgRows.map(r => [r.key, r.value]));
    const officeStart = s.office_hours_start || '08:00';
    const officeEnd   = s.office_hours_end   || '18:00';
    const interval    = parseInt(s.booking_interval || '30');

    const slots = [];
    const [sh, sm] = officeStart.split(':').map(Number);
    const [eh, em] = officeEnd.split(':').map(Number);
    let cur = sh * 60 + sm;
    const end = eh * 60 + em;
    const now = nowInRiyadh();

    while (cur < end) {
      const t1 = `${String(Math.floor(cur / 60)).padStart(2, '0')}:${String(cur % 60).padStart(2, '0')}`;
      const t2 = `${String(Math.floor((cur + interval) / 60)).padStart(2, '0')}:${String((cur + interval) % 60).padStart(2, '0')}`;
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
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
