/* ============================================================
   OAKTREE — حجز غرفة (booking.js)
   ============================================================ */

let selectedRoom     = null;
let selectedDuration = null;
let selectedTime     = null;
let currentSlots     = [];
let roomsById        = {};
let attendees        = [];   // [{ name, email }]
let knownPeople      = [];   // [{ name, email }] seen in earlier bookings

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FALLBACK_ROOMS = {
  oak_room:  { name: 'قاعة الاجتماعات', capacity: 12 },
  tree_room: { name: 'غرفة الاجتماعات', capacity: 4 }
};

function esc(str) {
  return String(str == null ? '' : str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function roomName(id)     { return (roomsById[id] || FALLBACK_ROOMS[id] || {}).name || id; }
function roomCapacity(id) { return (roomsById[id] || FALLBACK_ROOMS[id] || {}).capacity || 0; }

// ── INIT ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  wireCategoryOther('meetingCategory', 'categoryOther');
  setMinDateToday('bookingDate');

  // Room selector
  document.querySelectorAll('.room-option').forEach(opt => {
    opt.addEventListener('click', () => chooseRoom(opt.dataset.room));
  });

  // Duration pills
  document.querySelectorAll('#durationPills .duration-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('#durationPills .duration-pill').forEach(p => p.classList.remove('selected'));
      pill.classList.add('selected');
      selectedDuration = parseInt(pill.dataset.duration);
      document.getElementById('selectedDuration').value = selectedDuration;
      clearError('durationError');
      resetTime();
      maybeLoadSlots();
      loadDaySchedule();
      updateSummary();
    });
  });

  // Date change
  document.getElementById('bookingDate').addEventListener('change', () => {
    clearError('dateError');
    resetTime();
    maybeLoadSlots();
    loadDaySchedule();
    updateSummary();
  });

  document.getElementById('employeeEmail').addEventListener('input', renderSuggestions);

  document.getElementById('bookingForm').addEventListener('submit', handleSubmit);
  document.getElementById('successClose').addEventListener('click', () => {
    document.getElementById('successBanner').classList.add('hidden');
  });

  initAttendeePicker();

  // Real room data (names / capacity)
  try {
    const { data } = await GET('/rooms');
    roomsById = Object.fromEntries(data.map(r => [r.id, r]));
    updateAttendeeHint();
  } catch { /* fall back to defaults */ }

  // Pre-fill from the calendar (?date=&time=&room=)
  const q = new URLSearchParams(location.search);
  if (q.get('date')) { document.getElementById('bookingDate').value = q.get('date'); loadDaySchedule(); }
  if (q.get('room') && FALLBACK_ROOMS[q.get('room')]) chooseRoom(q.get('room'));
});

function resetTime() {
  selectedTime = null;
  document.getElementById('selectedTime').value = '';
}

function chooseRoom(id) {
  document.querySelectorAll('.room-option').forEach(o => o.classList.toggle('selected', o.dataset.room === id));
  selectedRoom = id;
  document.getElementById('selectedRoom').value = id;
  clearError('roomError');
  clearError('timeError');
  resetTime();
  maybeLoadSlots();
  updateSummary();
  updateAttendeeHint();
}

// ── DAY SCHEDULE (who booked what + what is free) ─────────────
async function loadDaySchedule() {
  const date = document.getElementById('bookingDate').value;
  const box  = document.getElementById('daySchedule');
  if (!date) { box.innerHTML = ''; return; }
  try {
    const params = { date };
    if (selectedDuration) params.duration = selectedDuration;
    const { data } = await GET('/rooms/schedule', params);
    renderDaySchedule(data, null);
  } catch { box.innerHTML = ''; }
}

