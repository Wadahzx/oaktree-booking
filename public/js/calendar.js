/* ============================================================
   OAKTREE — Calendar (calendar.js)
   Timeline day view (one column per room) and week view.
   The room filter is built from the rooms API, so any room works.
   ============================================================ */

let currentDate = new Date();
let currentView = 'day';
let roomFilter  = 'all';
let rooms       = [];
let allBookings = [];
let allBlocks   = [];

const HOUR_PX    = 64;   // height of one hour in the grid
const DEF_START  = 8;    // default first hour shown
const DEF_END    = 18;   // default last hour shown
const ROOM_COLORS = [
  { fg: '#1C2D3C', bg: 'rgba(28,45,60,.11)',   bd: '#1C2D3C' },
  { fg: '#4C6B52', bg: 'rgba(76,107,82,.13)',  bd: '#4C6B52' },
  { fg: '#8A6A1E', bg: 'rgba(185,150,60,.16)', bd: '#B9963C' },
  { fg: '#7A3E3E', bg: 'rgba(160,80,80,.12)',  bd: '#A05050' },
  { fg: '#2F6277', bg: 'rgba(47,98,119,.13)',  bd: '#2F6277' },
  { fg: '#5B4B7A', bg: 'rgba(91,75,122,.13)',  bd: '#5B4B7A' }
];

function roomColor(id) {
  const i = rooms.findIndex(r => r.id === id);
  return ROOM_COLORS[(i < 0 ? 0 : i) % ROOM_COLORS.length];
}
function roomName(id) { const r = rooms.find(x => x.id === id); return r ? r.name : ''; }
function toMin(t) { const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0); }
function pad2(n) { return String(n).padStart(2, '0'); }
function hhmm(mins) { return pad2(Math.floor(mins / 60)) + ':' + pad2(mins % 60); }

// ── INIT ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('prevBtn').addEventListener('click', () => navigate(-1));
  document.getElementById('nextBtn').addEventListener('click', () => navigate(1));
  document.getElementById('todayBtn').addEventListener('click', () => { currentDate = new Date(); render(); });
  document.getElementById('btnDay').addEventListener('click',  () => setView('day'));
  document.getElementById('btnWeek').addEventListener('click', () => setView('week'));
  document.getElementById('modalClose').addEventListener('click', () => closeModal('bookingModal'));
  document.getElementById('modalCloseBtn').addEventListener('click', () => closeModal('bookingModal'));

  try {
    const { data } = await GET('/rooms');
    rooms = (data || []).slice().sort((a, b) => (b.capacity || 0) - (a.capacity || 0));
  } catch (e) { rooms = []; }
  const q = new URLSearchParams(location.search).get('room');
  if (q && rooms.some(r => r.id === q)) roomFilter = q;
  renderFilter();
  render();
});

function navigate(dir) {
  currentDate.setDate(currentDate.getDate() + (currentView === 'day' ? dir : dir * 7));
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
  renderFilter();
  renderGrid();
}

function renderFilter() {
  const box = document.getElementById('roomFilter');
  const chips = [`<button type="button" class="tl-chip ${roomFilter === 'all' ? 'active' : ''}" onclick="setFilter('all')">جميع الغرف</button>`]
    .concat(rooms.map(r => {
      const c = roomColor(r.id);
      return `<button type="button" class="tl-chip ${roomFilter === r.id ? 'active' : ''}" style="--chip:${c.bd}" onclick="setFilter('${r.id}')"><span class="tl-dot" style="background:${c.bd}"></span>${escHtml(r.name)}</button>`;
    }));
  box.innerHTML = chips.join('');
  const lg = document.getElementById('calLegend');
  if (lg) lg.innerHTML = rooms.map(r => `<span class="tl-key"><span class="tl-dot" style="background:${roomColor(r.id).bd}"></span>${escHtml(r.name)}</span>`).join('')
    + '<span class="tl-key"><span class="tl-dot tl-dot-block"></span>محظور</span>';
}

// ── RENDER ────────────────────────────────────────────────────
async function render() {
  updateTitle();
  const c = document.getElementById('calendarContainer');
  if (!allBookings.length && !allBlocks.length) c.innerHTML = '<div class="empty-state" style="padding:60px 0"><div class="spinner spinner-dark"></div></div>';
  await fetchData();
  renderGrid();
}

