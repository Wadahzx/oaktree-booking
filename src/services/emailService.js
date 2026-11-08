const nodemailer = require('nodemailer');
const { all, run } = require('../database/db');
const { buildIcs } = require('./ics');

const _fetch = typeof fetch !== 'undefined' ? fetch : null;

// Brand palette (from the Oaktree brand kit)
const NAVY  = '#1C2D3C';
const OLIVE = '#726944';
const SAND  = '#F2F0EA';

async function getConfig() {
  const rows = await all('SELECT key, value FROM admin_settings');
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

function getResendApiKey(cfg) {
  if (process.env.RESEND_API_KEY) return process.env.RESEND_API_KEY;
  if (cfg.resend_api_key) return cfg.resend_api_key;
  if (cfg.smtp_user === 'resend' && cfg.smtp_pass) return cfg.smtp_pass;
  return null;
}

// Plain text version without image links, so mail previews show real text
function toPlainText(html) {
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<img[^>]*>/gi, '')
    .replace(/<br\s*\/?>|<\/(p|div|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}
// Hidden preview line shown by mail apps next to the subject
function withPreheader(html) {
  const pre = toPlainText(html).replace(/\n/g, ' ').slice(0, 140);
  return `<div style="display:none;max-height:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:transparent;">${esc(pre)}</div>` + html;
}

async function sendViaResendApi(apiKey, fromAddress, to, subject, html, ics) {
  const body = { from: fromAddress, to: [to], subject, html: withPreheader(html), text: toPlainText(html) };
  if (ics) {
    body.attachments = [{
      filename: 'invite.ics',
      content: Buffer.from(ics.content, 'utf-8').toString('base64'),
      content_type: `text/calendar; charset=utf-8; method=${ics.method}`
    }];
  }
  const payload = JSON.stringify(body);
  const headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' };

  if (_fetch) {
    const res = await _fetch('https://api.resend.com/emails', { method: 'POST', headers, body: payload });
    const data = await res.json();
    if (!res.ok) throw new Error(`Resend: ${JSON.stringify(data)}`);
    return data;
  }

  const https = require('https');
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.resend.com', port: 443, path: '/emails', method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(payload) }
    }, res => {
      let out = '';
      res.on('data', c => out += c);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(JSON.parse(out));
        else reject(new Error(`Resend: ${out}`));
      });
    });
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Resend timeout')); });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function getTransporter(cfg) {
  if (cfg.brevo_smtp_key && cfg.brevo_smtp_user) {
    return nodemailer.createTransport({
      host: 'smtp-relay.brevo.com', port: 587, secure: false,
      auth: { user: cfg.brevo_smtp_user, pass: cfg.brevo_smtp_key }
    });
  }
  if (cfg.smtp_host && cfg.smtp_host !== 'smtp.resend.com' && cfg.smtp_user && cfg.smtp_pass) {
    return nodemailer.createTransport({
      host: cfg.smtp_host,
      port: parseInt(cfg.smtp_port || '587'),
      secure: cfg.smtp_port === '465',
      auth: { user: cfg.smtp_user, pass: cfg.smtp_pass }
    });
  }
  return null;
}

function getSenderAddress(cfg) {
  if (cfg.brevo_smtp_key && cfg.brevo_smtp_user) return `"Oaktree Group" <${cfg.brevo_smtp_user}>`;
  const apiKey = getResendApiKey(cfg);
  if (apiKey) return `Oaktree Group <${cfg.smtp_from || 'onboarding@resend.dev'}>`;
  return `"Oaktree Group" <${cfg.smtp_from || 'noreply@oaktree.com'}>`;
}

/**
 * @param {string} to
 * @param {string} subject
 * @param {string} html
 * @param {{method:string, content:string}=} ics  optional calendar invitation
 */