function renderDaySchedule(rooms, conflict) {
  const box  = document.getElementById('daySchedule');
  const date = document.getElementById('bookingDate').value;

  const conflictHtml = conflict ? `<div class="ds-conflict">
      ${conflict.type === 'booking'
        ? `هذا الوقت محجوز من <strong>${esc(conflict.employee_name)}</strong> لاجتماع «${esc(conflict.purpose)}» (${fmtRange(conflict.start_time, conflict.end_time)}).`
        : `هذا الوقت محظور من الإدارة (${esc(conflict.reason)}).`}
      اختر أحد الأوقات المتاحة أدناه.
    </div>` : '';

  box.innerHTML = `<div class="day-schedule">
    ${conflictHtml}
    <div class="ds-title">حجوزات ${esc(fmtDateLong(date))}</div>
    <div class="ds-grid">
      ${rooms.map(r => `<div class="ds-room">
        <div class="ds-room-head"><strong>${esc(r.name)}</strong><span class="ds-cap">تتسع لـ ${r.capacity}</span></div>

        <div class="ds-label">الحجوزات</div>
        ${(r.bookings.length || r.blocks.length) ? `<div class="ds-list">
          ${r.bookings.map(b => `<div class="ds-booking">
              <span class="ds-time">${fmtRange(b.start_time, b.end_time)}</span>
              <span class="ds-name">${esc(b.purpose)}</span>
              <span class="ds-by">${esc(b.employee_name)}</span>
            </div>`).join('')}
          ${r.blocks.map(b => `<div class="ds-booking blocked">
              <span class="ds-time">${fmtRange(b.start_time, b.end_time)}</span>
              <span class="ds-name">محظور: ${esc(b.reason)}</span>
            </div>`).join('')}
        </div>` : '<div class="ds-empty">لا توجد حجوزات</div>'}

        <div class="ds-label">${selectedDuration ? `أوقات البداية المتاحة (${fmtDuration(selectedDuration)})` : 'الأوقات المتاحة'}</div>
        ${renderFree(r)}
      </div>`).join('')}
    </div>
  </div>`;

  box.querySelectorAll('.free-chip').forEach(btn => {
    btn.addEventListener('click', () => pickSuggestion(btn.dataset.room, btn.dataset.time));
  });
  if (conflict) box.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function renderFree(r) {
  if (selectedDuration) {
    if (!r.starts.length) return '<div class="ds-empty">لا يوجد وقت متاح بهذه المدة</div>';
    return `<div class="ds-chips">${r.starts.map(t =>
      `<button type="button" class="free-chip" data-room="${r.id}" data-time="${t}">${fmt12(t)}</button>`).join('')}</div>`;
  }
  if (!r.free.length) return '<div class="ds-empty">لا توجد أوقات متاحة</div>';
  return `<div class="ds-chips">${r.free.map(w =>
    `<button type="button" class="free-chip" data-room="${r.id}" data-time="${w.start_time}">${fmtRange(w.start_time, w.end_time)}</button>`).join('')}</div>`;
}

async function pickSuggestion(roomId, time) {
  chooseRoom(roomId);
  if (!selectedDuration) {
    showToast('info', 'اختر المدة', 'اختر مدة الاجتماع لتحديد الوقت.');
    return;
  }
  await maybeLoadSlots();
  const btn = document.querySelector(`#timeSlotsContainer .time-slot-btn[data-time="${time}"]`);
  if (btn && !btn.disabled) selectTime(time, btn);
  document.getElementById('timeSlotsContainer').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ── SLOT LOADING ──────────────────────────────────────────────
async function maybeLoadSlots() {
  const date = document.getElementById('bookingDate').value;
  if (!selectedRoom || !date || !selectedDuration) return;
  await loadTimeSlots(selectedRoom, date, selectedDuration);
}

async function loadTimeSlots(roomId, date, duration) {
  const container = document.getElementById('timeSlotsContainer');
  container.innerHTML = `<div style="padding:16px;text-align:center;"><div class="spinner spinner-dark"></div></div>`;

  try {
    const { data } = await GET(`/rooms/${roomId}/availability`, { date });
    currentSlots = data.slots || [];

    if (!currentSlots.length) {
      container.innerHTML = `<div class="empty-state" style="padding:24px;background:var(--beige);border-radius:var(--radius-md)">
        <div class="empty-state-title">لا توجد أوقات متاحة</div>
        <div class="empty-state-desc">لا توجد أوقات في هذا التاريخ. جرّب تاريخاً آخر.</div>
      </div>`;
      return;
    }

    const durationMins = parseInt(duration);
    const slots = buildDurationSlots(currentSlots, durationMins, data.officeEnd);

    if (!slots.length) {
      container.innerHTML = `<div class="empty-state" style="padding:24px;background:var(--beige);border-radius:var(--radius-md)">
        <div class="empty-state-title">لا توجد أوقات تتسع لـ ${fmtDuration(durationMins)}</div>
        <div class="empty-state-desc">لا توجد فترات متصلة بالمدة المطلوبة. جرّب مدة أقصر أو تاريخاً آخر.</div>
      </div>`;
      return;
    }

    container.innerHTML = `<div class="time-slots-grid">
      ${slots.map(s => {
        let cls = '', disabled = false, title = '';
        if (s.status === 'available') { cls = ''; }
        else if (s.status === 'booked') {
          cls = 'booked'; disabled = true;
          title = s.booking ? `محجوز: ${s.booking.purpose} (${s.booking.employee_name})` : 'محجوز مسبقاً';
        }
        else if (s.status === 'blocked') { cls = 'blocked'; disabled = true; title = s.block ? `محظور: ${s.block.reason}` : 'محظور من الإدارة'; }
        else if (s.status === 'past')    { cls = 'past'; disabled = true; title = 'انتهى هذا الوقت'; }
        else                             { cls = 'booked'; disabled = true; }

        if (s.time === selectedTime && !disabled) cls = 'selected';

        return `<button type="button" class="time-slot-btn ${cls}" data-time="${s.time}"
          ${disabled ? 'disabled' : ''} title="${esc(title)}" onclick="selectTime('${s.time}', this)">
          ${fmt12(s.time)}
        </button>`;
      }).join('')}
    </div>`;
  } catch (e) {
    container.innerHTML = `<div style="padding:16px;color:var(--danger);font-size:13px;">تعذّر تحميل الأوقات، حاول مرة أخرى.</div>`;
  }
}

function buildDurationSlots(baseSlots, durationMins, officeEnd) {
  const results = [];
  const intervalMins = 30;

  for (let i = 0; i < baseSlots.length; i++) {
    const slot = baseSlots[i];
    const slotsNeeded = Math.ceil(durationMins / intervalMins);
    let feasible = true;
    let worst = slot;

    for (let j = 0; j < slotsNeeded; j++) {
      const s = baseSlots[i + j];
      if (!s) { feasible = false; break; }
      if (s.status === 'booked' || s.status === 'blocked') { worst = s; break; }
      if (s.status === 'past') worst = s;
    }

    const [h, m] = slot.time.split(':').map(Number);
    const endMins = h * 60 + m + durationMins;
    const endStr = `${String(Math.floor(endMins / 60)).padStart(2,'0')}:${String(endMins % 60).padStart(2,'0')}`;
    if (endStr > officeEnd) feasible = false;

    if (feasible) {
      results.push({ ...slot, status: worst.status, booking: worst.booking || slot.booking, block: worst.block || slot.block });
    }
  }
  return results;
}

function selectTime(time, btn) {
  document.querySelectorAll('.time-slot-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  selectedTime = time;
  document.getElementById('selectedTime').value = time;
  clearError('timeError');
  updateSummary();
}

// ── ATTENDEES ─────────────────────────────────────────────────
function initAttendeePicker() {
  const input = document.getElementById('attendeeInput');
  const box   = document.getElementById('attendeeBox');
  box.addEventListener('click', () => input.focus());

  input.addEventListener('input', renderSuggestions);
  input.addEventListener('focus', loadPeopleOnce);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
      const v = input.value.trim().replace(/,$/, '');
      if (!v) { if (e.key === 'Enter') e.preventDefault(); return; }
      e.preventDefault();
      if (EMAIL_RE.test(v)) { addAttendee({ name: '', email: v }); return; }
      const first = suggestionsFor(v)[0];
      if (first) addAttendee(first);
      else if (e.key === 'Enter') showAttendeeError('اكتب بريداً إلكترونياً صحيحاً أو اختر من القائمة.');
    } else if (e.key === 'Backspace' && !input.value && attendees.length) {
      removeAttendee(attendees.length - 1);
    }
  });
  input.addEventListener('blur', () => {
    setTimeout(() => {
      const v = input.value.trim();
      if (v && EMAIL_RE.test(v)) addAttendee({ name: '', email: v });
      document.getElementById('attendeeSuggest').classList.add('hidden');
    }, 150);
  });
  renderChips();
}

