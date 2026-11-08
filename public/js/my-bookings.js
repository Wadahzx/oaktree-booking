/* ============================================================
   OAKTREE — My Bookings (my-bookings.js)
   ============================================================ */

let currentEmail     = '';
let cancelTargetId   = '';
let editBookingData  = null;
let editSelectedTime = null;
let editSelectedDur  = null;

// ── INIT ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  wireCategoryOther('editCategory', 'editCategoryOther');
  // Resume a verified session, otherwise show the email step
  const s = getSession();
  if (s) { currentEmail = s.email; lookupBookings(); }
  else {
    const q = new URLSearchParams(window.location.search).get('email');
    if (q) document.getElementById('lookupEmail').value = q;
  }

  // Cancel modal
  document.getElementById('cancelNoBtn').addEventListener('click',  () => closeModal('cancelModal'));
  document.getElementById('cancelModalClose').addEventListener('click', () => closeModal('cancelModal'));
  document.getElementById('cancelYesBtn').addEventListener('click', confirmCancel);

  // Edit modal
  document.getElementById('editCancelBtn').addEventListener('click', () => closeModal('editModal'));
  document.getElementById('editModalClose').addEventListener('click', () => closeModal('editModal'));
  document.getElementById('editSaveBtn').addEventListener('click', saveEdit);

  // Edit duration pills
  document.querySelectorAll('#editDurationPills .duration-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('#editDurationPills .duration-pill').forEach(p => p.classList.remove('selected'));
      pill.classList.add('selected');
      editSelectedDur = parseInt(pill.dataset.duration);
      document.getElementById('editDuration').value = editSelectedDur;
      loadEditSlots();
    });
  });

  document.getElementById('editDate').addEventListener('change', loadEditSlots);
});

// ── EMAIL CODE LOGIN ──────────────────────────────────────────
const SESSION_KEY = 'oaktreeUser';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
let resendTimer = null;

function getSession() {
  try {
    const s = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
    return s && s.token && s.exp > Date.now() ? s : null;
  } catch (e) { return null; }
}

function logout(silent) {
  sessionStorage.removeItem(SESSION_KEY);
  currentEmail = '';
  clearInterval(resendTimer);
  document.getElementById('bookingsContent').classList.add('hidden');
  document.getElementById('lookupCard').style.display = '';
  document.getElementById('codeStep').style.display = 'none';
  document.getElementById('emailStep').style.display = 'flex';
  document.getElementById('lookupEmail').value = '';
  document.getElementById('loginCode').value = '';
  document.getElementById('authDesc').textContent = 'أدخل بريدك الإلكتروني وسنرسل لك رمز تحقق لعرض حجوزاتك وإدارتها.';
  if (!silent) showToast('info', 'تم تسجيل الخروج', 'أُغلقت جلسة حجوزاتك.');
}

function startResendCountdown() {
  const btn = document.getElementById('resendBtn');
  let left = 60;
  clearInterval(resendTimer);
  btn.disabled = true;
  const tick = () => {
    btn.textContent = left > 0 ? `إعادة الإرسال بعد ${left} ثانية` : 'إعادة إرسال الرمز';
    if (left <= 0) { btn.disabled = false; clearInterval(resendTimer); }
    left--;
  };
  tick();
  resendTimer = setInterval(tick, 1000);
}

async function requestCode(isResend) {
  const emailEl = document.getElementById('lookupEmail');
  const errEl = document.getElementById('lookupError');
  const email = (emailEl.value || currentEmail).trim().toLowerCase();
  if (!EMAIL_RE.test(email)) { errEl.style.display = 'block'; return; }
  errEl.style.display = 'none';

  const btn = document.getElementById(isResend === true ? 'resendBtn' : 'lookupBtn');
  btn.disabled = true;
  const old = btn.textContent;
  btn.textContent = 'جارٍ الإرسال…';
  try {
    await POST('/bookings/auth/request', { email });
    currentEmail = email;
    document.getElementById('emailStep').style.display = 'none';
    document.getElementById('codeStep').style.display = 'block';
    document.getElementById('authDesc').textContent = `أرسلنا رمز التحقق إلى ${email}. أدخله هنا لعرض حجوزاتك.`;
    document.getElementById('loginCode').value = '';
    document.getElementById('codeError').style.display = 'none';
    document.getElementById('loginCode').focus();
    startResendCountdown();
    if (isResend === true) showToast('success', 'تم الإرسال', 'أرسلنا رمزاً جديداً إلى بريدك.');
  } catch (e) {
    if (isResend === true) { btn.disabled = false; btn.textContent = old; }
    showToast('error', 'تعذّر الإرسال', e.message);
  } finally {
    if (isResend !== true) { btn.disabled = false; btn.textContent = old; }
  }
}

