/* ============================================================
   OAKTREE — Admin Panel (admin.js)
   ============================================================ */

let overrideTargetId    = '';
let adminCancelTargetId = '';

// ── LOGIN ─────────────────────────────────────────────────────
async function submitAdminLogin() {
  const code = document.getElementById('adminCode').value;
  const btn  = document.getElementById('loginBtn');
  const err  = document.getElementById('loginError');
  err.style.display = 'none';

  if (!code) { err.style.display = 'block'; return; }
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner"></div> Signing in…';

  try {
    const { token } = await POST('/admin/login', { code });
    sessionStorage.setItem('adminToken', token);
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('adminPanel').classList.remove('hidden');
    initAdminPanel();
  } catch (e) {
    err.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg> Sign In to Admin Panel`;
  }
}

function adminLogout() {
  sessionStorage.removeItem('adminToken');
  document.getElementById('adminPanel').classList.add('hidden');
  document.getElementById('loginScreen').classList.remove('hidden');
  document.getElementById('adminCode').value = '';
}

// ── INIT PANEL ────────────────────────────────────────────────
function initAdminPanel() {
  initTheme();
  initSidebar();
  updateCurrentDate();
  initModalClosers();

  // Tab listeners for lazy loading
  document.addEventListener('tabactivated', e => {
    const tab = e.detail.tab;
    if (tab === 'bookings')  loadAdminBookings();
    if (tab === 'blocks')    loadBlocks();
    if (tab === 'rooms')     loadRooms();
    if (tab === 'analytics') loadAnalytics();
    if (tab === 'settings')  loadSettings();
    if (tab === 'audit')     loadAuditLog();
  });
  initTabs();

  // Override modal
  document.getElementById('overrideClose').addEventListener('click',      () => closeModal('overrideModal'));
  document.getElementById('overrideCancelBtn').addEventListener('click',  () => closeModal('overrideModal'));
  document.getElementById('overrideConfirmBtn').addEventListener('click', confirmOverride);

  // Admin cancel modal
  document.getElementById('adminCancelClose').addEventListener('click',   () => closeModal('adminCancelModal'));
  document.getElementById('adminCancelNoBtn').addEventListener('click',   () => closeModal('adminCancelModal'));
  document.getElementById('adminCancelYesBtn').addEventListener('click',  confirmAdminCancel);

  // Block form
  document.getElementById('blockForm').addEventListener('submit', submitBlock);

  // Recurring form
  document.getElementById('recurringForm').addEventListener('submit', submitRecurring);

  // Load initial tab data
  loadAdminStats();
  loadAdminBookings();
}

// ── STATS ─────────────────────────────────────────────────────
async function loadAdminStats() {
  try {
    const { data } = await GET('/admin/analytics');
    document.getElementById('aSTotal').textContent     = data.total;
    document.getElementById('aSToday').textContent     = data.today;
    document.getElementById('aSCancelled').textContent = data.cancelled;
    document.getElementById('aSOverridden').textContent= data.overridden;
  } catch (e) { console.error('Stats error:', e); }
}

// ── ALL BOOKINGS ──────────────────────────────────────────────
async function loadAdminBookings() {
  const tbody  = document.getElementById('adminBookingsBody');
  const search = document.getElementById('bSearch').value.trim();
  const date   = document.getElementById('bDate').value;
  const room   = document.getElementById('bRoom').value;
  const status = document.getElementById('bStatus').value;

  tbody.innerHTML = `<tr class="loading-row"><td colspan="8"><div class="spinner spinner-dark"></div></td></tr>`;

  try {
    const q = {};
    if (search) q.search = search;
    if (date)   q.date   = date;
    if (room)   q.room_id= room;
    if (status) q.status = status;

    const { data: bookings } = await GET('/admin/bookings', q);

    if (!bookings.length) {
      tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state" style="padding:40px 0;">
        <div class="empty-state-icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></div>
        <div class="empty-state-title">No bookings found</div>
        <div class="empty-state-desc">No reservations match your current filters.</div>
      </div></td></tr>`;
      return;
    }

    tbody.innerHTML = bookings.map(b => {
      const canAct = b.status === 'confirmed';
      return `<tr>
        <td><div style="font-weight:600;font-size:13px;">${escHtml(b.employee_name)}</div><div style="font-size:11px;color:var(--text-muted);">${escHtml(b.employee_email)}</div></td>
        <td><span class="badge" style="background:${b.room_id==='oak_room'?'rgba(27,42,74,.1)':'rgba(42,92,69,.1)'};color:${b.room_id==='oak_room'?'var(--navy)':'var(--green)'};border:none">${b.room_name}</span></td>
        <td style="white-space:nowrap;">${fmtDate(b.date)}</td>
        <td style="white-space:nowrap;">${fmt12(b.start_time)} – ${fmt12(b.end_time)}</td>
        <td>${fmtDuration(b.duration)}</td>
        <td style="max-width:160px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${escHtml(b.purpose)}">${escHtml(b.purpose)}</td>
        <td>${statusBadge(b.status)}</td>
        <td>
          <div class="actions">
            ${canAct ? `
            <button class="btn btn-outline btn-sm" title="Override for priority" onclick="openOverrideModal('${b.id}','${escHtml(b.purpose)}','${b.room_name}','${b.date}','${b.start_time}','${b.end_time}','${escHtml(b.employee_name)}')">Override</button>
            <button class="btn btn-danger btn-sm" title="Cancel booking" onclick="openAdminCancelModal('${b.id}','${escHtml(b.purpose)}','${b.room_name}','${b.date}','${b.start_time}','${b.end_time}')">Cancel</button>
            ` : `<span style="font-size:12px;color:var(--text-muted);">No actions</span>`}
          </div>
        </td>
      </tr>`;
    }).join('');
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:30px;color:var(--danger);">${e.message}</td></tr>`;
  }
}

