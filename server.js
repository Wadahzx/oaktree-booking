require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const cron    = require('node-cron');

const { initializeDatabase } = require('./src/database/db');
const bookingsRouter = require('./src/routes/bookings');
const adminRouter    = require('./src/routes/admin');
const roomsRouter    = require('./src/routes/rooms');
const { sendReminderEmails } = require('./src/services/emailService');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Serve uploaded files (logo etc.) from configurable uploads dir (supports persistent disk on Render)
const uploadsDir = process.env.UPLOADS_DIR || path.join(__dirname, 'public/uploads');
app.use('/uploads', require('express').static(uploadsDir));

app.use('/api/bookings', bookingsRouter);
app.use('/api/admin',    adminRouter);
app.use('/api/rooms',    roomsRouter);

// Public settings (no auth) — returns branding info visible to all users
app.get('/api/public/settings', (req, res) => {
  try {
    const { getDb } = require('./src/database/db');
    const db = getDb();
    const rows = db.prepare(
      "SELECT key, value FROM admin_settings WHERE key IN ('company_name','logo_text','logo_url')"
    ).all();
    const s = Object.fromEntries(rows.map(r => [r.key, r.value]));
    res.json({ success: true, data: s });
  } catch {
    res.json({ success: true, data: { company_name: 'Oaktree Group', logo_text: 'OG', logo_url: '' } });
  }
});

app.get('/',            (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/book',        (req, res) => res.sendFile(path.join(__dirname, 'public', 'book.html')));
app.get('/calendar',    (req, res) => res.sendFile(path.join(__dirname, 'public', 'calendar.html')));
app.get('/my-bookings', (req, res) => res.sendFile(path.join(__dirname, 'public', 'my-bookings.html')));
app.get('/admin',       (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

async function start() {
  await initializeDatabase();

  // Every minute: check for meetings starting in 15 min and send reminders
  cron.schedule('* * * * *', () => {
    sendReminderEmails().catch(e => console.error('Reminder cron error:', e));
  });

  app.listen(PORT, () => {
    console.log('\n  ╔══════════════════════════════════════════╗');
    console.log(`  ║   Oaktree Group — Meeting Room Booking   ║`);
    console.log(`  ║                                          ║`);
    console.log(`  ║   http://localhost:${PORT}                   ║`);
    console.log(`  ║   Admin code: Fathima                    ║`);
    console.log('  ╚══════════════════════════════════════════╝\n');
  });
}

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
