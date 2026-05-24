/* ============================================================
   OAKTREE — Dashboard (dashboard.js)
   ============================================================ */

const ROOM_NAMES = { oak_room: 'Oak Room', tree_room: 'Tree Room' };

async function loadDashboard() {
  const today = todayStr();
  document.getElementById('roomStatusDate').textContent = fmtDate(today);

  // Greet based on time
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const h1 = document.querySelector('.page-header-left h1');
  if (h1) h1.textContent = `${greet} — Oaktree Group HQ`;

  await Promise.all([
    loadRoomStatus(today),
    loadTodaySchedule(today),
    loadUpcomingBookings(),
    loadStats(today)
  ]);
}

async function loadStats(today) {
  try {
    const [availRes, bookRes] = await Promise.all([
      GET('/rooms/availability', { date: today }),
      GET('/bookings', { date: today, status: 'confirmed' })
    ]);

    const bookings = bookRes.data || [];
    document.getElementById('statToday').textContent = bookings.length;

    const rooms = availRes.data || [];
    rooms.forEach(r => {
      if (r.id === 'oak_room') {
        document.getElementById('statOak').textContent    = r.bookingCount;
        document.getElementById('statOakSub').textContent = `booking${r.bookingCount !== 1 ? 's' : ''} today`;
      }
      if (r.id === 'tree_room') {
        document.getElementById('statTree').textContent    = r.bookingCount;
        document.getElementById('statTreeSub').textContent = `booking${r.bookingCount !== 1 ? 's' : ''} today`;
      }
    });

    // Find next available slot across both rooms
    const nextSlot = await findNextAvailable(today);
    const nextEl   = document.getElementById('statNext');
    const nextSub  = document.getElementById('statNextSub');
    if (nextSlot) {
      nextEl.textContent  = fmt12(nextSlot.time);
      nextSub.textContent = nextSlot.room;
    } else {
      nextEl.textContent  = 'None today';
      nextSub.textContent = 'all slots taken or past';
    }
  } catch (e) {
    console.error('Stats error:', e);
  }
}

async function findNextAvailable(date) {
  try {
    for (const roomId of ['oak_room', 'tree_room']) {
      const { data } = await GET(`/rooms/${roomId}/availability`, { date });
      const slot = (data.slots || []).find(s => s.status === 'available');
      if (slot) return { time: slot.time, room: ROOM_NAMES[roomId] };
    }
  } catch { return null; }
  return null;
}

async function loadRoomStatus(today) {
  const container = document.getElementById('roomsStatus');
  try {
    const [availRes, slotsOak, slotsTree] = await Promise.all([
      GET('/rooms/availability', { date: today }),
      GET('/rooms/oak_room/availability', { date: today }),
      GET('/rooms/tree_room/availability', { date: today })
    ]);

    const rooms = availRes.data || [];
    if (!rooms.length) {
      container.innerHTML = `<div class="empty-state"><div class="empty-state-title">No rooms configured</div></div>`;
      return;
    }

    const slotsByRoom = { oak_room: slotsOak.data.slots || [], tree_room: slotsTree.data.slots || [] };

    container.innerHTML = rooms.map(room => {
      const slots    = slotsByRoom[room.id] || [];
      const now      = new Date();
      const current  = slots.find(s => {
        const start = new Date(`${today}T${s.time}:00`);
        const end   = new Date(`${today}T${s.end_time}:00`);
        return start <= now && end > now;
      });
      const next     = slots.find(s => s.status === 'available');
      const isBooked = current && current.status === 'booked';
      const isBlocked= current && current.status === 'blocked';

      let statusClass = 'available';
      let badgeHtml   = '<span class="badge badge-available">Available Now</span>';
      let statusInfo  = next ? `Next free: ${fmt12(next.time)}` : 'No slots today';

      if (isBlocked) {
        statusClass = 'blocked';
        badgeHtml   = '<span class="badge badge-blocked">Blocked</span>';
        statusInfo  = current.block ? current.block.reason : 'Administrative block';
      } else if (isBooked) {
        statusClass = 'occupied';
        badgeHtml   = '<span class="badge badge-in-progress">In Use</span>';
        statusInfo  = current.booking ? `${current.booking.purpose} · until ${fmt12(current.booking.end_time || '')}` : 'In use';
      }

      const totalSlots     = slots.filter(s => s.status !== 'past').length;
      const availableSlots = slots.filter(s => s.status === 'available').length;

      return `<div class="room-card ${statusClass}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px;">
          <div class="room-name">${room.name}</div>
          ${badgeHtml}
        </div>
        <div class="room-desc">${room.description || ''}</div>
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:10px;">${statusInfo}</div>
        <div class="room-meta">
          <span><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> ${room.capacity} capacity</span>
          <span>${availableSlots}/${totalSlots} slots free</span>
        </div>
      </div>`;
    }).join('');
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-title">Could not load room status</div></div>`;
  }
}