async function sendEmail(to, subject, html, ics) {
  const cfg = await getConfig();
  const apiKey = getResendApiKey(cfg);
  // Auto-enable if RESEND_API_KEY env var is set, otherwise check DB setting
  if (!apiKey && cfg.email_notifications_enabled !== 'true') {
    console.log(`[EMAIL] Disabled — would send to ${to}: ${subject}`);
    return;
  }
  if (apiKey) {
    const fromEnv  = process.env.RESEND_FROM || 'fathima@oaktree.sa';
    const fromDb   = cfg.smtp_from && cfg.smtp_from !== 'noreply@oaktree.com' ? cfg.smtp_from : null;
    const fromAddr = fromDb || fromEnv;
    const from = `Oaktree Group <${fromAddr}>`;
    await sendViaResendApi(apiKey, from, to, subject, html, ics);
    console.log(`[EMAIL] Sent via Resend API → ${to}`);
    return;
  }
  if (cfg.email_notifications_enabled !== 'true') {
    console.log(`[EMAIL] Disabled — would send to ${to}: ${subject}`);
    return;
  }
  const t = getTransporter(cfg);
  if (!t) { console.log(`[EMAIL] No email service configured.`); return; }
  const mail = { from: getSenderAddress(cfg), to, subject, html: withPreheader(html), text: toPlainText(html) };
  if (ics) mail.icalEvent = { method: ics.method, content: ics.content };
  await t.sendMail(mail);
  console.log(`[EMAIL] Sent via SMTP → ${to}`);
}

// ── Formatting (Arabic, Latin digits) ───────────────────────
function fmt12(t) {
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'م' : 'ص'}`;
}
function fmtDate(d) {
  return new Date(d + 'T12:00:00').toLocaleDateString('ar-SA-u-nu-latn-ca-gregory', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
}
const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const baseStyle   = `font-family:'Segoe UI',Tahoma,Arial,sans-serif;max-width:600px;margin:0 auto;background:${SAND};padding:20px;direction:rtl;text-align:right;`;
const headerStyle = (bg) => `background:${bg};color:#fff;padding:28px 30px;border-radius:8px 8px 0 0;text-align:center;`;
const bodyStyle   = `background:#fff;padding:32px;border-radius:0 0 8px 8px;border:1px solid #e3e0d6;border-top:none;direction:rtl;text-align:right;`;
const tableStyle  = `width:100%;border-collapse:collapse;`;
const tdLabel     = `padding:8px 0;color:#6b6b6b;width:34%;font-size:14px;`;
const tdValue     = `padding:8px 0;font-weight:600;color:${NAVY};font-size:14px;`;
const footerStyle = `color:#9a9a9a;font-size:12px;text-align:center;margin-top:20px;`;

function brandHeader(subtitle, bg = NAVY) {
  const logo = process.env.APP_URL
    ? `<img src="${process.env.APP_URL.replace(/\/$/, '')}/img/oaktree-logo-white.png" alt="Oaktree" height="34" style="height:34px;">`
    : `<span style="font-family:Georgia,'Times New Roman',serif;font-size:30px;letter-spacing:.5px;direction:ltr;display:inline-block;">Oaktree</span>`;
  return `<div style="${headerStyle(bg)}">${logo}<p style="margin:10px 0 0;opacity:.85;font-size:14px;">${subtitle}</p></div>`;
}

function bookingTable(b, bg, border, extraRows = '') {
  return `<div style="background:${bg};border-right:4px solid ${border};padding:16px;margin:20px 0;border-radius:4px;">
    <table style="${tableStyle}">
      <tr><td style="${tdLabel}">القاعة</td><td style="${tdValue}">${esc(b.room_name || b.room_id)}</td></tr>
      <tr><td style="${tdLabel}">التاريخ</td><td style="${tdValue}">${fmtDate(b.date)}</td></tr>
      <tr><td style="${tdLabel}">الوقت</td><td style="${tdValue}">${fmt12(b.start_time)} إلى ${fmt12(b.end_time)}</td></tr>
      <tr><td style="${tdLabel}">المدة</td><td style="${tdValue}">${b.duration} دقيقة</td></tr>
      <tr><td style="${tdLabel}">عنوان الاجتماع</td><td style="${tdValue}">${esc(b.purpose)}</td></tr>
      ${extraRows}
    </table>
  </div>`;
}