function changeEmail() {
  clearInterval(resendTimer);
  document.getElementById('codeStep').style.display = 'none';
  document.getElementById('emailStep').style.display = 'flex';
  document.getElementById('lookupEmail').value = currentEmail;
  document.getElementById('authDesc').textContent = 'أدخل بريدك الإلكتروني وسنرسل لك رمز تحقق لعرض حجوزاتك وإدارتها.';
}

async function verifyCode() {
  const code = document.getElementById('loginCode').value.trim();
  const errEl = document.getElementById('codeError');
  if (!/^\d{6}$/.test(code)) { errEl.textContent = 'أدخل الرمز المكوّن من 6 أرقام.'; errEl.style.display = 'block'; return; }
  errEl.style.display = 'none';
  const btn = document.getElementById('verifyBtn');
  btn.disabled = true; btn.textContent = 'جارٍ التحقق…';
  try {
    const r = await POST('/bookings/auth/verify', { email: currentEmail, code });
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ token: r.token, email: r.email, exp: r.expires }));
    currentEmail = r.email;
    await lookupBookings();
  } catch (e) {
    errEl.textContent = e.message; errEl.style.display = 'block';
  } finally {
    btn.disabled = false; btn.textContent = 'تحقق';
  }
}

// ── LOOKUP (needs a verified session) ─────────────────────────
function handleAuthError(e) {
  if (e && e.data && e.data.need_auth) { logout(true); showToast('error', 'انتهت الجلسة', 'يرجى التحقق من بريدك الإلكتروني مرة أخرى.'); return true; }
  return false;
}

async function lookupBookings() {
  const s = getSession();
  if (!s) { logout(true); return; }
  currentEmail = s.email;
  try {
    const { data: all } = await GET('/bookings', { email: currentEmail });

    document.getElementById('lookupCard').style.display = 'none';
    document.getElementById('bookingsContent').classList.remove('hidden');
    document.getElementById('bookingsHeading').textContent   = 'حجوزاتك';
    document.getElementById('bookingsSubheading').textContent = `عرض الحجوزات المرتبطة بـ ${currentEmail}`;

    const now   = new Date();
    const upcoming = all.filter(b => new Date(`${b.date}T${b.start_time}:00`) > now && b.status === 'confirmed');
    const past = all.filter(b => new Date(`${b.date}T${b.start_time}:00`) <= now || b.status !== 'confirmed');

    renderBookingList('upcomingBookings', upcoming, true);
    renderBookingList('pastBookings', past, false);
  } catch (e) {
    if (!handleAuthError(e)) showToast('error', 'خطأ', e.message);
  }
}

function clearLookup() { logout(false); }