async function loadTodaySchedule(today) {
  const container = document.getElementById('todaySchedule');
  try {
    const { data: bookings } = await GET('/bookings', { date: today, status: 'confirmed' });

    if (!bookings.length) {
      container.innerHTML = `<div class="empty-state" style="padding:40px 0;">
        <div class="empty-state-icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div>
        <div class="empty-state-title">No reservations scheduled for today</div>
        <div class="empty-state-desc">All meeting rooms are available. Be the first to book!</div>
      </div>`;
      return;
    }

    const now = new Date();
    const rows = bookings.map(b => {
      const start = new Date(`${today}T${b.start_time}:00`);
      const end   = new Date(`${today}T${b.end_time}:00`);
      const isNow = start <= now && end > now;
      const isPast= end <= now;
      const roomColor = b.room_id === 'oak_room' ? 'var(--navy)' : 'var(--green)';

      return `<div style="display:flex;align-items:flex-start;gap:12px;padding:12px 20px;border-bottom:1px solid var(--grey-border);${isPast?'opacity:.5':''}">
        <div style="width:3px;height:40px;background:${roomColor};border-radius:2px;flex-shrink:0;margin-top:2px;"></div>
        <div style="min-width:90px;">
          <div style="font-size:13px;font-weight:700;color:var(--text-primary);">${fmt12(b.start_time)}</div>
          <div style="font-size:11px;color:var(--text-muted);">${fmt12(b.end_time)}</div>
        </div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:13.5px;font-weight:600;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(b.purpose)}</div>
          <div style="font-size:12px;color:var(--text-muted);">${b.room_name} · ${escHtml(b.employee_name)}</div>
        </div>
        ${isNow ? '<span class="badge badge-in-progress" style="flex-shrink:0;">Now</span>' : ''}
      </div>`;
    }).join('');

    container.innerHTML = rows;
  } catch (e) {
    container.innerHTML = `<div class="empty-state" style="padding:30px 0"><div class="empty-state-title">Could not load schedule</div></div>`;
  }
}

async function loadUpcomingBookings() {
  const tbody = document.getElementById('upcomingBody');
  try {
    const { data: bookings } = await GET('/bookings', { upcoming: 'true', status: 'confirmed' });

    if (!bookings.length) {
      tbody.innerHTML = `<tr><td colspan="7">
        <div class="empty-state" style="padding:40px 0;">
          <div class="empty-state-icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></div>
          <div class="empty-state-title">No upcoming reservations</div>
          <div class="empty-state-desc">No meetings are scheduled. <a href="/book" style="color:var(--navy);font-weight:600;">Book a room</a> to get started.</div>
        </div>
      </td></tr>`;
      return;
    }

    tbody.innerHTML = bookings.slice(0, 15).map(b => `<tr>
      <td><span class="badge" style="background:${b.room_id==='oak_room'?'rgba(27,42,74,.1)':'rgba(42,92,69,.1)'};color:${b.room_id==='oak_room'?'var(--navy)':'var(--green)'};border:none">${b.room_name}</span></td>
      <td><div style="font-weight:600;font-size:13px;">${escHtml(b.employee_name)}</div><div style="font-size:11px;color:var(--text-muted);">${escHtml(b.employee_email)}</div></td>
      <td>${fmtDate(b.date)}</td>
      <td>${fmt12(b.start_time)} – ${fmt12(b.end_time)}</td>
      <td>${fmtDuration(b.duration)}</td>
      <td style="max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(b.purpose)}</td>
      <td>${statusBadge(b.status)}</td>
    </tr>`).join('');
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:30px;">Could not load bookings.</td></tr>`;
  }
}

function escHtml(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

document.addEventListener('DOMContentLoaded', loadDashboard);