function updateTitle() {
  const title = document.getElementById('calTitle');
  if (currentView === 'day') {
    title.textContent = currentDate.toLocaleDateString(AR_LOCALE, { weekday:'long', day:'numeric', month:'long', year:'numeric' });
  } else {
    const start = getWeekStart(currentDate);
    const end   = new Date(start); end.setDate(end.getDate() + 6);
    title.textContent = `${start.toLocaleDateString(AR_LOCALE,{day:'numeric',month:'short'})} ${currentLang() === 'en' ? 'to' : 'إلى'} ${end.toLocaleDateString(AR_LOCALE,{day:'numeric',month:'short',year:'numeric'})}`;
  }
}

async function fetchData() {
  if (currentView === 'day') {
    await fetchDay(currentDate);
  } else {
    const start = getWeekStart(currentDate);
    const jobs = [];
    for (let i = 0; i < 7; i++) { const d = new Date(start); d.setDate(d.getDate() + i); jobs.push(fetchDay(d)); }
    await Promise.all(jobs);
  }
}

async function fetchDay(date) {
  const ds = dateStr(date);
  try {
    const [bRes, blkRes] = await Promise.all([
      GET('/bookings', { date: ds }),
      GET('/admin/blocks', { date: ds }).catch(() => ({ data: [] }))
    ]);
    allBookings = [...allBookings.filter(b => b.date !== ds), ...(bRes.data || [])];
    allBlocks   = [...allBlocks.filter(b => b.date !== ds),   ...(blkRes.data || [])];
  } catch (e) { console.error('Fetch error:', e); }
}

function renderGrid() {
  const container = document.getElementById('calendarContainer');
  if (currentView === 'day') renderDayView(container); else renderWeekView(container);
}

// ── SHARED HELPERS ────────────────────────────────────────────
function visibleRooms() { return roomFilter === 'all' ? rooms : rooms.filter(r => r.id === roomFilter); }

function eventsFor(ds, roomIds) {
  const set = new Set(roomIds);
  const bk = allBookings.filter(b => b.date === ds && b.status === 'confirmed' && set.has(b.room_id))
    .map(b => ({ ...b, type: 'booking' }));
  const bl = allBlocks.filter(b => b.date === ds && set.has(b.room_id)).map(b => ({ ...b, type: 'block' }));
  return bk.concat(bl);
}

function hourRange(evs) {
  let s = DEF_START, e = DEF_END;
  evs.forEach(ev => {
    s = Math.min(s, Math.floor(toMin(ev.start_time) / 60));
    e = Math.max(e, Math.ceil(toMin(ev.end_time) / 60));
  });
  return { s, e: Math.min(e, 24) };
}

// side by side layout for overlapping events
function layout(evs) {
  const items = evs.map(ev => ({ ev, a: toMin(ev.start_time), b: toMin(ev.end_time), lane: 0, lanes: 1 }))
    .sort((x, y) => x.a - y.a || x.b - y.b);
  let cluster = [], end = -1;
  const flush = () => { const n = Math.max(1, ...cluster.map(i => i.lane + 1)); cluster.forEach(i => i.lanes = n); cluster = []; };
  items.forEach(it => {
    if (cluster.length && it.a >= end) { flush(); end = -1; }
    const used = cluster.filter(c => c.b > it.a).map(c => c.lane);
    let l = 0; while (used.includes(l)) l++;
    it.lane = l; cluster.push(it); end = Math.max(end, it.b);
  });
  if (cluster.length) flush();
  return items;
}

