// Day schedule helper: bookings per room + free windows + start times that fit a duration.
const { all } = require('../database/db');

const TZ = 'Asia/Riyadh';

const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const toStr = n => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;

function riyadhNow() {
  const d = new Date();
  return {
    date: d.toLocaleDateString('en-CA', { timeZone: TZ }),
    minutes: toMin(d.toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }))
  };
}

async function getSettings() {
  const rows = await all('SELECT key, value FROM admin_settings');
  const s = Object.fromEntries(rows.map(r => [r.key, r.value]));
  return {
    officeStart: toMin(s.office_hours_start || '08:00'),
    officeEnd:   toMin(s.office_hours_end   || '18:00'),
    interval:    parseInt(s.booking_interval || '30')
  };
}

/**
 * @param {string} date  YYYY-MM-DD
 * @param {number} durationMins  optional - when set, each room also gets `starts`
 *        (start times where a meeting of this length fits).
 */
async function getDaySchedule(date, durationMins = 0) {
  const { officeStart, officeEnd, interval } = await getSettings();
  const now = riyadhNow();
  const isToday = date === now.date;
  const isPastDay = date < now.date;

  const rooms = await all("SELECT id, name, capacity FROM rooms WHERE status = 'active' ORDER BY name");
  const bookings = await all(
    "SELECT room_id, start_time, end_time, purpose, employee_name FROM bookings WHERE date = ? AND status = 'confirmed' ORDER BY start_time",
    [date]
  );
  const blocks = await all(
    'SELECT room_id, start_time, end_time, reason FROM admin_blocks WHERE date = ? ORDER BY start_time',
    [date]
  );

  return rooms.map(room => {
    const roomBookings = bookings.filter(b => b.room_id === room.id);
    const roomBlocks = blocks.filter(b => b.room_id === room.id);
    const busy = [...roomBookings, ...roomBlocks].map(b => [toMin(b.start_time), toMin(b.end_time)]);

    // Free slots at the booking interval
    const freeSlots = [];
    for (let cur = officeStart; cur + interval <= officeEnd; cur += interval) {
      const past = isPastDay || (isToday && cur <= now.minutes);
      const taken = busy.some(([s, e]) => cur < e && cur + interval > s);
      if (!past && !taken) freeSlots.push(cur);
    }

    // Merge consecutive free slots into windows
    const free = [];
    for (const s of freeSlots) {
      const last = free[free.length - 1];
      if (last && last.endMin === s) last.endMin = s + interval;
      else free.push({ startMin: s, endMin: s + interval });
    }

    let starts = [];
    if (durationMins) {
      starts = freeSlots.filter(s => free.some(w => s >= w.startMin && s + durationMins <= w.endMin)).map(toStr);
    }

    return {
      id: room.id,
      name: room.name,
      capacity: room.capacity,
      bookings: roomBookings.map(b => ({
        start_time: b.start_time, end_time: b.end_time,
        purpose: b.purpose, employee_name: b.employee_name
      })),
      blocks: roomBlocks.map(b => ({ start_time: b.start_time, end_time: b.end_time, reason: b.reason })),
      free: free.map(w => ({ start_time: toStr(w.startMin), end_time: toStr(w.endMin) })),
      starts
    };
  });
}

module.exports = { getDaySchedule };
