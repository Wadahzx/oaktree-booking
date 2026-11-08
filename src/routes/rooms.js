const express = require('express');
const router = express.Router();
const { all, get } = require('../database/db');
const { getDaySchedule } = require('../services/schedule');

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

// Weekly usage stats (Sun-Thu working week), no personal emails
router.get('/stats', async (req, res) => {
  try {
    const now = nowInRiyadh();
    const pad = n => String(n).padStart(2, '0');
    const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const start = new Date(now); start.setDate(now.getDate() - now.getDay()); // Sunday
    const end = new Date(start); end.setDate(start.getDate() + 6);
    const rows = await all(`SELECT b.room_id, b.employee_name, b.start_time, b.duration, r.name AS room_name
      FROM bookings b JOIN rooms r ON r.id = b.room_id
      WHERE b.status = 'confirmed' AND b.date >= ? AND b.date <= ?`, [ymd(start), ymd(end)]);
    const cfg = Object.fromEntries((await all('SELECT key, value FROM admin_settings')).map(r => [r.key, r.value]));
    const toMin = t => { const [h, m] = String(t || '0:0').split(':').map(Number); return h * 60 + m; };
    const dayMins = Math.max(60, toMin(cfg.office_hours_end || '18:00') - toMin(cfg.office_hours_start || '08:00'));
    const capacity = dayMins * 5; // 5 working days per room
    const rooms = await all("SELECT id, name FROM rooms WHERE status != 'inactive' ORDER BY name");
    const perRoom = rooms.map(r => {
      const mine = rows.filter(b => b.room_id === r.id);
      const mins = mine.reduce((a, b) => a + Number(b.duration || 0), 0);
      return { room_id: r.id, room_name: r.name, bookings: mine.length, hours: Math.round(mins / 6) / 10, utilization: Math.min(100, Math.round(mins * 100 / capacity)) };
    });
    const byName = {};
    rows.forEach(b => { const k = (b.employee_name || '').trim(); if (k) byName[k] = (byName[k] || 0) + 1; });
    const top = Object.entries(byName).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, count]) => ({ name, count }));
    const peak = {};
    rows.forEach(b => { const h = Math.floor(toMin(b.start_time) / 60); peak[h] = (peak[h] || 0) + 1; });
    const peak_hours = Object.keys(peak).map(Number).sort((a, b) => a - b).map(h => ({ hour: h, count: peak[h] }));
    res.json({ success: true, data: { from: ymd(start), to: ymd(end), total: rows.length, rooms: perRoom, top_bookers: top, peak_hours } });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/availability', async (req, res) => {
  try {
    const { date } = req.query;
    if (!date) return res.status(400).json({ success: false, error: 'التاريخ مطلوب.' });

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

// GET /api/rooms/schedule?date=YYYY-MM-DD&duration=60
// Per room: who booked what, free windows, and (with duration) the start times that fit.
router.get('/schedule', async (req, res) => {
  try {
    const { date, duration } = req.query;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return res.status(400).json({ success: false, error: 'التاريخ مطلوب.' });
    const data = await getDaySchedule(date, parseInt(duration) || 0);
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/:id/availability', async (req, res) => {
  try {
    const { date } = req.query;
    if (!date) return res.status(400).json({ success: false, error: 'التاريخ مطلوب.' });

    const room = await get('SELECT * FROM rooms WHERE id = ?', [req.params.id]);
    if (!room) return res.status(404).json({ success: false, error: 'الغرفة غير موجودة.' });

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
