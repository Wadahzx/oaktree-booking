/* ============================================================
   OAKTREE — Calendar (calendar.js)
   ============================================================ */

let currentDate   = new Date();
let currentView   = 'day';
let roomFilter    = 'all';
let allBookings   = [];
let allBlocks     = [];

const DAYS  = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYSL = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

// ── INIT ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Nav buttons
  document.getElementById('prevBtn').addEventListener('click', () => navigate(-1));
  document.getElementById('nextBtn').addEventListener('click', () => navigate(1));
  document.getElementById('todayBtn').addEventListener('click', () => { currentDate = new Date(); render(); });

  // View toggle
  document.getElementById('btnDay').addEventListener('click',  () => setView('day'));
  document.getElementById('btnWeek').addEventListener('click', () => setView('week'));

  // Room filter chips
  document.getElementById('filterAll').addEventListener('click',  () => setFilter('all'));
  document.getElementById('filterOak').addEventListener('click',  () => setFilter('oak_room'));
  document.getElementById('filterTree').addEventListener('click', () => setFilter('tree_room'));

  // Modal close
  document.getElementById('modalClose').addEventListener('click', () => closeModal('bookingModal'));
  document.getElementById('modalCloseBtn').addEventListener('click', () => closeModal('bookingModal'));

  render();
});

function navigate(dir) {
  if (currentView === 'day') {
    currentDate.setDate(currentDate.getDate() + dir);
  } else {
    currentDate.setDate(currentDate.getDate() + dir * 7);
  }
  render();
}

function setView(v) {
  currentView = v;
  document.getElementById('btnDay').classList.toggle('active',  v === 'day');
  document.getElementById('btnWeek').classList.toggle('active', v === 'week');
  render();
}

function setFilter(f) {
  roomFilter = f;
  ['all','oak_room','tree_room'].forEach(r => {
    const el = document.getElementById(`filter${r==='all'?'All':r==='oak_room'?'Oak':'Tree'}`);
    el.className = 'room-chip';
    if (r === f) el.classList.add(r === 'all' ? 'active-all' : r === 'oak_room' ? 'active-oak' : 'active-tree');
  });
  renderGrid();
}

// ── RENDER ────────────────────────────────────────────────────
async function render() {
  updateTitle();
  await fetchData();
  renderGrid();
}

function updateTitle() {
  const title = document.getElementById('calTitle');
  if (currentView === 'day') {
    title.textContent = currentDate.toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
  } else {
    const start = getWeekStart(currentDate);
    const end   = new Date(start); end.setDate(end.getDate() + 6);
    title.textContent = `${start.toLocaleDateString('en-GB',{day:'numeric',month:'short'})} – ${end.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}`;
  }
}

async function fetchData() {
  if (currentView === 'day') {
    await fetchDay(currentDate);
  } else {
    const start = getWeekStart(currentDate);
    const promises = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(start); d.setDate(d.getDate() + i);
      promises.push(fetchDay(d));
    }
    await Promise.all(promises);
  }
}

async function fetchDay(date) {
  const ds = dateStr(date);
  try {
    const [bRes, blkRes] = await Promise.all([
      GET('/bookings', { date: ds }),
      GET('/admin/blocks', { date: ds }).catch(() => ({ data: [] }))
    ]);
    const existing = allBookings.filter(b => b.date !== ds);
    allBookings = [...existing, ...(bRes.data || [])];
    const existingBlk = allBlocks.filter(b => b.date !== ds);
    allBlocks = [...existingBlk, ...(blkRes.data || [])];
  } catch (e) {
    console.error('Fetch error:', e);
  }
}

// ── GRID RENDERING ────────────────────────────────────────────
function renderGrid() {
  const container = document.getElementById('calendarContainer');
  if (currentView === 'day') renderDayView(container);
  else renderWeekView(container);
}

function getTimeSlots() {
  const slots = [];
  for (let h = 8; h < 18; h++) {
    slots.push(`${String(h).padStart(2,'0')}:00`);
    slots.push(`${String(h).padStart(2,'0')}:30`);
  }
  return slots;
}