let peopleLoaded = false;
async function loadPeopleOnce() {
  if (peopleLoaded) return;
  peopleLoaded = true;
  try { knownPeople = (await GET('/bookings/people')).data || []; } catch { /* optional */ }
  renderSuggestions();
}

function suggestionsFor(q) {
  q = (q || '').trim().toLowerCase();
  const own = document.getElementById('employeeEmail').value.trim().toLowerCase();
  const taken = new Set(attendees.map(a => a.email));
  return knownPeople
    .filter(p => p.email !== own && !taken.has(p.email))
    .filter(p => !q || p.email.includes(q) || (p.name || '').toLowerCase().includes(q))
    .slice(0, 6);
}

function renderSuggestions() {
  const input = document.getElementById('attendeeInput');
  const list  = document.getElementById('attendeeSuggest');
  if (document.activeElement !== input) { list.classList.add('hidden'); return; }
  const items = suggestionsFor(input.value);
  if (!items.length) { list.classList.add('hidden'); return; }
  list.innerHTML = items.map((p, i) => `<button type="button" class="suggest-item" data-i="${i}">
      <span class="suggest-name">${esc(p.name || p.email)}</span>
      ${p.name ? `<span class="suggest-email">${esc(p.email)}</span>` : ''}
    </button>`).join('');
  list.classList.remove('hidden');
  list.querySelectorAll('.suggest-item').forEach(btn => {
    btn.addEventListener('mousedown', e => {
      e.preventDefault();
      addAttendee(items[parseInt(btn.dataset.i)]);
    });
  });
}

