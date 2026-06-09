const nodemailer = require('nodemailer');
const { getDb } = require('../database/db');

function getConfig() {
  const rows = getDb().prepare('SELECT key, value FROM admin_settings').all();
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

function getTransporter(cfg) {
  // Priority 1: Brevo SMTP key (no domain verification needed)
  if (cfg.brevo_smtp_key && cfg.brevo_smtp_user) {
    return nodemailer.createTransport({
      host:   'smtp-relay.brevo.com',
      port:   587,
      secure: false,
      auth:   { user: cfg.brevo_smtp_user, pass: cfg.brevo_smtp_key }
    });
  }
  // Priority 2: Resend API key (needs verified domain for sending to any address)
  if (cfg.resend_api_key) {
    return nodemailer.createTransport({
      host:   'smtp.resend.com',
      port:   465,
      secure: true,
      auth:   { user: 'resend', pass: cfg.resend_api_key }
    });
  }
  // Priority 3: Custom SMTP
  if (cfg.smtp_host && cfg.smtp_user && cfg.smtp_pass) {
    return nodemailer.createTransport({
      host:   cfg.smtp_host,
      port:   parseInt(cfg.smtp_port || '587'),
      secure: cfg.smtp_port === '465',
      auth:   { user: cfg.smtp_user, pass: cfg.smtp_pass }
    });
  }
  return null;
}

function getSenderAddress(cfg) {
  if (cfg.brevo_smtp_key && cfg.brevo_smtp_user) {
    return `"Oaktree Group Bookings" <${cfg.brevo_smtp_user}>`;
  }
  if (cfg.resend_api_key) {
    return 'Oaktree Group Bookings <onboarding@resend.dev>';
  }
  return `"Oaktree Group Bookings" <${cfg.smtp_from || 'noreply@oaktree.com'}>`;
}

function fmt12(t) {
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2,'0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

function fmtDate(d) {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
}

const baseStyle = `font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;background:#f4f4f6;padding:20px;`;
const headerStyle = (bg) => `background:${bg};color:white;padding:30px;border-radius:8px 8px 0 0;text-align:center;`;
const bodyStyle = `background:#fff;padding:32px;border-radius:0 0 8px 8px;border:1px solid #e0e0e0;border-top:none;`;
const tableStyle = `width:100%;border-collapse:collapse;`;
const tdLabel = `padding:8px 0;color:#666;width:38%;font-size:14px;`;
const tdValue = `padding:8px 0;font-weight:600;color:#1B2A4A;font-size:14px;`;
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
  const cfg = getConfig();
  if (cfg.email_notifications_enabled !== 'true') {
    console.log(`[EMAIL] Notifications disabled. Confirmation skipped for ${booking.employee_email}`);
    return;
  }
  const t = getTransporter(cfg);
  if (!t) {
    console.log(`[EMAIL] No email service configured. Go to Admin → Settings → Email to set up Resend (free).`);
    return;
  }

  const html = `<div style="${baseStyle}">
    <div style="${headerStyle('#1B2A4A')}">
      <h1 style="margin:0;font-size:22px;">Oaktree Group</h1>
      <p style="margin:6px 0 0;opacity:.8;font-size:14px;">Meeting Room Booking Confirmation</p>
    </div>
    <div style="${bodyStyle}">
      <h2 style="color:#2A5C45;margin-top:0;">✓ Booking Confirmed</h2>
      <p>Dear ${booking.employee_name},</p>
      <p>Your meeting room has been successfully booked. Here are your booking details:</p>
      ${bookingTable(booking, '#f0f7f4', '#2A5C45')}
      <p style="color:#666;font-size:14px;">You will receive a reminder 15 minutes before your meeting starts.</p>
      <p style="color:#666;font-size:14px;">To cancel or modify this booking, visit <strong>My Bookings</strong> on the Oaktree booking system and use your email address to access your reservations.</p>
      <p style="${footerStyle}">This is an automated message from the Oaktree Group Meeting Room Booking System. Do not reply to this email.</p>
    </div>
  </div>`;

  await t.sendMail({
    from: getSenderAddress(cfg),
    to: booking.employee_email,
    subject: `Booking Confirmed: ${booking.room_name} – ${fmtDate(booking.date)}`,
    html
  });
}

async function sendCancellationNotification(booking, reason) {
  const cfg = getConfig();
  if (cfg.email_notifications_enabled !== 'true') {
    console.log(`[EMAIL] Cancellation → ${booking.employee_email} | ${booking.id}`);
    return;
  }
  const t = getTransporter(cfg);
  if (!t) return;

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
      <p style="color:#666;font-size:14px;">To make a new booking, please visit the Oaktree Meeting Room Booking System.</p>
      <p style="${footerStyle}">This is an automated message from the Oaktree Group Meeting Room Booking System.</p>
    </div>
  </div>`;

  await t.sendMail({
    from: getSenderAddress(cfg),
    to: booking.employee_email,
    subject: `Booking Cancelled: ${booking.room_name || booking.room_id} – ${fmtDate(booking.date)}`,
    html
  });
}

async function sendOverrideNotification(booking, reason) {
  const cfg = getConfig();
  if (cfg.email_notifications_enabled !== 'true') {
    console.log(`[EMAIL] Override → ${booking.employee_email} | ${booking.id} | ${reason}`);
    return;
  }
  const t = getTransporter(cfg);
  if (!t) return;

  const html = `<div style="${baseStyle}">
    <div style="${headerStyle('#1B2A4A')}">
      <h1 style="margin:0;font-size:22px;">Oaktree Group</h1>
      <p style="margin:6px 0 0;opacity:.8;font-size:14px;">Important: Booking Override Notice</p>
    </div>
    <div style="${bodyStyle}">
      <h2 style="color:#e67e22;margin-top:0;">⚠ Your Booking Has Been Overridden</h2>
      <p>Dear ${booking.employee_name},</p>
      <p>We regret to inform you that your meeting room booking has been overridden by administration for priority use.</p>
      ${bookingTable(booking, '#fff8f0', '#e67e22')}
      ${reason ? `<div style="background:#fff8f0;border-left:4px solid #e67e22;padding:12px;border-radius:4px;margin-bottom:16px;"><strong>Reason:</strong> ${reason}</div>` : ''}
      <p>Please book an alternative time slot at your earliest convenience.</p>
      <p style="color:#666;font-size:14px;">We sincerely apologise for any inconvenience caused.</p>
      <p style="${footerStyle}">This is an automated message from the Oaktree Group Meeting Room Booking System.</p>
    </div>
  </div>`;

  await t.sendMail({
    from: getSenderAddress(cfg),
    to: booking.employee_email,
    subject: `IMPORTANT: Your Booking Has Been Overridden – ${booking.room_name || booking.room_id}`,
    html
  });
}

async function sendReminderEmail(booking) {
  const cfg = getConfig();
  if (cfg.email_notifications_enabled !== 'true') {
    console.log(`[EMAIL] Reminder → ${booking.employee_email} | Meeting in 15 min at ${booking.start_time}`);
    return;
  }
  const t = getTransporter(cfg);
  if (!t) return;

  const html = `<div style="${baseStyle}">
    <div style="${headerStyle('#2A5C45')}">
      <h1 style="margin:0;font-size:22px;">Oaktree Group</h1>
      <p style="margin:6px 0 0;opacity:.8;font-size:14px;">Meeting Reminder – 15 Minutes</p>
    </div>
    <div style="${bodyStyle}">
      <h2 style="color:#2A5C45;margin-top:0;">⏰ Your Meeting Starts in 15 Minutes</h2>
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

  await t.sendMail({
    from: getSenderAddress(cfg),
    to: booking.employee_email,
    subject: `Reminder: ${booking.room_name} – Meeting in 15 Minutes`,
    html
  });
}

async function sendReminderEmails() {
  const db = getDb();
  const in15 = new Date(Date.now() + 15 * 60 * 1000);
  const dateStr = in15.toISOString().split('T')[0];
  const timeStr = `${String(in15.getHours()).padStart(2,'0')}:${String(in15.getMinutes()).padStart(2,'0')}`;

  const bookings = db.prepare(`
    SELECT b.*, r.name as room_name FROM bookings b JOIN rooms r ON b.room_id=r.id
    WHERE b.date=? AND b.start_time=? AND b.status='confirmed' AND b.reminder_sent=0
  `).all(dateStr, timeStr);

  for (const b of bookings) {
    await sendReminderEmail(b);
    db.prepare('UPDATE bookings SET reminder_sent=1 WHERE id=?').run(b.id);
  }
}

async function sendTestEmail(toAddress) {
  const cfg = getConfig();
  let isEthereal = false;
  let previewUrl = null;

  // Use the same transporter logic as all other emails (Resend key takes priority)
  let transporter = getTransporter(cfg);

  if (!transporter) {
    // Nothing configured at all — fall back to Ethereal so the user can at least
    // see a preview and know the email system itself works
    isEthereal = true;
    const testAccount = await nodemailer.createTestAccount();
    transporter = nodemailer.createTransport({
      host:   'smtp.ethereal.email',
      port:   587,
      secure: false,
      auth:   { user: testAccount.user, pass: testAccount.pass }
    });
  }

  const html = `<div style="${baseStyle}">
    <div style="${headerStyle('#1B2A4A')}">
      <h1 style="margin:0;font-size:22px;">Oaktree Group</h1>
      <p style="margin:6px 0 0;opacity:.8;font-size:14px;">Email Configuration Test</p>
    </div>
    <div style="${bodyStyle}">
      <h2 style="color:#2A5C45;margin-top:0;">✓ Email is working!</h2>
      <p>This is a test email from the <strong>Oaktree Meeting Room Booking System</strong>.</p>
      <p>If you received this, your SMTP configuration is working correctly and booking confirmations will be delivered to employees.</p>
      <p style="${footerStyle}">Oaktree Group Meeting Room Booking System</p>
    </div>
  </div>`;

  const info = await transporter.sendMail({
    from:    isEthereal ? '"Oaktree Group Bookings" <noreply@oaktree.com>' : getSenderAddress(cfg),
    to:      toAddress,
    subject: 'Test Email – Oaktree Meeting Room Booking',
    html
  });

  if (isEthereal) {
    previewUrl = nodemailer.getTestMessageUrl(info);
    console.log(`[EMAIL TEST] Ethereal preview URL: ${previewUrl}`);
    return { isEthereal: true, previewUrl, message: 'Test sent via Ethereal (preview only). Configure SMTP to send real emails.' };
  }

  console.log(`[EMAIL TEST] Sent to ${toAddress} via ${cfg.smtp_host}`);
  return { isEthereal: false, message: `Test email delivered to ${toAddress}.` };
}

module.exports = { sendBookingConfirmation, sendCancellationNotification, sendOverrideNotification, sendReminderEmails, sendTestEmail };
