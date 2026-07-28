const nodemailer = require('nodemailer');
const { all, run } = require('../database/db');

const _fetch = typeof fetch !== 'undefined' ? fetch : null;

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

async function sendViaResendApi(apiKey, fromAddress, to, subject, html) {
  const payload = JSON.stringify({ from: fromAddress, to: [to], subject, html });
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
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(JSON.parse(body));
        else reject(new Error(`Resend: ${body}`));
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
  if (cfg.brevo_smtp_key && cfg.brevo_smtp_user) return `"Oaktree Group Bookings" <${cfg.brevo_smtp_user}>`;
  const apiKey = getResendApiKey(cfg);
  if (apiKey) return `Oaktree Group Bookings <${cfg.smtp_from || 'onboarding@resend.dev'}>`;
  return `"Oaktree Group Bookings" <${cfg.smtp_from || 'noreply@oaktree.com'}>`;
}

async function sendEmail(to, subject, html) {
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
    const from = `Oaktree Group Bookings <${fromAddr}>`;
    await sendViaResendApi(apiKey, from, to, subject, html);
    console.log(`[EMAIL] Sent via Resend API → ${to}`);
    return;
  }
  if (cfg.email_notifications_enabled !== 'true') {
    console.log(`[EMAIL] Disabled — would send to ${to}: ${subject}`);
    return;
  }
  const t = getTransporter(cfg);
  if (!t) { console.log(`[EMAIL] No email service configured.`); return; }
  await t.sendMail({ from: getSenderAddress(cfg), to, subject, html });
  console.log(`[EMAIL] Sent via SMTP → ${to}`);
}