function parseAttendees(b) {
  try { return JSON.parse(b.attendees || '[]') || []; } catch { return []; }
}

const sequenceOf = b => Math.floor(new Date(b.updated_at || Date.now()).getTime() / 60000);

// ── Organizer confirmation (with calendar invite) ───────────
async function sendBookingConfirmation(booking) {
  const attendees = parseAttendees(booking);
  const names = attendees.map(a => esc(a.name || a.email)).join('، ');
  const html = `<div style="${baseStyle}">
    ${brandHeader('تأكيد حجز قاعة اجتماعات')}
    <div style="${bodyStyle}">
      <h2 style="color:${OLIVE};margin-top:0;">تم تأكيد الحجز</h2>
      <p>مرحباً ${esc(booking.employee_name)}،</p>
      <p>تم حجز القاعة بنجاح. تفاصيل الحجز:</p>
      ${bookingTable(booking, SAND, OLIVE, attendees.length ? `<tr><td style="${tdLabel}">المدعوون</td><td style="${tdValue}">${names}</td></tr>` : '')}
      <p style="color:#6b6b6b;font-size:14px;">${attendees.length ? 'أُرسلت دعوة الاجتماع إلى المشاركين، وأُرفقت دعوة التقويم بهذه الرسالة. ' : ''}سيصلك تذكير قبل بدء الاجتماع بـ 15 دقيقة.</p>
      <p style="color:#6b6b6b;font-size:14px;">لإلغاء الحجز أو تعديله، افتح صفحة <strong>حجوزاتي</strong> في نظام الحجز.</p>
      <p style="${footerStyle}">نظام حجز غرف الاجتماعات | Oaktree Group</p>
    </div>
  </div>`;
  const ics = { method: 'REQUEST', content: buildIcs({ booking, attendees, method: 'REQUEST', sequence: sequenceOf(booking) }) };
  await sendEmail(booking.employee_email, `تأكيد الحجز: ${booking.room_name}، ${fmtDate(booking.date)}`, html, ics);
}

// ── Invitation to each attendee (shows as a calendar invite) ─
async function sendMeetingInvitations(booking, { updated = false } = {}) {
  const attendees = parseAttendees(booking);
  if (!attendees.length) return;
  const ics = { method: 'REQUEST', content: buildIcs({ booking, attendees, method: 'REQUEST', sequence: sequenceOf(booking) }) };

  for (const a of attendees) {
    const html = `<div style="${baseStyle}">
      ${brandHeader(updated ? 'تحديث دعوة اجتماع' : 'دعوة اجتماع', OLIVE)}
      <div style="${bodyStyle}">
        <h2 style="color:${NAVY};margin-top:0;">لديك دعوة اجتماع في ${esc(booking.room_name)}</h2>
        <p>مرحباً ${esc(a.name || '')}،</p>
        <p>${updated ? 'تم تعديل موعد الاجتماع التالي' : 'دعاك'} <strong>${esc(booking.employee_name)}</strong> ${updated ? '' : 'إلى اجتماع'}:</p>
        ${bookingTable(booking, SAND, OLIVE, `<tr><td style="${tdLabel}">المنظم</td><td style="${tdValue}">${esc(booking.employee_name)}</td></tr>`)}
        <p style="color:#6b6b6b;font-size:14px;">أُرفقت دعوة تقويم (ملف .ics) بهذه الرسالة؛ افتحها لإضافة الاجتماع إلى تقويمك والرد عليه.</p>
        <p style="${footerStyle}">نظام حجز غرف الاجتماعات | Oaktree Group</p>
      </div>
    </div>`;
    try {
      await sendEmail(a.email, `دعوة اجتماع: ${booking.purpose}، ${booking.room_name}`, html, ics);
    } catch (e) {
      console.error('Invite email err:', a.email, e.message);
    }
  }
}