// ── RENDER BOOKING LIST ───────────────────────────────────────
function renderBookingList(containerId, bookings, canEdit) {
  const container = document.getElementById(containerId);

  if (!bookings.length) {
    const isUpcoming = canEdit;
    container.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></div>
      <div class="empty-state-title">${isUpcoming ? 'لا توجد حجوزات قادمة' : 'لا يوجد سجل حجوزات'}</div>
      <div class="empty-state-desc">${isUpcoming ? 'ليس لديك حجوزات قادمة.' : 'ستظهر حجوزاتك السابقة هنا.'}</div>
      ${isUpcoming ? '<a href="/book" class="btn btn-gold mt-2">احجز غرفة</a>' : ''}
    </div>`;
    return;
  }

  const cards = bookings.map(b => buildBookingCard(b, canEdit)).join('');
  container.innerHTML = `<div style="display:flex;flex-direction:column;gap:12px;">${cards}</div>`;
}

function buildBookingCard(b, canEdit) {
  const now = new Date();
  const startDt = new Date(`${b.date}T${b.start_time}:00`);
  const isActive = startDt <= now && new Date(`${b.date}T${b.end_time}:00`) > now;
  const canManage = canEdit && b.status === 'confirmed';
  const roomColor = b.room_id === 'oak_room' ? 'var(--navy)' : 'var(--green)';

  return `<div style="background:var(--white);border:1px solid var(--grey-border);border-radius:var(--radius-md);overflow:hidden;box-shadow:var(--shadow-sm);display:flex;">
    <div style="width:4px;background:${b.status==='confirmed'?roomColor:b.status==='cancelled'?'var(--danger)':'var(--warning)'};flex-shrink:0;"></div>
    <div style="padding:16px 20px;flex:1;min-width:0;">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;">
        <div>
          <div style="font-size:16px;font-weight:700;color:var(--text-primary);margin-bottom:3px;">${escHtml(b.purpose)}</div>
          <div style="font-size:13px;color:var(--text-secondary);margin-bottom:8px;">${b.room_name}، ${categoryLabel(b.category)}</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
          ${isActive ? '<span class="badge badge-in-progress">جارٍ الآن</span>' : statusBadge(b.status)}
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px;margin-bottom:12px;">
        <div style="font-size:13px;color:var(--text-secondary);display:flex;align-items:center;gap:6px;">
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          ${fmtDate(b.date)}
        </div>
        <div style="font-size:13px;color:var(--text-secondary);display:flex;align-items:center;gap:6px;">
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          ${fmtRange(b.start_time, b.end_time)}
        </div>
        <div style="font-size:13px;color:var(--text-secondary);">${fmtDuration(b.duration)}</div>
      </div>
      ${b.notes ? `<div style="font-size:12px;color:var(--text-muted);background:var(--beige);padding:8px 12px;border-radius:4px;margin-bottom:10px;">${escHtml(b.notes)}</div>` : ''}
      ${canManage ? `<div style="display:flex;gap:8px;">
        <button class="btn btn-outline btn-sm" onclick="openEditModal('${b.id}')">
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          تعديل
        </button>
        <button class="btn btn-danger btn-sm" onclick="openCancelModal('${b.id}', '${escHtml(b.purpose)}', '${b.room_name}', '${b.date}', '${b.start_time}', '${b.end_time}')">
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
          إلغاء
        </button>
      </div>` : ''}
    </div>
  </div>`;
}

// ── CANCEL ────────────────────────────────────────────────────
function openCancelModal(id, purpose, room, date, start, end) {
  cancelTargetId = id;
  document.getElementById('cancelDetail').innerHTML = `
    <div class="booking-detail-row"><div class="detail-label">الاجتماع</div><div class="detail-value">${escHtml(purpose)}</div></div>
    <div class="booking-detail-row"><div class="detail-label">الغرفة</div><div class="detail-value">${escHtml(room)}</div></div>
    <div class="booking-detail-row"><div class="detail-label">التاريخ</div><div class="detail-value">${fmtDate(date)}</div></div>
    <div class="booking-detail-row"><div class="detail-label">الوقت</div><div class="detail-value">${fmtRange(start, end)}</div></div>`;
  openModal('cancelModal');
}

async function confirmCancel() {
  const btn = document.getElementById('cancelYesBtn');
  btn.disabled = true;
  btn.textContent = 'جارٍ الإلغاء…';
  try {
    await DEL(`/bookings/${cancelTargetId}`);
    closeModal('cancelModal');
    showToast('success', 'تم إلغاء الحجز', 'تم إلغاء حجزك.');
    await lookupBookings();
  } catch (e) {
    if (!handleAuthError(e)) showToast('error', 'خطأ', e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'نعم، إلغاء الحجز';
  }
}

// ── EDIT ──────────────────────────────────────────────────────
async function openEditModal(id) {
  try {
    const { data: b } = await GET(`/bookings/${id}`);
    editBookingData = b;
    editSelectedDur = b.duration;
    editSelectedTime = b.start_time;

    document.getElementById('editBookingId').value = b.id;
    document.getElementById('editEmail').value     = currentEmail;
    document.getElementById('editDate').value      = b.date;
    document.getElementById('editDate').min        = todayStr();
    document.getElementById('editPurpose').value   = b.purpose;
    setCategoryValue('editCategory', 'editCategoryOther', b.category);
    let _att = []; try { _att = JSON.parse(b.attendees || '[]'); } catch (e) {}
    chipList = _att.map(a => a.email); renderChips();
    document.getElementById('editNotes').value     = b.notes || '';
    document.getElementById('editDuration').value  = b.duration;

    // Select duration pill
    document.querySelectorAll('#editDurationPills .duration-pill').forEach(p => {
      p.classList.toggle('selected', parseInt(p.dataset.duration) === b.duration);
    });

    await loadEditSlots();
    openModal('editModal');
  } catch (e) {
    showToast('error', 'خطأ', 'تعذّر تحميل تفاصيل الحجز.');
  }
}

async function loadEditSlots() {
  if (!editBookingData || !editSelectedDur) return;
  const date = document.getElementById('editDate').value;
  if (!date) return;

  const container = document.getElementById('editTimeSlots');
  container.innerHTML = '<div class="spinner spinner-dark"></div>';

  try {
    const { data } = await GET(`/rooms/${editBookingData.room_id}/availability`, { date });
    const slots = (data.slots || []).filter(s => s.status === 'available' || (s.time === editBookingData.start_time && date === editBookingData.date));

    if (!slots.length) {
      container.innerHTML = '<p class="text-sm text-muted">لا توجد أوقات متاحة في هذا التاريخ.</p>';
      return;
    }

    container.innerHTML = `<div class="time-slots-grid">${slots.map(s => {
      const isSelected = s.time === (editSelectedTime || editBookingData.start_time);
      const isCurrent  = s.time === editBookingData.start_time && date === editBookingData.date;
      return `<button type="button" class="time-slot-btn ${isSelected ? 'selected' : ''}"
        data-time="${s.time}" onclick="selectEditTime('${s.time}', this)">
        ${fmt12(s.time)}${isCurrent ? ' ★' : ''}
      </button>`;
    }).join('')}</div>`;
  } catch (e) {
    container.innerHTML = '<p class="text-sm text-muted" style="color:var(--danger)">تعذّر تحميل الأوقات.</p>';
  }
}

function selectEditTime(time, btn) {
  document.querySelectorAll('#editTimeSlots .time-slot-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  editSelectedTime = time;
  document.getElementById('editStartTime').value = time;
}

async function saveEdit() {
  if (!editBookingData) return;
  const btn = document.getElementById('editSaveBtn');
  btn.disabled = true;
  btn.textContent = 'جارٍ الحفظ…';

  try {
    await PUT(`/bookings/${editBookingData.id}`, {
      employee_email: currentEmail,
      date:      document.getElementById('editDate').value,
      start_time: editSelectedTime || editBookingData.start_time,
      duration:  editSelectedDur || editBookingData.duration,
      purpose:   document.getElementById('editPurpose').value.trim(),
      category:  categoryValue('editCategory', 'editCategoryOther'),
      notes:     document.getElementById('editNotes').value.trim(),
      attendees: parseAttendees()
    });
    closeModal('editModal');
    showToast('success', 'تم تحديث الحجز', 'تم تحديث حجزك.');
    await lookupBookings();
  } catch (e) {
    if (!handleAuthError(e)) showToast('error', 'فشل التحديث', e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'حفظ التغييرات';
  }
}

let chipList = [];
const CHIP_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function renderChips() {
  const box = document.getElementById('editChips');
  box.innerHTML = '';
  chipList.forEach((em, i) => {
    const c = document.createElement('span'); c.className = 'attendee-chip'; c.textContent = em;
    const x = document.createElement('button'); x.type = 'button'; x.textContent = '×'; x.setAttribute('aria-label', 'حذف');
    x.addEventListener('click', () => { chipList.splice(i, 1); renderChips(); });
    c.appendChild(x); box.appendChild(c);
  });
}
function addChipFromInput() {
  const inp = document.getElementById('editAttendeeInput');
  inp.value.split(/[\s,;،]+/).map(v => v.trim().toLowerCase()).filter(v => CHIP_RE.test(v)).forEach(v => { if (!chipList.includes(v)) chipList.push(v); });
  if (!inp.value || CHIP_RE.test(inp.value.trim().toLowerCase())) inp.value = '';
  renderChips();
}
document.addEventListener('DOMContentLoaded', () => {
  const inp = document.getElementById('editAttendeeInput');
  if (!inp) return;
  inp.addEventListener('keydown', e => { if (['Enter', ',', ' '].includes(e.key)) { e.preventDefault(); addChipFromInput(); } });
  inp.addEventListener('blur', addChipFromInput);
});

// Emails typed in the edit box, keeping names we already know
function parseAttendees() {
  let known = {}; try { JSON.parse(editBookingData.attendees || '[]').forEach(a => known[a.email] = a.name); } catch (e) {}
  const seen = new Set();
  addChipFromInput();
  return chipList.filter(x => x && !seen.has(x) && seen.add(x))
    .map(email => ({ email, name: known[email] || '' }));
}

function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