function maxAttendees() {
  const cap = selectedRoom ? roomCapacity(selectedRoom) : 0;
  return cap ? cap - 1 : Infinity;   // organizer takes one seat
}

function addAttendee(p) {
  const email = String(p.email || '').trim().toLowerCase();
  const own = document.getElementById('employeeEmail').value.trim().toLowerCase();
  showAttendeeError('');
  if (!EMAIL_RE.test(email)) return showAttendeeError('البريد الإلكتروني غير صحيح.');
  if (email === own)         return showAttendeeError('أنت المنظم، لا حاجة لإضافة نفسك.');
  if (attendees.some(a => a.email === email)) { document.getElementById('attendeeInput').value = ''; return; }
  if (attendees.length >= maxAttendees()) {
    return showAttendeeError(`سعة الغرفة ${roomCapacity(selectedRoom)} أشخاص شاملةً المنظم.`);
  }
  attendees.push({ name: (p.name || '').trim(), email });
  document.getElementById('attendeeInput').value = '';
  renderChips();
  renderSuggestions();
  updateSummary();
}

function removeAttendee(i) {
  attendees.splice(i, 1);
  showAttendeeError('');
  renderChips();
  updateSummary();
}

function renderChips() {
  const wrap = document.getElementById('attendeeChips');
  wrap.innerHTML = attendees.map((a, i) => `<span class="attendee-chip" title="${esc(a.email)}">
      <span>${esc(a.name || a.email)}</span>
      <button type="button" aria-label="إزالة" onclick="event.stopPropagation();removeAttendee(${i})">&times;</button>
    </span>`).join('');
  updateAttendeeHint();
}

function updateAttendeeHint() {
  const el = document.getElementById('attendeeHint');
  if (!el) return;
  const cap = selectedRoom ? roomCapacity(selectedRoom) : 0;
  const count = attendees.length + 1;
  el.textContent = 'سيصل كل مشارك دعوة اجتماع على بريده الإلكتروني تُضاف إلى تقويمه.'
    + (cap ? ` عدد الحاضرين ${count} من ${cap}.` : '');
}

function showAttendeeError(msg) {
  const el = document.getElementById('attendeeError');
  el.textContent = msg;
  el.style.display = msg ? 'block' : 'none';
}

// ── SUMMARY ───────────────────────────────────────────────────
function updateSummary() {
  const summary = document.getElementById('bookingSummary');

  if (selectedRoom && document.getElementById('bookingDate').value && selectedDuration && selectedTime) {
    summary.classList.remove('hidden');
    const date = document.getElementById('bookingDate').value;
    const [h, m] = selectedTime.split(':').map(Number);
    const endMins = h * 60 + m + selectedDuration;
    const endStr  = `${String(Math.floor(endMins/60)).padStart(2,'0')}:${String(endMins%60).padStart(2,'0')}`;

    document.getElementById('sumRoom').textContent     = roomName(selectedRoom);
    document.getElementById('sumDate').textContent     = fmtDateLong(date);
    document.getElementById('sumTime').textContent     = fmtRange(selectedTime, endStr);
    document.getElementById('sumDuration').textContent = fmtDuration(selectedDuration);
    document.getElementById('sumAttendees').textContent = attendees.length
      ? attendees.map(a => a.name || a.email).join('، ')
      : 'بدون مشاركين';
  } else {
    summary.classList.add('hidden');
  }
}

// ── VALIDATION ────────────────────────────────────────────────
function showError(id) { document.getElementById(id).style.display = 'block'; }
function clearError(id) { const el = document.getElementById(id); if (el) el.style.display = 'none'; }