async function sendCancellationNotification(booking, reason) {
  const attendees = parseAttendees(booking);
  const html = (name) => `<div style="${baseStyle}">
    ${brandHeader('إلغاء حجز')}
    <div style="${bodyStyle}">
      <h2 style="color:#c0392b;margin-top:0;">تم إلغاء الحجز</h2>
      <p>مرحباً ${esc(name)}،</p>
      <p>تم إلغاء حجز القاعة / الاجتماع التالي.</p>
      ${bookingTable(booking, '#fff3f3', '#c0392b')}
      ${reason ? `<p style="color:#6b6b6b;font-size:14px;"><strong>السبب:</strong> ${esc(reason)}</p>` : ''}
      <p style="${footerStyle}">نظام حجز غرف الاجتماعات | Oaktree Group</p>
    </div>
  </div>`;
  const ics = { method: 'CANCEL', content: buildIcs({ booking, attendees, method: 'CANCEL', sequence: sequenceOf(booking) + 1 }) };
  const subject = `إلغاء الحجز: ${booking.room_name || booking.room_id}، ${fmtDate(booking.date)}`;
  await sendEmail(booking.employee_email, subject, html(booking.employee_name), ics);
  for (const a of attendees) {
    try { await sendEmail(a.email, `إلغاء اجتماع: ${booking.purpose}`, html(a.name || ''), ics); }
    catch (e) { console.error('Cancel email err:', a.email, e.message); }
  }
}

async function sendOverrideNotification(booking, reason) {
  const html = `<div style="${baseStyle}">
    ${brandHeader('تنبيه مهم: إلغاء حجز بالأولوية')}
    <div style="${bodyStyle}">
      <h2 style="color:#e67e22;margin-top:0;">تم إلغاء حجزك</h2>
      <p>مرحباً ${esc(booking.employee_name)}،</p>
      <p>ألغت الإدارة حجزك لإتاحة القاعة لاستخدام ذي أولوية.</p>
      ${bookingTable(booking, '#fff8f0', '#e67e22')}
      ${reason ? `<div style="background:#fff8f0;border-right:4px solid #e67e22;padding:12px;border-radius:4px;margin-bottom:16px;"><strong>السبب:</strong> ${esc(reason)}</div>` : ''}
      <p>نأمل حجز موعد بديل في أقرب وقت.</p>
      <p style="${footerStyle}">نظام حجز غرف الاجتماعات | Oaktree Group</p>
    </div>
  </div>`;
  const attendees = parseAttendees(booking);
  const ics = { method: 'CANCEL', content: buildIcs({ booking, attendees, method: 'CANCEL', sequence: sequenceOf(booking) + 1 }) };
  await sendEmail(booking.employee_email, `مهم: تم إلغاء حجزك، ${booking.room_name || booking.room_id}`, html, ics);
  for (const a of attendees) {
    try { await sendEmail(a.email, `إلغاء اجتماع: ${booking.purpose}`, html, ics); }
    catch (e) { console.error('Override email err:', a.email, e.message); }
  }
}