function clearBookingFilters() {
  document.getElementById('bSearch').value = '';
  document.getElementById('bDate').value   = '';
  document.getElementById('bRoom').value   = '';
  document.getElementById('bStatus').value = '';
  loadAdminBookings();
}

// ── OVERRIDE ──────────────────────────────────────────────────
function openOverrideModal(id, purpose, room, date, start, end, name) {
  overrideTargetId = id;
  document.getElementById('overrideDetail').innerHTML = `
    <div class="booking-detail-row"><div class="detail-label">Meeting</div><div class="detail-value">${escHtml(purpose)}</div></div>
    <div class="booking-detail-row"><div class="detail-label">Room</div><div class="detail-value">${escHtml(room)}</div></div>
    <div class="booking-detail-row"><div class="detail-label">Date</div><div class="detail-value">${fmtDate(date)}</div></div>
    <div class="booking-detail-row"><div class="detail-label">Time</div><div class="detail-value">${fmt12(start)} – ${fmt12(end)}</div></div>
    <div class="booking-detail-row"><div class="detail-label">Booked by</div><div class="detail-value">${escHtml(name)}</div></div>`;
  document.getElementById('overrideReason').value = '';
  openModal('overrideModal');
}

async function confirmOverride() {
  const reason = document.getElementById('overrideReason').value.trim();
  if (!reason) { showToast('warning', 'Reason required', 'Please provide a reason for the override.'); return; }
  const btn = document.getElementById('overrideConfirmBtn');
  btn.disabled = true; btn.textContent = 'Overriding…';
  try {
    await PUT(`/admin/bookings/${overrideTargetId}/override`, { reason });
    closeModal('overrideModal');
    showToast('success', 'Booking Overridden', 'The employee has been notified by email.');
    loadAdminBookings();
    loadAdminStats();
  } catch (e) {
    showToast('error', 'Error', e.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Override Booking';
  }
}

// ── ADMIN CANCEL ──────────────────────────────────────────────
function openAdminCancelModal(id, purpose, room, date, start, end) {
  adminCancelTargetId = id;
  document.getElementById('adminCancelDetail').innerHTML = `
    <div class="booking-detail-row"><div class="detail-label">Meeting</div><div class="detail-value">${escHtml(purpose)}</div></div>
    <div class="booking-detail-row"><div class="detail-label">Room</div><div class="detail-value">${escHtml(room)}</div></div>
    <div class="booking-detail-row"><div class="detail-label">Date</div><div class="detail-value">${fmtDate(date)}</div></div>
    <div class="booking-detail-row"><div class="detail-label">Time</div><div class="detail-value">${fmt12(start)} – ${fmt12(end)}</div></div>`;
  document.getElementById('adminCancelReason').value = '';
  openModal('adminCancelModal');
}

async function confirmAdminCancel() {
  const reason = document.getElementById('adminCancelReason').value.trim();
  const btn = document.getElementById('adminCancelYesBtn');
  btn.disabled = true; btn.textContent = 'Cancelling…';
  try {
    await DEL(`/admin/bookings/${adminCancelTargetId}`, { reason });
    closeModal('adminCancelModal');
    showToast('success', 'Booking Cancelled', 'The employee has been notified.');
    loadAdminBookings();
    loadAdminStats();
  } catch (e) {
    showToast('error', 'Error', e.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Cancel Booking';
  }
}

// ── BLOCKS ────────────────────────────────────────────────────
async function submitBlock(e) {
  e.preventDefault();
  const room   = document.getElementById('blockRoom').value;
  const date   = document.getElementById('blockDate').value;
  const start  = document.getElementById('blockStart').value;
  const end    = document.getElementById('blockEnd').value;
  const reason = document.getElementById('blockReason').value.trim();

  if (!room || !date || !start || !end || !reason) {
    showToast('warning', 'Missing fields', 'Please fill in all required fields.'); return;
  }
  if (start >= end) { showToast('warning', 'Invalid time', 'End time must be after start time.'); return; }

  try {
    await POST('/admin/blocks', { room_id: room, date, start_time: start, end_time: end, reason });
    showToast('success', 'Slot Blocked', `${date} ${start}–${end} has been blocked.`);
    document.getElementById('blockForm').reset();
    loadBlocks();
  } catch (e) {
    showToast('error', 'Error', e.message);
  }
}

async function loadBlocks() {
  const container = document.getElementById('blocksList');
  container.innerHTML = '<div style="padding:20px;text-align:center;"><div class="spinner spinner-dark"></div></div>';
  try {
    const { data: blocks } = await GET('/admin/blocks');
    if (!blocks.length) {
      container.innerHTML = `<div class="empty-state" style="padding:40px 0;">
        <div class="empty-state-icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></div>
        <div class="empty-state-title">No blocked slots configured</div>
        <div class="empty-state-desc">Add a block using the form on the left.</div>
      </div>`;
      return;
    }
    container.innerHTML = `<div style="padding:12px 16px;display:flex;flex-direction:column;gap:8px;">
      ${blocks.map(bl => `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--beige);border:1px solid var(--beige-dark);border-radius:var(--radius-sm);">
          <div>
            <div style="font-size:13px;font-weight:600;color:var(--text-primary);">${bl.room_name} · ${fmtDate(bl.date)}</div>
            <div style="font-size:12px;color:var(--text-muted);">${fmt12(bl.start_time)} – ${fmt12(bl.end_time)} · ${escHtml(bl.reason)}</div>
          </div>
          <button class="btn btn-danger btn-sm" onclick="removeBlock('${bl.id}')">Remove</button>
        </div>`).join('')}
    </div>`;
  } catch (e) {
    container.innerHTML = '<p style="padding:20px;color:var(--danger);">Could not load blocks.</p>';
  }
}

async function removeBlock(id) {
  try {
    await DEL(`/admin/blocks/${id}`, {});
    showToast('success', 'Block Removed', 'The time slot is now available for booking.');
    loadBlocks();
  } catch (e) {
    showToast('error', 'Error', e.message);
  }
}

// ── ROOMS ─────────────────────────────────────────────────────
async function loadRooms() {
  const container = document.getElementById('roomsManage');
  try {
    const { data: rooms } = await GET('/admin/rooms');
    container.innerHTML = `<div style="display:flex;flex-direction:column;gap:20px;">
      ${rooms.map(r => `
        <div style="border:1px solid var(--grey-border);border-radius:var(--radius-md);padding:18px;">
          <div style="font-size:15px;font-weight:700;margin-bottom:14px;color:var(--text-primary);">${r.name}</div>
          <div class="form-row">
            <div class="form-group">
              <label>Room Name</label>
              <input type="text" id="rn_${r.id}" value="${escHtml(r.name)}">
            </div>
            <div class="form-group">
              <label>Capacity</label>
              <input type="number" id="rc_${r.id}" value="${r.capacity}" min="1">
            </div>
          </div>
          <div class="form-group">
            <label>Description</label>
            <input type="text" id="rd_${r.id}" value="${escHtml(r.description||'')}">
          </div>
          <div class="form-group">
            <label>Status</label>
            <select id="rs_${r.id}">
              <option value="active"      ${r.status==='active'      ?'selected':''}>Active</option>
              <option value="maintenance" ${r.status==='maintenance' ?'selected':''}>Under Maintenance</option>
              <option value="inactive"    ${r.status==='inactive'    ?'selected':''}>Inactive</option>
            </select>
          </div>
          <button class="btn btn-primary btn-sm" onclick="saveRoom('${r.id}')">Save Changes</button>
        </div>`).join('')}
    </div>`;
  } catch (e) {
    container.innerHTML = `<p style="color:var(--danger);">Could not load rooms: ${e.message}</p>`;
  }
}

async function saveRoom(id) {
  try {
    await PUT(`/admin/rooms/${id}`, {
      name:        document.getElementById(`rn_${id}`).value.trim(),
      description: document.getElementById(`rd_${id}`).value.trim(),
      capacity:    parseInt(document.getElementById(`rc_${id}`).value),
      status:      document.getElementById(`rs_${id}`).value
    });
    showToast('success', 'Room Updated', 'Room settings have been saved.');
  } catch (e) {
    showToast('error', 'Error', e.message);
  }
}

// ── RECURRING ─────────────────────────────────────────────────
async function submitRecurring(e) {
  e.preventDefault();
  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true; btn.innerHTML = '<div class="spinner"></div> Creating…';
  try {
    const { data } = await POST('/admin/bookings/recurring', {
      employee_name:     document.getElementById('rName').value.trim(),
      employee_email:    document.getElementById('rEmail').value.trim(),
      room_id:           document.getElementById('rRoom').value,
      start_date:        document.getElementById('rStartDate').value,
      end_date:          document.getElementById('rEndDate').value,
      start_time:        document.getElementById('rTime').value,
      duration:          document.getElementById('rDuration').value,
      purpose:           document.getElementById('rPurpose').value.trim(),
      category:          document.getElementById('rCategory').value,
      recurrence_pattern:document.getElementById('rPattern').value
    });
    showToast('success', 'Recurring Bookings Created',
      `${data.created} bookings created. ${data.skipped > 0 ? `${data.skipped} slots skipped (conflicts).` : ''}`);
    document.getElementById('recurringForm').reset();
  } catch (e) {
    showToast('error', 'Error', e.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg> Create Recurring Booking`;
  }
}

// ── ANALYTICS ─────────────────────────────────────────────────
async function loadAnalytics() {
  const container = document.getElementById('analyticsContent');
  container.innerHTML = '<div style="text-align:center;padding:40px;"><div class="spinner spinner-dark"></div></div>';
  try {
    const { data } = await GET('/admin/analytics');
    const maxHour = Math.max(...(data.byHour.map(h => h.count)), 1);
    const maxRoom = Math.max(...(data.byRoom.map(r => r.count)), 1);

    const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

    container.innerHTML = `
    <div class="three-col mb-3">
      <div class="analytics-card">
        <div style="font-size:12px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:14px;">Bookings by Room</div>
        <div class="analytics-bar-wrap">
          ${data.byRoom.map(r => `
            <div class="analytics-bar-row">
              <div class="analytics-bar-label">${r.room_name}</div>
              <div class="analytics-bar-track"><div class="analytics-bar-fill" style="width:${(r.count/maxRoom*100).toFixed(1)}%;background:${r.room_id==='oak_room'?'var(--navy)':'var(--green)'}"></div></div>
              <div class="analytics-bar-val">${r.count}</div>
            </div>`).join('') || '<p class="text-muted text-sm">No data yet</p>'}
        </div>
      </div>
      <div class="analytics-card">
        <div style="font-size:12px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:14px;">Peak Hours</div>
        <div class="analytics-bar-wrap">
          ${data.byHour.map(h => `
            <div class="analytics-bar-row">
              <div class="analytics-bar-label">${fmt12(h.hour+':00')}</div>
              <div class="analytics-bar-track"><div class="analytics-bar-fill" style="width:${(h.count/maxHour*100).toFixed(1)}%"></div></div>
              <div class="analytics-bar-val">${h.count}</div>
            </div>`).join('') || '<p class="text-muted text-sm">No data yet</p>'}
        </div>
      </div>
      <div class="analytics-card">
        <div style="font-size:12px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:14px;">Meeting Categories</div>
        <div class="analytics-bar-wrap">
          ${data.byCategory.map(c => `
            <div class="analytics-bar-row">
              <div class="analytics-bar-label" style="min-width:100px;">${categoryLabel(c.category)}</div>
              <div class="analytics-bar-track"><div class="analytics-bar-fill" style="width:${data.total?(c.count/data.total*100).toFixed(1):0}%;background:var(--gold)"></div></div>
              <div class="analytics-bar-val">${c.count}</div>
            </div>`).join('') || '<p class="text-muted text-sm">No data yet</p>'}
        </div>
      </div>
    </div>
    <div class="card">
      <div class="card-header"><div class="card-title">Recent Bookings</div></div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Employee</th><th>Room</th><th>Date</th><th>Time</th><th>Purpose</th><th>Status</th></tr></thead>
          <tbody>
            ${data.recent.length ? data.recent.map(b => `<tr>
              <td><div style="font-weight:600;font-size:13px;">${escHtml(b.employee_name)}</div><div style="font-size:11px;color:var(--text-muted);">${escHtml(b.employee_email)}</div></td>
              <td>${b.room_name}</td>
              <td>${fmtDate(b.date)}</td>
              <td>${fmt12(b.start_time)}</td>
              <td>${escHtml(b.purpose)}</td>
              <td>${statusBadge(b.status)}</td>
            </tr>`).join('') : '<tr><td colspan="6"><div class="empty-state" style="padding:30px 0;"><div class="empty-state-title">No booking history yet</div></div></td></tr>'}
          </tbody>
        </table>
      </div>
    </div>`;
  } catch (e) {
    container.innerHTML = `<p style="color:var(--danger);padding:20px;">Could not load analytics: ${e.message}</p>`;
  }
}

// ── SETTINGS ──────────────────────────────────────────────────
async function loadSettings() {
  try {
    const { data: s } = await GET('/admin/settings');
    document.getElementById('sOfficeStart').value  = s.office_hours_start || '08:00';
    document.getElementById('sOfficeEnd').value    = s.office_hours_end   || '18:00';
    document.getElementById('sMaxDur').value       = s.max_booking_duration || '120';
    document.getElementById('sInterval').value     = s.booking_interval || '30';
    document.getElementById('sEmailEnabled').checked = s.email_notifications_enabled === 'true';
    document.getElementById('sSmtpHost').value     = s.smtp_host || '';
    document.getElementById('sSmtpPort').value     = s.smtp_port || '587';
    document.getElementById('sSmtpFrom').value     = s.smtp_from || '';
    document.getElementById('sSmtpUser').value     = s.smtp_user || '';
    document.getElementById('sCompanyName').value  = s.company_name || 'Oaktree Group';
    document.getElementById('sLogoText').value     = s.logo_text || 'OG';
    // Logo preview
    const preview    = document.getElementById('currentLogoPreview');
    const removeBtn  = document.getElementById('logoRemoveBtn');
    if (preview) {
      if (s.logo_url) {
        preview.innerHTML = `<img src="${s.logo_url}?v=${Date.now()}" alt="Current logo"
          style="max-height:72px;max-width:144px;object-fit:contain;border-radius:6px;border:1px solid var(--grey-border);background:#fff;padding:4px;">
          <span style="font-size:12px;color:var(--green);">✓ Logo uploaded</span>`;
        if (removeBtn) removeBtn.style.display = 'inline-flex';
      } else {
        preview.innerHTML = '<span style="font-size:12px;color:var(--text-muted);">No logo uploaded — using text monogram.</span>';
        if (removeBtn) removeBtn.style.display = 'none';
      }
    }
  } catch (e) { console.error('Settings load error:', e); }
}

async function saveBookingRules() {
  try {
    await PUT('/admin/settings', {
      office_hours_start:    document.getElementById('sOfficeStart').value,
      office_hours_end:      document.getElementById('sOfficeEnd').value,
      max_booking_duration:  document.getElementById('sMaxDur').value,
      booking_interval:      document.getElementById('sInterval').value
    });
    showToast('success', 'Booking Rules Saved', 'Office hours and duration limits updated.');
  } catch (e) { showToast('error', 'Error', e.message); }
}

async function saveEmailSettings() {
  const settings = {
    email_notifications_enabled: document.getElementById('sEmailEnabled').checked ? 'true' : 'false',
    smtp_host: document.getElementById('sSmtpHost').value.trim(),
    smtp_port: document.getElementById('sSmtpPort').value.trim(),
    smtp_from: document.getElementById('sSmtpFrom').value.trim(),
    smtp_user: document.getElementById('sSmtpUser').value.trim()
  };
  const pass = document.getElementById('sSmtpPass').value;
  if (pass) settings.smtp_pass = pass;
  try {
    await PUT('/admin/settings', settings);
    showToast('success', 'Email Settings Saved', 'SMTP configuration updated.');
    document.getElementById('sSmtpPass').value = '';
  } catch (e) { showToast('error', 'Error', e.message); }
}

async function saveBranding() {
  try {
    await PUT('/admin/settings', {
      company_name: document.getElementById('sCompanyName').value.trim(),
      logo_text:    document.getElementById('sLogoText').value.trim().toUpperCase().slice(0,3)
    });
    syncBranding(); // refresh sidebar logo/name display
    showToast('success', 'Branding Saved', 'Company name and logo monogram updated.');
  } catch (e) { showToast('error', 'Error', e.message); }
}

// ── LOGO UPLOAD ───────────────────────────────────────────────
async function uploadLogo(input) {
  const file = input.files[0];
  if (!file) return;
  const statusEl = document.getElementById('logoUploadStatus');
  statusEl.innerHTML = '<span style="color:var(--text-muted);">Uploading…</span>';

  const formData = new FormData();
  formData.append('logo', file);

  try {
    const token = sessionStorage.getItem('adminToken');
    const res   = await fetch('/api/admin/upload-logo', {
      method: 'POST',
      headers: token ? { 'x-admin-token': token } : {},
      body: formData
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'Upload failed.');

    statusEl.innerHTML = '<span style="color:var(--green);">✓ Logo uploaded successfully.</span>';
    input.value = '';         // reset file input
    loadSettings();           // refresh preview
    syncBranding();           // update sidebar immediately
    showToast('success', 'Logo Uploaded', 'The company logo is now showing in the sidebar.');
  } catch (e) {
    statusEl.innerHTML = `<span style="color:var(--danger);">Error: ${escHtml(e.message)}</span>`;
    showToast('error', 'Upload Failed', e.message);
  }
}

async function removeLogo() {
  const statusEl = document.getElementById('logoUploadStatus');
  statusEl.innerHTML = '<span style="color:var(--text-muted);">Removing…</span>';
  try {
    await DEL('/admin/logo', {});
    statusEl.innerHTML = '<span style="color:var(--text-muted);">Logo removed.</span>';
    loadSettings();
    syncBranding();
    showToast('success', 'Logo Removed', 'Text monogram will now be displayed instead.');
  } catch (e) {
    statusEl.innerHTML = `<span style="color:var(--danger);">Error: ${escHtml(e.message)}</span>`;
    showToast('error', 'Error', e.message);
  }
}

// ── TEST EMAIL ────────────────────────────────────────────────
async function sendTestEmail() {
  const to       = (document.getElementById('testEmailAddr').value || '').trim();
  const resultEl = document.getElementById('testEmailResult');
  if (!to) {
    resultEl.innerHTML = '<span style="color:var(--danger);">Please enter a recipient email address.</span>';
    return;
  }
  resultEl.innerHTML = '<span style="color:var(--text-muted);">Sending…</span>';
  try {
    const json = await POST('/admin/test-email', { to });
    if (json.isEthereal) {
      resultEl.innerHTML = `<span style="color:#b45309;">
        No SMTP configured — email sent via Ethereal (test preview only, not a real inbox).<br>
        <a href="${escHtml(json.previewUrl)}" target="_blank" rel="noopener noreferrer"
           style="color:var(--navy);font-weight:600;">→ View email preview on Ethereal</a><br>
        <span style="color:var(--text-muted);">To deliver real emails, enter SMTP credentials above and save.</span>
      </span>`;
    } else {
      resultEl.innerHTML = `<span style="color:var(--green);">✓ ${escHtml(json.message)}</span>`;
      showToast('success', 'Test Email Sent', `Delivered to ${to}`);
    }
  } catch (e) {
    resultEl.innerHTML = `<span style="color:var(--danger);">Failed: ${escHtml(e.message)}</span>`;
  }
}

// ── AUDIT LOG ─────────────────────────────────────────────────
async function loadAuditLog() {
  const container = document.getElementById('auditContent');
  container.innerHTML = '<div style="text-align:center;padding:40px;"><div class="spinner spinner-dark"></div></div>';
  try {
    const { data: logs } = await GET('/admin/audit-log');
    if (!logs.length) {
      container.innerHTML = `<div class="empty-state" style="padding:48px 0;">
        <div class="empty-state-icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div>
        <div class="empty-state-title">No audit entries yet</div>
        <div class="empty-state-desc">All admin actions will be recorded here.</div>
      </div>`;
      return;
    }
    const rows = logs.map(l => {
      let details = '';
      try { const d = JSON.parse(l.details); details = typeof d === 'object' ? Object.entries(d).map(([k,v])=>`${k}: ${v}`).join(', ') : l.details; }
      catch { details = l.details || ''; }
      return `<div class="audit-row">
        <div style="font-size:12px;color:var(--text-muted);">${new Date(l.timestamp).toLocaleString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</div>
        <div><span class="audit-action audit-${l.action}">${l.action.replace(/_/g,' ')}</span></div>
        <div style="font-size:12px;color:var(--text-secondary);word-break:break-all;">${escHtml(details.slice(0,120))}</div>
        <div style="font-size:12px;color:var(--text-muted);">${escHtml(l.performed_by)}</div>
      </div>`;
    }).join('');
    container.innerHTML = `<div style="border-top:2px solid var(--grey-border);">
      <div class="audit-row" style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);background:var(--beige);">
        <div>Timestamp</div><div>Action</div><div>Details</div><div>Performed By</div>
      </div>
      ${rows}
    </div>`;
  } catch (e) {
    container.innerHTML = `<p style="color:var(--danger);padding:20px;">Could not load audit log: ${e.message}</p>`;
  }
}

// ── HELPERS ───────────────────────────────────────────────────
function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── BOOT ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const token = sessionStorage.getItem('adminToken');
  if (token) {
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('adminPanel').classList.remove('hidden');
    initAdminPanel();
  }
});