function validate() {
  let valid = true;
  const name  = document.getElementById('employeeName').value.trim();
  const email = document.getElementById('employeeEmail').value.trim();
  const date  = document.getElementById('bookingDate').value;
  const purpose = document.getElementById('meetingPurpose').value.trim();

  if (!name)    { showError('nameError');     valid = false; }
  if (!email || !EMAIL_RE.test(email)) { showError('emailError'); valid = false; }
  if (!selectedRoom)     { showError('roomError');     valid = false; }
  if (!date)             { showError('dateError');     valid = false; }
  if (!selectedDuration) { showError('durationError'); valid = false; }
  if (!selectedTime)     { showError('timeError');     valid = false; }
  if (!purpose)          { showError('purposeError');  valid = false; }
  return valid;
}

// ── SUBMIT ────────────────────────────────────────────────────
const CONFIRM_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`;

async function handleSubmit(e) {
  e.preventDefault();
  // a half-typed invitee address still counts
  const pending = document.getElementById('attendeeInput').value.trim();
  if (pending && EMAIL_RE.test(pending)) addAttendee({ name: '', email: pending });

  if (!validate()) {
    showToast('error', 'يرجى مراجعة النموذج', 'بعض الحقول المطلوبة ناقصة أو غير صحيحة.');
    return;
  }

  const btn = document.getElementById('submitBtn');
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner"></div> جارٍ الحجز…';

  try {
    const payload = {
      employee_name:  document.getElementById('employeeName').value.trim(),
      employee_email: document.getElementById('employeeEmail').value.trim(),
      room_id:   selectedRoom,
      date:      document.getElementById('bookingDate').value,
      start_time:selectedTime,
      duration:  selectedDuration,
      purpose:   document.getElementById('meetingPurpose').value.trim(),
      category:  categoryValue('meetingCategory', 'categoryOther'),
      notes:     document.getElementById('meetingNotes').value.trim(),
      attendees
    };

    const { data } = await POST('/bookings', payload);
    const name = roomName(data.room_id) || data.room_name;
    const invited = attendees.length;

    const banner = document.getElementById('successBanner');
    document.getElementById('successMsg').textContent =
      `تم حجز ${name} يوم ${fmtDate(data.date)} ${fmtRange(data.start_time, data.end_time)}. أُرسل التأكيد إلى ${data.employee_email}`
      + (invited ? ` وأُرسلت دعوات الاجتماع إلى ${invited} ${invited === 1 ? 'مشارك' : 'مشاركين'}.` : '.');
    banner.classList.remove('hidden');
    banner.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    setTimeout(() => banner.classList.add('hidden'), 8000);

    showToast('success', 'تم تأكيد الحجز!', `${name} محجوزة الساعة ${fmt12(data.start_time)}.`);
    resetForm();
  } catch (err) {
    showToast('error', 'تعذّر الحجز', err.message);
    // Time taken meanwhile: show who has it and what is still free
    if (err.data && err.data.schedule) {
      renderDaySchedule(err.data.schedule, err.data.conflict);
      resetTime();
      maybeLoadSlots();
    }
  } finally {
    btn.disabled = false;
    btn.innerHTML = `${CONFIRM_ICON} تأكيد الحجز`;
  }
}

function resetForm() {
  document.getElementById('bookingForm').reset();
  const co = document.getElementById('categoryOther'); if (co) { co.style.display = 'none'; co.value = ''; }
  selectedRoom = null;
  selectedDuration = null;
  selectedTime = null;
  attendees = [];
  document.getElementById('selectedRoom').value = '';
  document.getElementById('selectedDuration').value = '';
  document.getElementById('selectedTime').value = '';
  document.querySelectorAll('.room-option').forEach(o => o.classList.remove('selected'));
  document.querySelectorAll('#durationPills .duration-pill').forEach(p => p.classList.remove('selected'));
  document.getElementById('daySchedule').innerHTML = '';
  document.getElementById('timeSlotsContainer').innerHTML = `<div class="empty-state" style="padding:24px 0;background:var(--beige);border-radius:var(--radius-md)">
    <div class="empty-state-icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div>
    <div class="empty-state-title">اختر الغرفة والتاريخ والمدة أولاً</div>
    <div class="empty-state-desc">ستظهر الأوقات المتاحة هنا بعد اختيار الغرفة والتاريخ والمدة.</div>
  </div>`;
  document.getElementById('bookingSummary').classList.add('hidden');
  showAttendeeError('');
  renderChips();
  setMinDateToday('bookingDate');
}
