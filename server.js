require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');

const { initializeDatabase, all } = require('./src/database/db');
const bookingsRouter = require('./src/routes/bookings');
const adminRouter    = require('./src/routes/admin');
const roomsRouter    = require('./src/routes/rooms');
const { sendReminderEmails } = require('./src/services/emailService');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// DB init — runs once per Lambda container (or once at startup locally)
let dbReady = null;
function ensureDb() {
  if (!dbReady) {
    dbReady = initializeDatabase().catch(e => { dbReady = null; throw e; });
  }
  return dbReady;
}

app.use(async (req, res, next) => {
  try { await ensureDb(); next(); }
  catch (e) { res.status(500).json({ success: false, error: 'Database initialization failed: ' + e.message }); }
});

app.use('/api/bookings', bookingsRouter);
app.use('/api/admin',    adminRouter);
app.use('/api/rooms',    roomsRouter);

// Public settings (no auth)
app.get('/api/public/settings', async (req, res) => {
  try {
    const rows = await all("SELECT key, value FROM admin_settings WHERE key IN ('company_name','logo_text','logo_url')");
    const s = Object.fromEntries(rows.map(r => [r.key, r.value]));
    res.json({ success: true, data: s });
  } catch {
    res.json({ success: true, data: { company_name: 'Oaktree Group', logo_text: 'OG', logo_url: '' } });
  }
});

// Cron endpoint — Vercel calls this every minute (Pro plan) to send reminders
app.post('/api/cron/reminders', async (req, res) => {
  try {
    await sendReminderEmails();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/',            (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/book',        (req, res) => res.sendFile(path.join(__dirname, 'public', 'book.html')));
app.get('/calendar',    (req, res) => res.sendFile(path.join(__dirname, 'public', 'calendar.html')));
app.get('/my-bookings', (req, res) => res.sendFile(path.join(__dirname, 'public', 'my-bookings.html')));
app.get('/admin',       (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// Local development only: start server + cron
if (!process.env.VERCEL) {
  const cron = require('node-cron');
  ensureDb().then(() => {
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
  }).catch(err => { console.error('Failed to start server:', err); process.exit(1); });
}

module.exports = app;
