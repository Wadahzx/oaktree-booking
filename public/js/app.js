/* ============================================================
   OAKTREE — Shared Utilities (app.js)
   Loaded on every page
   ============================================================ */

// ── API ──────────────────────────────────────────────────────
async function api(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' }
  };
  const token = sessionStorage.getItem('adminToken');
  if (token) opts.headers['x-admin-token'] = token;
  if (body)  opts.body = JSON.stringify(body);
  const res  = await fetch('/api' + path, opts);
  const data = await res.json();
  if (!res.ok) { const err = new Error(data.error || 'فشل الطلب'); err.data = data; throw err; }
  return data;
}

const GET    = (p, q)    => api('GET',    p + (q ? '?' + new URLSearchParams(q) : ''), null);
const POST   = (p, b)    => api('POST',   p, b);
const PUT    = (p, b)    => api('PUT',    p, b);
const DEL    = (p, b)    => api('DELETE', p, b);

// ── TOAST NOTIFICATIONS ──────────────────────────────────────
function showToast(type, title, message, duration = 5000) {
  const icons = {
    success: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    error:   '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    warning: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    info:    '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>'
  };
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <div class="toast-icon">${icons[type] || icons.info}</div>
    <div class="toast-content">
      <div class="toast-title">${title}</div>
      ${message ? `<div class="toast-message">${message}</div>` : ''}
    </div>
    <button class="toast-close" onclick="removeToast(this.parentElement)">
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>`;
  container.appendChild(toast);

  if (duration > 0) {
    setTimeout(() => removeToast(toast), duration);
  }
  return toast;
}

function removeToast(el) {
  if (!el || !el.parentElement) return;
  el.classList.add('removing');
  setTimeout(() => el.remove(), 320);
}

// ── THEME (DARK MODE) ─────────────────────────────────────────
function initTheme() {
  const saved = localStorage.getItem('oaktreeTheme') || 'light';
  setTheme(saved);

  const btn = document.getElementById('themeToggle');
  if (btn) btn.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    setTheme(current === 'dark' ? 'light' : 'dark');
  });
}

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('oaktreeTheme', theme);
  const icon  = document.getElementById('themeIcon');
  const label = document.getElementById('themeLabel');
  if (theme === 'dark') {
    if (icon)  icon.innerHTML = '<path d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707M18.364 17.657l-.707-.707M6.343 6.343l-.707-.707M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>';
    if (label) label.textContent = 'الوضع الفاتح';
  } else {
    if (icon)  icon.innerHTML = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>';
    if (label) label.textContent = 'الوضع الداكن';
  }
}

// ── SIDEBAR TOGGLE (MOBILE) ───────────────────────────────────
function initSidebar() {
  const toggle  = document.getElementById('sidebarToggle');
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  if (!toggle || !sidebar) return;

  toggle.addEventListener('click', () => {
    sidebar.classList.toggle('open');
    overlay && overlay.classList.toggle('show');
  });
  overlay && overlay.addEventListener('click', () => {
    sidebar.classList.remove('open');
    overlay.classList.remove('show');
  });
}

// ── DATE DISPLAY ──────────────────────────────────────────────
function updateCurrentDate() {
  const el = document.getElementById('currentDate');
  if (!el) return;
  el.textContent = new Date().toLocaleDateString(AR_LOCALE, { weekday:'short', day:'numeric', month:'short', year:'numeric' });
}

// ── DATE / TIME HELPERS ───────────────────────────────────────
const AR_LOCALE = currentLang() === 'en' ? 'en-GB' : 'ar-SA-u-nu-latn-ca-gregory'; // Arabic month/day names, Latin digits

function fmtRange(a, b) {
  return `${fmt12(a)} ${currentLang() === 'en' ? 'to' : 'إلى'} ${fmt12(b)}`;
}

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

function fmtDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr + 'T12:00:00').toLocaleDateString(AR_LOCALE, { weekday:'short', day:'numeric', month:'short', year:'numeric' });
}

function fmtDateLong(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr + 'T12:00:00').toLocaleDateString(AR_LOCALE, { weekday:'long', day:'numeric', month:'long', year:'numeric' });
}

function fmt12(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2,'0')} ${currentLang() === 'en' ? (h >= 12 ? 'PM' : 'AM') : (h >= 12 ? 'م' : 'ص')}`;
}

function fmtDuration(mins) {
  if (mins < 60) return `${mins} دقيقة`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const hours = h === 1 ? 'ساعة' : h === 2 ? 'ساعتان' : `${h} ساعات`;
  return m ? `${hours} و${m} دقيقة` : hours;
}