function renderDayView(container) {
  const ds   = dateStr(currentDate);
  const isToday = ds === todayStr();
  const slots= getTimeSlots();

  const bookings = allBookings.filter(b => b.date === ds && b.status === 'confirmed' && matchesFilter(b.room_id));
  const blocks   = allBlocks.filter(b => b.date === ds && matchesFilter(b.room_id));

  const header = `<div style="display:grid;grid-template-columns:72px 1fr 1fr;background:var(--beige);border-bottom:2px solid var(--grey-border);">
    <div style="padding:10px 12px;font-size:11px;font-weight:600;color:var(--text-muted);border-right:1px solid var(--grey-border);">TIME</div>
    <div style="padding:10px 12px;font-size:12px;font-weight:700;color:var(--navy);border-right:1px solid var(--grey-border);">Oak Room</div>
    <div style="padding:10px 12px;font-size:12px;font-weight:700;color:var(--green);">Tree Room</div>
  </div>`;

  const rows = slots.map(time => {
    const oakEvents  = getEventsForSlot(bookings, blocks, 'oak_room',  ds, time);
    const treeEvents = getEventsForSlot(bookings, blocks, 'tree_room', ds, time);
    const isPast = new Date(`${ds}T${time}:00`) <= new Date();

    return `<div style="display:grid;grid-template-columns:72px 1fr 1fr;min-height:52px;border-bottom:1px solid var(--grey-border);background:${isPast?'var(--beige)':'var(--white)'}">
      <div style="padding:8px 12px;font-size:11px;font-weight:600;color:var(--text-muted);border-right:1px solid var(--grey-border);background:var(--beige);display:flex;align-items:center;">${fmt12(time)}</div>
      <div style="padding:4px;border-right:1px solid var(--grey-border);cursor:pointer;" onclick="handleCellClick('${ds}','${time}','oak_room')">${renderCellContent(oakEvents, isPast)}</div>
      <div style="padding:4px;cursor:pointer;" onclick="handleCellClick('${ds}','${time}','tree_room')">${renderCellContent(treeEvents, isPast)}</div>
    </div>`;
  }).join('');

  container.innerHTML = header + `<div style="overflow:auto;max-height:68vh;">${rows || '<div class="empty-state" style="padding:48px">No time slots configured.</div>'}</div>`;
}

function renderWeekView(container) {
  const start = getWeekStart(currentDate);
  const days  = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start); d.setDate(d.getDate() + i);
    days.push(d);
  }
  const slots = getTimeSlots();
  const today = todayStr();

  const headerCols = days.map(d => {
    const ds  = dateStr(d);
    const isTd = ds === today;
    return `<div style="padding:10px 6px;font-size:11px;font-weight:600;color:${isTd?'var(--navy)':'var(--text-secondary)'};text-align:center;border-right:1px solid var(--grey-border);background:${isTd?'rgba(27,42,74,.06)':'var(--beige)'}">
      <div>${DAYS[d.getDay()]}</div>
      <div style="font-size:16px;font-weight:700;color:${isTd?'var(--navy)':'var(--text-primary)'};">${d.getDate()}${isTd?'<span style="display:inline-block;width:6px;height:6px;background:var(--gold);border-radius:50%;margin-left:3px;vertical-align:middle;"></span>':''}</div>
    </div>`;
  }).join('');

  const header = `<div style="display:grid;grid-template-columns:60px repeat(7,1fr);background:var(--beige);border-bottom:2px solid var(--grey-border);position:sticky;top:0;z-index:10;">
    <div style="padding:10px 8px;font-size:10px;font-weight:600;color:var(--text-muted);border-right:1px solid var(--grey-border);text-align:center;">TIME</div>
    ${headerCols}
  </div>`;

  const rows = slots.map(time => {
    const cells = days.map(d => {
      const ds       = dateStr(d);
      const isTd     = ds === today;
      const isPast   = new Date(`${ds}T${time}:00`) <= new Date();
      const bFilter  = allBookings.filter(b => b.date === ds && b.status === 'confirmed' && matchesFilter(b.room_id));
      const blkFilter= allBlocks.filter(b => b.date === ds && matchesFilter(b.room_id));
      const events   = getEventsForSlot(bFilter, blkFilter, null, ds, time);
      return `<div style="padding:2px;border-right:1px solid var(--grey-border);background:${isTd?'rgba(201,168,76,.03)':isPast?'var(--beige)':'var(--white)'};min-height:44px;cursor:pointer;" onclick="handleCellClick('${ds}','${time}',null)">${renderCellContent(events, isPast)}</div>`;
    }).join('');
    return `<div style="display:grid;grid-template-columns:60px repeat(7,1fr);border-bottom:1px solid var(--grey-border);">
      <div style="padding:6px 8px;font-size:10px;font-weight:600;color:var(--text-muted);background:var(--beige);border-right:1px solid var(--grey-border);display:flex;align-items:center;">${fmt12(time)}</div>
      ${cells}
    </div>`;
  }).join('');

  container.innerHTML = header + `<div style="overflow:auto;max-height:65vh;">${rows}</div>`;
}

