/* ============================================================
   OAKTREE — Book a Room (booking.js)
   ============================================================ */

let selectedRoom     = null;
let selectedDuration = null;
let selectedTime     = null;
let currentSlots     = [];

// ── INIT ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  setMinDateToday('bookingDate');

  // Room selector
  document.querySelectorAll('.room-option').forEach(opt => {
    opt.addEventListener('click', () => {
      document.querySelectorAll('.room-option').forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      selectedRoom = opt.dataset.room;
      document.getElementById('selectedRoom').value = selectedRoom;
      clearError('roomError');
      clearError('timeError');
      selectedTime = null;
      document.getElementById('selectedTime').value = '';
      maybeLoadSlots();
      updateSummary();
    });
  });

  // Duration pills
  document.querySelectorAll('#durationPills .duration-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('#durationPills .duration-pill').forEach(p => p.classList.remove('selected'));
      pill.classList.add('selected');
      selectedDuration = parseInt(pill.dataset.duration);
      document.getElementById('selectedDuration').value = selectedDuration;
      clearError('durationError');
      selectedTime = null;
      document.getElementById('selectedTime').value = '';
      maybeLoadSlots();
      updateSummary();
    });
  });

  // Date change
  document.getElementById('bookingDate').addEventListener('change', () => {
    clearError('dateError');
    selectedTime = null;
    document.getElementById('selectedTime').value = '';
    maybeLoadSlots();
    updateSummary();
  });

  // Form submit
  document.getElementById('bookingForm').addEventListener('submit', handleSubmit);

  // Success banner close
  document.getElementById('successClose').addEventListener('click', () => {
    document.getElementById('successBanner').classList.add('hidden');
  });
});

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
        <div class="empty-state-title">No time slots available</div>
        <div class="empty-state-desc">No slots found for the selected date. Try a different date.</div>
      </div>`;
      return;
    }

    // Build valid start-time slots considering duration
    const durationMins = parseInt(duration);
    const slots = buildDurationSlots(currentSlots, durationMins, data.officeEnd);

    if (!slots.length) {
      container.innerHTML = `<div class="empty-state" style="padding:24px;background:var(--beige);border-radius:var(--radius-md)">
        <div class="empty-state-title">No slots available for ${fmtDuration(durationMins)}</div>
        <div class="empty-state-desc">There are no consecutive slots long enough for your selected duration. Try a shorter duration or different date.</div>
      </div>`;
      return;
    }

    const html = `<div class="time-slots-grid">
      ${slots.map(s => {
        let cls = '';
        let disabled = false;
        let title = '';
        if (s.status === 'available') { cls = ''; }
        else if (s.status === 'booked')  { cls = 'booked'; disabled = true; title = 'Already booked'; }
        else if (s.status === 'blocked') { cls = 'blocked'; disabled = true; title = 'Blocked by admin'; }
        else if (s.status === 'past')    { cls = 'past'; disabled = true; title = 'Time has passed'; }
        else                             { cls = 'booked'; disabled = true; }

        if (s.time === selectedTime && !disabled) cls = 'selected';

        return `<button type="button" class="time-slot-btn ${cls}" data-time="${s.time}"
          ${disabled ? 'disabled' : ''} title="${title}" onclick="selectTime('${s.time}', this)">
          ${fmt12(s.time)}
        </button>`;
      }).join('')}
    </div>`;

    container.innerHTML = html;
  } catch (e) {
    container.innerHTML = `<div style="padding:16px;color:var(--danger);font-size:13px;">Could not load time slots. Please try again.</div>`;
  }
}

function buildDurationSlots(baseSlots, durationMins, officeEnd) {
  const results = [];
  const intervalMins = 30; // base interval

  for (let i = 0; i < baseSlots.length; i++) {
    const slot = baseSlots[i];
    // Check if all slots from i covering 'durationMins' are available/booked/blocked
    const slotsNeeded = Math.ceil(durationMins / intervalMins);
    let feasible = true;
    let worstStatus = slot.status;

    for (let j = 0; j < slotsNeeded; j++) {
      const s = baseSlots[i + j];
      if (!s) { feasible = false; break; }
      if (s.status === 'booked' || s.status === 'blocked') { worstStatus = s.status; break; }
      if (s.status === 'past') worstStatus = 'past';
    }

    // Check that end time doesn't exceed office hours
    const [h, m] = slot.time.split(':').map(Number);
    const endMins = h * 60 + m + durationMins;
    const endH = Math.floor(endMins / 60);
    const endM = endMins % 60;
    const endStr = `${String(endH).padStart(2,'0')}:${String(endM).padStart(2,'0')}`;
    if (endStr > officeEnd) feasible = false;

    if (feasible) {
      results.push({ ...slot, status: worstStatus === slot.status ? slot.status : worstStatus });
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

// ── SUMMARY ───────────────────────────────────────────────────
function updateSummary() {
  const summary = document.getElementById('bookingSummary');
  const ROOM_NAMES = { oak_room: 'Oak Room', tree_room: 'Tree Room' };

  if (selectedRoom && document.getElementById('bookingDate').value && selectedDuration && selectedTime) {
    summary.classList.remove('hidden');
    const date = document.getElementById('bookingDate').value;
    const [h, m] = selectedTime.split(':').map(Number);
    const endMins = h * 60 + m + selectedDuration;
    const endStr  = `${String(Math.floor(endMins/60)).padStart(2,'0')}:${String(endMins%60).padStart(2,'0')}`;

    document.getElementById('sumRoom').textContent     = ROOM_NAMES[selectedRoom] || selectedRoom;
    document.getElementById('sumDate').textContent     = fmtDateLong(date);
    document.getElementById('sumTime').textContent     = `${fmt12(selectedTime)} – ${fmt12(endStr)}`;
    document.getElementById('sumDuration').textContent = fmtDuration(selectedDuration);
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
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showError('emailError'); valid = false; }
  if (!selectedRoom)     { showError('roomError');     valid = false; }
  if (!date)             { showError('dateError');     valid = false; }
  if (!selectedDuration) { showError('durationError'); valid = false; }
  if (!selectedTime)     { showError('timeError');     valid = false; }
  if (!purpose)          { showError('purposeError');  valid = false; }

  return valid;
}

// ── SUBMIT ────────────────────────────────────────────────────
async function handleSubmit(e) {
  e.preventDefault();
  if (!validate()) {
    showToast('error', 'Please check the form', 'Some required fields are missing or invalid.');
    return;
  }

  const btn = document.getElementById('submitBtn');
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner"></div> Booking…';

  try {
    const payload = {
      employee_name:  document.getElementById('employeeName').value.trim(),
      employee_email: document.getElementById('employeeEmail').value.trim(),
      room_id:   selectedRoom,
      date:      document.getElementById('bookingDate').value,
      start_time:selectedTime,
      duration:  selectedDuration,
      purpose:   document.getElementById('meetingPurpose').value.trim(),
      category:  document.getElementById('meetingCategory').value,
      notes:     document.getElementById('meetingNotes').value.trim()
    };

    const { data } = await POST('/bookings', payload);
    const ROOM_NAMES = { oak_room: 'Oak Room', tree_room: 'Tree Room' };
    const roomName   = ROOM_NAMES[data.room_id] || data.room_name || data.room_id;

    // Show success banner
    const banner = document.getElementById('successBanner');
    document.getElementById('successMsg').textContent =
      `${roomName} booked for ${fmtDate(data.date)} at ${fmt12(data.start_time)} – ${fmt12(data.end_time)}. A confirmation has been sent to ${data.employee_email}.`;
    banner.classList.remove('hidden');
    banner.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    // Auto-close after 5 seconds
    setTimeout(() => banner.classList.add('hidden'), 5000);

    showToast('success', 'Booking Confirmed!', `${roomName} reserved for ${fmt12(data.start_time)}.`);
    resetForm();
  } catch (err) {
    showToast('error', 'Booking Failed', err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> Confirm Booking`;
  }
}

function resetForm() {
  document.getElementById('bookingForm').reset();
  selectedRoom = null;
  selectedDuration = null;
  selectedTime = null;
  document.getElementById('selectedRoom').value = '';
  document.getElementById('selectedDuration').value = '';
  document.getElementById('selectedTime').value = '';
  document.querySelectorAll('.room-option').forEach(o => o.classList.remove('selected'));
  document.querySelectorAll('#durationPills .duration-pill').forEach(p => p.classList.remove('selected'));
  document.getElementById('timeSlotsContainer').innerHTML = `<div class="empty-state" style="padding:24px 0;background:var(--beige);border-radius:var(--radius-md)">
    <div class="empty-state-icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div>
    <div class="empty-state-title">Select a room, date and duration first</div>
    <div class="empty-state-desc">Available time slots will appear here once you have chosen a room, date, and duration above.</div>
  </div>`;
  document.getElementById('bookingSummary').classList.add('hidden');
  setMinDateToday('bookingDate');
}