function statusBadge(status) {
  const T = typeof t === 'function' ? t : k => k;
  const map = {
    confirmed:  `<span class="badge badge-confirmed">${T('status.confirmed')}</span>`,
    cancelled:  `<span class="badge badge-cancelled">${T('status.cancelled')}</span>`,
    overridden: `<span class="badge badge-overridden">${T('status.overridden')}</span>`
  };
  return map[status] || `<span class="badge">${status}</span>`;
}

function categoryLabel(cat) {
  const T = typeof t === 'function' ? t : k => k;
  const map = {
    meeting:'cat.meeting', interview:'cat.interview', training:'cat.training',
    client:'cat.client', presentation:'cat.presentation', workshop:'cat.workshop', other:'cat.other'
  };
  if (cat && cat.indexOf('other:') === 0) return cat.slice(6) || T('cat.other');
  return map[cat] ? T(map[cat]) : (cat || 'اجتماع');
}

// "Other" meeting type: show a text box and store it as "other:<text>"
function wireCategoryOther(selectId, inputId) {
  const sel = document.getElementById(selectId), inp = document.getElementById(inputId);
  if (!sel || !inp) return;
  const sync = () => {
    const show = sel.value === 'other';
    inp.style.display = show ? '' : 'none';
    if (show) inp.focus(); else inp.value = '';
  };
  sel.addEventListener('change', sync);
  sel.__syncOther = () => { inp.style.display = sel.value === 'other' ? '' : 'none'; };
}
function categoryValue(selectId, inputId) {
  const v = document.getElementById(selectId).value;
  if (v !== 'other') return v;
  const txt = (document.getElementById(inputId).value || '').trim();
  return txt ? 'other:' + txt : 'other';
}
function setCategoryValue(selectId, inputId, cat) {
  const sel = document.getElementById(selectId), inp = document.getElementById(inputId);
  if (cat && cat.indexOf('other:') === 0) { sel.value = 'other'; inp.value = cat.slice(6); }
  else { sel.value = cat || 'meeting'; if (sel.value !== (cat || 'meeting')) { sel.value = 'other'; inp.value = cat; } else inp.value = ''; }
  inp.style.display = sel.value === 'other' ? '' : 'none';
}

// ── MODAL HELPERS ─────────────────────────────────────────────
function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('open');
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('open');
}

function initModalClosers() {
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) overlay.classList.remove('open');
    });
  });
  document.querySelectorAll('.modal-close, [id$="CloseBtn"], [id$="Close"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const modal = btn.closest('.modal-overlay');
      if (modal) modal.classList.remove('open');
    });
  });
}

// ── TAB NAV ───────────────────────────────────────────────────
function initTabs() {
  document.querySelectorAll('.tab-nav').forEach(nav => {
    nav.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tabName = btn.dataset.tab;
        nav.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const panels = nav.nextElementSibling
          ? nav.parentElement.querySelectorAll('.tab-panel')
          : document.querySelectorAll('.tab-panel');
        panels.forEach(p => {
          p.classList.toggle('active', p.id === `tab-${tabName}`);
        });
        btn.dispatchEvent(new CustomEvent('tabactivated', { bubbles: true, detail: { tab: tabName } }));
      });
    });
  });
}

// ── BRANDING SYNC ─────────────────────────────────────────────
async function syncBranding() {
  try {
    const res  = await fetch('/api/public/settings');
    const json = await res.json();
    const data = json.data || {};

    // Company name
    if (data.company_name) {
      document.querySelectorAll('.company-name').forEach(el => {
        el.textContent = data.company_name;
      });
    }

    // Logo mark: image takes priority over text monogram
    document.querySelectorAll('.logo-mark, #sidebarLogoMark').forEach(el => {
      if (data.logo_url) {
        el.innerHTML = `<img src="${data.logo_url}?v=${Date.now()}" alt="Logo"
          style="width:100%;height:100%;object-fit:contain;border-radius:4px;display:block;">`;
        el.style.padding    = '2px';
        el.style.background = 'transparent';
        el.style.fontSize   = '0';
      } else {
        el.innerHTML       = '';
        el.textContent     = data.logo_text || 'OG';
        el.style.padding   = '';
        el.style.background = '';
        el.style.fontSize   = '';
      }
    });
  } catch { /* silently ignore */ }
}

// ── MIN DATE SETTER ───────────────────────────────────────────
function setMinDateToday(inputId) {
  const el = document.getElementById(inputId);
  if (el) el.min = todayStr();
}

// ── INIT ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initSidebar();
  updateCurrentDate();
  initModalClosers();
  initTabs();
  syncBranding();
  if (typeof initLanguage === 'function') initLanguage();
});