function renderCellContent(events, isPast) {
  if (!events.length) {
    return isPast ? '' : `<div style="height:100%;min-height:36px;display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .2s;" class="slot-add-hint"><span style="font-size:10px;color:var(--green);font-weight:600;">+ Book</span></div>`;
  }
  return events.map(ev => {
    if (ev.type === 'block') {
      return `<div class="cal-event blocked" title="${escHtml(ev.reason)}" onclick="event.stopPropagation();showBlockDetail('${escHtml(ev.reason)}')">🔒 ${escHtml(ev.reason)}</div>`;
    }
    const cls = ev.room_id === 'oak_room' ? 'oak-room' : 'tree-room';
    return `<div class="cal-event ${cls}" title="${escHtml(ev.purpose)}" onclick="event.stopPropagation();showBookingDetail('${ev.id}')">${escHtml(ev.purpose)}<br><span style="font-size:10px;opacity:.8;">${escHtml(ev.employee_name)} · ${ev.room_name||''}</span></div>`;
  }).join('');
}

function getEventsForSlot(bookings, blocks, roomId, date, time) {
  const events = [];
  const t1 = time;
  const [h, m] = time.split(':').map(Number);
  const t2 = `${String(Math.floor((h*60+m+30)/60)).padStart(2,'0')}:${String((h*60+m+30)%60).padStart(2,'0')}`;

  for (const b of bookings) {
    if (roomId && b.room_id !== roomId) continue;
    if (!(t2 <= b.start_time || t1 >= b.end_time)) events.push({ ...b, type: 'booking' });
  }
  for (const bl of blocks) {
    if (roomId && bl.room_id !== roomId) continue;
    if (!(t2 <= bl.start_time || t1 >= bl.end_time)) events.push({ ...bl, type: 'block' });
  }
  return events;
}

function matchesFilter(roomId) {
  if (roomFilter === 'all') return true;
  return roomId === roomFilter;
}

// ── CELL CLICK ────────────────────────────────────────────────
function handleCellClick(date, time, roomId) {
  const events = getEventsForSlot(
    allBookings.filter(b => b.date === date && b.status === 'confirmed'),
    allBlocks.filter(b => b.date === date),
    roomId, date, time
  );

  if (events.length === 0) {
    const params = new URLSearchParams({ date, time: time, room: roomId || '' });
    window.location.href = `/book?${params}`;
    return;
  }

  const ev = events[0];
  if (ev.type === 'block') { showBlockDetail(ev.reason); return; }
  showBookingDetail(ev.id);
}

async function showBookingDetail(id) {
  try {
    const { data: b } = await GET(`/bookings/${id}`);
    document.getElementById('modalTitle').textContent = b.purpose;
    document.getElementById('modalContent').innerHTML = `
      <div class="booking-detail-row"><div class="detail-label">Room</div><div class="detail-value">${b.room_name}</div></div>
      <div class="booking-detail-row"><div class="detail-label">Date</div><div class="detail-value">${fmtDateLong(b.date)}</div></div>
      <div class="booking-detail-row"><div class="detail-label">Time</div><div class="detail-value">${fmt12(b.start_time)} – ${fmt12(b.end_time)}</div></div>
      <div class="booking-detail-row"><div class="detail-label">Duration</div><div class="detail-value">${fmtDuration(b.duration)}</div></div>
      <div class="booking-detail-row"><div class="detail-label">Booked by</div><div class="detail-value">${escHtml(b.employee_name)}</div></div>
      <div class="booking-detail-row"><div class="detail-label">Category</div><div class="detail-value">${categoryLabel(b.category)}</div></div>
      ${b.notes ? `<div class="booking-detail-row"><div class="detail-label">Notes</div><div class="detail-value">${escHtml(b.notes)}</div></div>` : ''}
      <div style="margin-top:10px;">${statusBadge(b.status)}</div>`;
    openModal('bookingModal');
  } catch (e) {
    showToast('error', 'Error', 'Could not load booking details.');
  }
}

function showBlockDetail(reason) {
  document.getElementById('modalTitle').textContent = 'Blocked Slot';
  document.getElementById('modalContent').innerHTML = `
    <div class="booking-detail-row"><div class="detail-label">Status</div><div class="detail-value"><span class="badge badge-blocked">Blocked by Admin</span></div></div>
    <div class="booking-detail-row"><div class="detail-label">Reason</div><div class="detail-value">${escHtml(reason)}</div></div>`;
  openModal('bookingModal');
}

// ── HELPERS ───────────────────────────────────────────────────
function getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - day);
  return d;
}

function dateStr(d) {
  return d.toISOString().split('T')[0];
}

function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