async function sendReminderEmail(booking) {
  const recipients = [{ name: booking.employee_name, email: booking.employee_email }, ...parseAttendees(booking)];
  for (const r of recipients) {
    const html = `<div style="${baseStyle}">
      ${brandHeader('تذكير بالاجتماع قبل 15 دقيقة', OLIVE)}
      <div style="${bodyStyle}">
        <h2 style="color:${OLIVE};margin-top:0;">يبدأ اجتماعك بعد 15 دقيقة</h2>
        <p>مرحباً ${esc(r.name || '')}،</p>
        <p>تذكير بأن اجتماعك سيبدأ قريباً.</p>
        <div style="background:${SAND};border-right:4px solid ${OLIVE};padding:16px;margin:20px 0;border-radius:4px;">
          <table style="${tableStyle}">
            <tr><td style="${tdLabel}">القاعة</td><td style="${tdValue}">${esc(booking.room_name)}</td></tr>
            <tr><td style="${tdLabel}">الوقت</td><td style="${tdValue}">${fmt12(booking.start_time)} إلى ${fmt12(booking.end_time)}</td></tr>
            <tr><td style="${tdLabel}">عنوان الاجتماع</td><td style="${tdValue}">${esc(booking.purpose)}</td></tr>
          </table>
        </div>
        <p style="${footerStyle}">هذا تذكير تلقائي من نظام حجز غرف الاجتماعات | Oaktree Group</p>
      </div>
    </div>`;
    try { await sendEmail(r.email, `تذكير: ${booking.room_name}، الاجتماع بعد 15 دقيقة`, html); }
    catch (e) { console.error('Reminder email err:', r.email, e.message); }
  }
}

async function sendReminderEmails() {
  const tz = 'Asia/Riyadh';
  const in15 = new Date(Date.now() + 15 * 60 * 1000);
  const dateStr = in15.toLocaleDateString('en-CA', { timeZone: tz });
  const timeStr = in15.toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });

  const bookings = await all(`
    SELECT b.*, r.name as room_name FROM bookings b JOIN rooms r ON b.room_id=r.id
    WHERE b.date=? AND b.start_time=? AND b.status='confirmed' AND b.reminder_sent=0
  `, [dateStr, timeStr]);

  for (const b of bookings) {
    await sendReminderEmail(b);
    await run('UPDATE bookings SET reminder_sent=1 WHERE id=?', [b.id]);
  }
}

async function sendTestEmail(toAddress) {
  const cfg = await getConfig();
  const apiKey = getResendApiKey(cfg);
  const html = `<div style="${baseStyle}">${brandHeader('اختبار البريد')}<div style="${bodyStyle}"><h2 style="color:${OLIVE};margin-top:0;">البريد يعمل بنجاح</h2><p>تم إعداد البريد الإلكتروني بشكل صحيح، وسيتم إرسال تأكيدات الحجز ودعوات الاجتماعات تلقائياً.</p><p style="${footerStyle}">نظام حجز غرف الاجتماعات | Oaktree Group</p></div></div>`;

  if (apiKey) {
    const from = cfg.smtp_from && cfg.smtp_from !== 'noreply@oaktree.com'
      ? `Oaktree Group <${cfg.smtp_from}>`
      : 'Oaktree Group <onboarding@resend.dev>';
    await sendViaResendApi(apiKey, from, toAddress, 'اختبار البريد | نظام حجز غرف Oaktree', html);
    return { isEthereal: false, message: `تم إرسال رسالة الاختبار إلى ${toAddress} عبر Resend` };
  }

  const transporter = getTransporter(cfg);
  if (transporter) {
    await transporter.sendMail({ from: getSenderAddress(cfg), to: toAddress, subject: 'اختبار البريد | نظام حجز غرف Oaktree', html });
    return { isEthereal: false, message: `تم إرسال رسالة الاختبار إلى ${toAddress}` };
  }

  const testAccount = await nodemailer.createTestAccount();
  const t = nodemailer.createTransport({ host: 'smtp.ethereal.email', port: 587, secure: false, auth: { user: testAccount.user, pass: testAccount.pass } });
  const info = await t.sendMail({ from: '"Oaktree" <noreply@oaktree.com>', to: toAddress, subject: 'اختبار | نظام حجز Oaktree', html });
  return { isEthereal: true, previewUrl: nodemailer.getTestMessageUrl(info), message: 'لم يتم إعداد خدمة بريد. معاينة فقط.' };
}

module.exports = {
  sendBookingConfirmation, sendMeetingInvitations, sendCancellationNotification,
  sendOverrideNotification, sendReminderEmails, sendTestEmail
};