function fmt12(t) {
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}
function fmtDate(d) {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

const baseStyle  = `font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;background:#f4f4f6;padding:20px;`;
const headerStyle = (bg) => `background:${bg};color:white;padding:30px;border-radius:8px 8px 0 0;text-align:center;`;
const bodyStyle  = `background:#fff;padding:32px;border-radius:0 0 8px 8px;border:1px solid #e0e0e0;border-top:none;`;
const tableStyle = `width:100%;border-collapse:collapse;`;
const tdLabel    = `padding:8px 0;color:#666;width:38%;font-size:14px;`;
const tdValue    = `padding:8px 0;font-weight:600;color:#1B2A4A;font-size:14px;`;
const footerStyle = `color:#aaa;font-size:12px;text-align:center;margin-top:20px;`;

function bookingTable(b, bg, border) {
  return `<div style="background:${bg};border-left:4px solid ${border};padding:16px;margin:20px 0;border-radius:4px;">
    <table style="${tableStyle}">
      <tr><td style="${tdLabel}">Room</td><td style="${tdValue}">${b.room_name || b.room_id}</td></tr>
      <tr><td style="${tdLabel}">Date</td><td style="${tdValue}">${fmtDate(b.date)}</td></tr>
      <tr><td style="${tdLabel}">Time</td><td style="${tdValue}">${fmt12(b.start_time)} – ${fmt12(b.end_time)}</td></tr>
      <tr><td style="${tdLabel}">Duration</td><td style="${tdValue}">${b.duration} minutes</td></tr>
      <tr><td style="${tdLabel}">Purpose</td><td style="${tdValue}">${b.purpose}</td></tr>
      <tr><td style="${tdLabel}">Booking ID</td><td style="padding:8px 0;font-family:monospace;color:#888;font-size:12px;">${b.id}</td></tr>
    </table>
  </div>`;
}

async function sendBookingConfirmation(booking) {
  const html = `<div style="${baseStyle}">
    <div style="${headerStyle('#1B2A4A')}">
      <h1 style="margin:0;font-size:22px;">Oaktree Group</h1>
      <p style="margin:6px 0 0;opacity:.8;font-size:14px;">Meeting Room Booking Confirmation</p>
    </div>
    <div style="${bodyStyle}">
      <h2 style="color:#2A5C45;margin-top:0;">Booking Confirmed</h2>
      <p>Dear ${booking.employee_name},</p>
      <p>Your meeting room has been successfully booked. Here are your booking details:</p>
      ${bookingTable(booking, '#f0f7f4', '#2A5C45')}
      <p style="color:#666;font-size:14px;">You will receive a reminder 15 minutes before your meeting starts.</p>
      <p style="color:#666;font-size:14px;">To cancel or modify this booking, visit <strong>My Bookings</strong> on the Oaktree booking system.</p>
      <p style="${footerStyle}">Oaktree Group Meeting Room Booking System</p>
    </div>
  </div>`;
  await sendEmail(booking.employee_email, `Booking Confirmed: ${booking.room_name} – ${fmtDate(booking.date)}`, html);
}

async function sendCancellationNotification(booking, reason) {
  const html = `<div style="${baseStyle}">
    <div style="${headerStyle('#1B2A4A')}">
      <h1 style="margin:0;font-size:22px;">Oaktree Group</h1>
      <p style="margin:6px 0 0;opacity:.8;font-size:14px;">Booking Cancellation</p>
    </div>
    <div style="${bodyStyle}">
      <h2 style="color:#c0392b;margin-top:0;">Booking Cancelled</h2>
      <p>Dear ${booking.employee_name},</p>
      <p>Your meeting room booking has been cancelled.</p>
      ${bookingTable(booking, '#fff3f3', '#c0392b')}
      ${reason ? `<p style="color:#666;font-size:14px;"><strong>Reason:</strong> ${reason}</p>` : ''}
      <p style="${footerStyle}">Oaktree Group Meeting Room Booking System</p>
    </div>
  </div>`;
  await sendEmail(booking.employee_email, `Booking Cancelled: ${booking.room_name || booking.room_id} – ${fmtDate(booking.date)}`, html);
}

async function sendOverrideNotification(booking, reason) {
  const html = `<div style="${baseStyle}">
    <div style="${headerStyle('#1B2A4A')}">
      <h1 style="margin:0;font-size:22px;">Oaktree Group</h1>
      <p style="margin:6px 0 0;opacity:.8;font-size:14px;">Important: Booking Override Notice</p>
    </div>
    <div style="${bodyStyle}">
      <h2 style="color:#e67e22;margin-top:0;">Your Booking Has Been Overridden</h2>
      <p>Dear ${booking.employee_name},</p>
      <p>Your meeting room booking has been overridden by administration for priority use.</p>
      ${bookingTable(booking, '#fff8f0', '#e67e22')}
      ${reason ? `<div style="background:#fff8f0;border-left:4px solid #e67e22;padding:12px;border-radius:4px;margin-bottom:16px;"><strong>Reason:</strong> ${reason}</div>` : ''}
      <p>Please book an alternative time slot at your earliest convenience.</p>
      <p style="${footerStyle}">Oaktree Group Meeting Room Booking System</p>
    </div>
  </div>`;
  await sendEmail(booking.employee_email, `IMPORTANT: Your Booking Has Been Overridden – ${booking.room_name || booking.room_id}`, html);
}

async function sendReminderEmail(booking) {
  const html = `<div style="${baseStyle}">
    <div style="${headerStyle('#2A5C45')}">
      <h1 style="margin:0;font-size:22px;">Oaktree Group</h1>
      <p style="margin:6px 0 0;opacity:.8;font-size:14px;">Meeting Reminder – 15 Minutes</p>
    </div>
    <div style="${bodyStyle}">
      <h2 style="color:#2A5C45;margin-top:0;">Your Meeting Starts in 15 Minutes</h2>
      <p>Dear ${booking.employee_name},</p>
      <p>This is a friendly reminder that your meeting room booking starts shortly.</p>
      <div style="background:#f0f7f4;border-left:4px solid #2A5C45;padding:16px;margin:20px 0;border-radius:4px;">
        <table style="${tableStyle}">
          <tr><td style="${tdLabel}">Room</td><td style="${tdValue}">${booking.room_name}</td></tr>
          <tr><td style="${tdLabel}">Time</td><td style="${tdValue}">${fmt12(booking.start_time)} – ${fmt12(booking.end_time)}</td></tr>
          <tr><td style="${tdLabel}">Purpose</td><td style="${tdValue}">${booking.purpose}</td></tr>
        </table>
      </div>
      <p style="${footerStyle}">This is an automated reminder from the Oaktree Group Meeting Room Booking System.</p>
    </div>
  </div>`;
  await sendEmail(booking.employee_email, `Reminder: ${booking.room_name} – Meeting in 15 Minutes`, html);
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

  if (apiKey) {
    const from = cfg.smtp_from && cfg.smtp_from !== 'noreply@oaktree.com'
      ? `Oaktree Group Bookings <${cfg.smtp_from}>`
      : 'Oaktree Group Bookings <onboarding@resend.dev>';
    const html = `<div style="${baseStyle}"><div style="${headerStyle('#1B2A4A')}"><h1 style="margin:0;font-size:22px;">Oaktree Group</h1><p style="margin:6px 0 0;opacity:.8;font-size:14px;">Email Test</p></div><div style="${bodyStyle}"><h2 style="color:#2A5C45;margin-top:0;">Email is working!</h2><p>Your email setup is working. Booking confirmations will be sent automatically.</p><p style="${footerStyle}">Oaktree Group Meeting Room Booking System</p></div></div>`;
    await sendViaResendApi(apiKey, from, toAddress, 'Test Email – Oaktree Meeting Room Booking', html);
    return { isEthereal: false, message: `Test email sent to ${toAddress} via Resend` };
  }

  const transporter = getTransporter(cfg);
  if (transporter) {
    const html = `<div style="${baseStyle}"><div style="${headerStyle('#1B2A4A')}"><h1 style="margin:0;font-size:22px;">Oaktree Group</h1></div><div style="${bodyStyle}"><h2 style="color:#2A5C45;margin-top:0;">Email is working!</h2><p>Your email setup is working correctly.</p></div></div>`;
    await transporter.sendMail({ from: getSenderAddress(cfg), to: toAddress, subject: 'Test Email – Oaktree Meeting Room Booking', html });
    return { isEthereal: false, message: `Test email sent to ${toAddress}` };
  }

  const testAccount = await nodemailer.createTestAccount();
  const t = nodemailer.createTransport({ host: 'smtp.ethereal.email', port: 587, secure: false, auth: { user: testAccount.user, pass: testAccount.pass } });
  const html = `<div style="${baseStyle}"><div style="${bodyStyle}"><h2>Test email preview</h2><p>Configure Resend API key in Admin Settings to send real emails.</p></div></div>`;
  const info = await t.sendMail({ from: '"Oaktree" <noreply@oaktree.com>', to: toAddress, subject: 'Test – Oaktree Booking', html });
  return { isEthereal: true, previewUrl: nodemailer.getTestMessageUrl(info), message: 'No email service configured. Preview only.' };
}

module.exports = { sendBookingConfirmation, sendCancellationNotification, sendOverrideNotification, sendReminderEmails, sendTestEmail };