function eventHtml(it, s, compact) {
  const ev = it.ev;
  const top = (it.a - s * 60) * HOUR_PX / 60;
  const h = Math.max(22, (it.b - it.a) * HOUR_PX / 60 - 2);
  const w = 100 / it.lanes, left = it.lane * w;
  const pos = `top:${top}px;height:${h}px;width:calc(${w}% - 4px);inset-inline-start:calc(${left}% + 2px);`;
  if (ev.type === 'block') {
    return `<div class="tl-event tl-block" style="${pos}" title="${escHtml(ev.reason)}" onclick="event.stopPropagation();showBlockDetail('${escHtml(ev.reason).replace(/'/g, '&#39;')}')">
      <div class="tl-ev-title">محظور</div>${h > 40 ? `<div class="tl-ev-sub">${escHtml(ev.reason)}</div>` : ''}</div>`;
  }
  const c = roomColor(ev.room_id);
  const style = `${pos}background-color:#fff;background-image:linear-gradient(${c.bg},${c.bg});color:${c.fg};border-color:${c.bd};`;
  const sub = compact
    ? `<div class="tl-ev-sub">${escHtml(roomName(ev.room_id))}</div>`
    : `<div class="tl-ev-sub">${escHtml(ev.employee_name)}</div>`;
  const time = (!compact && h > 56) ? `<div class="tl-ev-time">${fmtRange(ev.start_time, ev.end_time)}</div>` : '';
  return `<div class="tl-event" style="${style}" title="${escHtml(ev.purpose)}" onclick="event.stopPropagation();showBookingDetail('${ev.id}')">
    <div class="tl-ev-title">${escHtml(ev.purpose)}</div>${h > 36 ? sub : ''}${time}</div>`;
}

function hourLabels(s, e) {
  let out = '';
  for (let h = s; h < e; h++) out += `<div class="tl-hour" style="height:${HOUR_PX}px"><span>${fmt12(pad2(h) + ':00')}</span></div>`;
  return out;
}

function nowLine(ds, s, e) {
  if (ds !== todayStr()) return '';
  const n = new Date(), m = n.getHours() * 60 + n.getMinutes();
  if (m < s * 60 || m > e * 60) return '';
  const top = (m - s * 60) * HOUR_PX / 60;
  return `<div class="tl-past" style="height:${top}px"></div><div class="tl-now" style="top:${top}px"></div>`;
}

function pastShade(ds, s) {
  if (ds < todayStr()) return `<div class="tl-past" style="height:100%"></div>`;
  return '';
}

// ── DAY VIEW ──────────────────────────────────────────────────
function renderDayView(container) {
  const ds = dateStr(currentDate);
  const vr = visibleRooms();
  if (!vr.length) { container.innerHTML = '<div class="empty-state" style="padding:48px">لا توجد غرف</div>'; return; }
  const ids = vr.map(r => r.id);
  const evs = eventsFor(ds, ids);
  const { s, e } = hourRange(evs);
  const total = (e - s) * HOUR_PX;

  const head = `<div class="tl-head" style="grid-template-columns:72px repeat(${vr.length},1fr)">
    <div class="tl-corner">الوقت</div>
    ${vr.map(r => { const c = roomColor(r.id); return `<div class="tl-roomhead" style="border-top-color:${c.bd}"><span class="tl-dot" style="background:${c.bd}"></span><b>${escHtml(r.name)}</b><small>${escHtml(String(r.capacity))} <span>أشخاص</span></small></div>`; }).join('')}
  </div>`;

  const cols = vr.map(r => {
    const its = layout(evs.filter(x => x.room_id === r.id));
    return `<div class="tl-col" style="height:${total}px" onclick="colClick(event,'${ds}','${r.id}',${s})">
      ${nowLine(ds, s, e)}${ds < todayStr() ? pastShade(ds, s) : ''}
      ${its.map(it => eventHtml(it, s, false)).join('')}
    </div>`;
  }).join('');

  const empty = !evs.length ? '<div class="tl-empty">لا توجد حجوزات في هذا اليوم، اضغط على أي وقت لإنشاء حجز.</div>' : '';
  container.innerHTML = head + empty + `<div class="tl-body" style="grid-template-columns:72px repeat(${vr.length},1fr)">
    <div class="tl-times" style="height:${total}px">${hourLabels(s, e)}</div>${cols}</div>`;
  scrollToNow(container, ds, s);
}

function scrollToNow(container, ds, s) {
  const body = container.querySelector('.tl-body'); if (!body) return;
  if (ds === todayStr()) { const m = new Date().getHours() * 60; body.scrollTop = Math.max(0, (m - s * 60) * HOUR_PX / 60 - 120); }
  else body.scrollTop = 0;
}

function colClick(ev, ds, roomId, s) {
  const rect = ev.currentTarget.getBoundingClientRect();
  const y = ev.clientY - rect.top;
  const mins = Math.floor((y * 60 / HOUR_PX) / 30) * 30 + s * 60;
  goBook(ds, hhmm(mins), roomId);
}

function goBook(date, time, roomId) {
  if (new Date(`${date}T${time}:00`) <= new Date()) { showToast('info', 'وقت مضى', 'لا يمكن الحجز في وقت مضى.'); return; }
  const params = new URLSearchParams({ date, time, room: roomId || '' });
  window.location.href = `/book?${params}`;
}

// ── WEEK VIEW ─────────────────────────────────────────────────
function renderWeekView(container) {
  const start = getWeekStart(currentDate);
  const days = [];
  for (let i = 0; i < 7; i++) { const d = new Date(start); d.setDate(d.getDate() + i); days.push(d); }
  const vr = visibleRooms();
  if (!vr.length) { container.innerHTML = '<div class="empty-state" style="padding:48px">لا توجد غرف</div>'; return; }
  const ids = vr.map(r => r.id);
  const per = days.map(d => eventsFor(dateStr(d), ids));
  const { s, e } = hourRange([].concat(...per));
  const total = (e - s) * HOUR_PX;
  const today = todayStr();

  const head = `<div class="tl-head" style="grid-template-columns:72px repeat(7,1fr)">
    <div class="tl-corner">الوقت</div>
    ${days.map(d => { const ds = dateStr(d), td = ds === today;
      return `<div class="tl-dayhead ${td ? 'today' : ''}"><span>${d.toLocaleDateString(AR_LOCALE, { weekday: 'short' })}</span><b>${d.getDate()}</b></div>`; }).join('')}
  </div>`;

  const cols = days.map((d, i) => {
    const ds = dateStr(d);
    return `<div class="tl-col ${ds === today ? 'today' : ''}" style="height:${total}px" onclick="weekClick(event,'${ds}',${s})">
      ${nowLine(ds, s, e)}${ds < today ? pastShade(ds, s) : ''}
      ${layout(per[i]).map(it => eventHtml(it, s, true)).join('')}
    </div>`;
  }).join('');

  container.innerHTML = head + `<div class="tl-body" style="grid-template-columns:72px repeat(7,1fr)">
    <div class="tl-times" style="height:${total}px">${hourLabels(s, e)}</div>${cols}</div>`;
  scrollToNow(container, today, s);
}

function weekClick(ev, ds, s) {
  const rect = ev.currentTarget.getBoundingClientRect();
  const mins = Math.floor(((ev.clientY - rect.top) * 60 / HOUR_PX) / 30) * 30 + s * 60;
  goBook(ds, hhmm(mins), roomFilter === 'all' ? '' : roomFilter);
}

async function showBookingDetail(id) {
  try {
    const { data: b } = await GET(`/bookings/${id}`);
    document.getElementById('modalTitle').textContent = b.purpose;
    document.getElementById('modalContent').innerHTML = `
      <div class="booking-detail-row"><div class="detail-label">الغرفة</div><div class="detail-value">${b.room_name}</div></div>
      <div class="booking-detail-row"><div class="detail-label">التاريخ</div><div class="detail-value">${fmtDateLong(b.date)}</div></div>
      <div class="booking-detail-row"><div class="detail-label">الوقت</div><div class="detail-value">${fmtRange(b.start_time, b.end_time)}</div></div>
      <div class="booking-detail-row"><div class="detail-label">المدة</div><div class="detail-value">${fmtDuration(b.duration)}</div></div>
      <div class="booking-detail-row"><div class="detail-label">المنظم</div><div class="detail-value">${escHtml(b.employee_name)}</div></div>
      <div class="booking-detail-row"><div class="detail-label">الفئة</div><div class="detail-value">${categoryLabel(b.category)}</div></div>
      ${b.notes ? `<div class="booking-detail-row"><div class="detail-label">ملاحظات</div><div class="detail-value">${escHtml(b.notes)}</div></div>` : ''}
      <div style="margin-top:10px;">${statusBadge(b.status)}</div>`;
    openModal('bookingModal');
  } catch (e) {
    showToast('error', 'خطأ', 'تعذّر تحميل تفاصيل الحجز.');
  }
}

function showBlockDetail(reason) {
  document.getElementById('modalTitle').textContent = 'وقت محظور';
  document.getElementById('modalContent').innerHTML = `
    <div class="booking-detail-row"><div class="detail-label">الحالة</div><div class="detail-value"><span class="badge badge-blocked">محظور من الإدارة</span></div></div>
    <div class="booking-detail-row"><div class="detail-label">السبب</div><div class="detail-value">${escHtml(reason)}</div></div>`;
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
