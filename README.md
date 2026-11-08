# Oaktree Group — Meeting Room Booking System

Internal meeting room reservation platform for Oaktree Group HQ.

## Quick Start

### 1. Install Node.js
Download and install Node.js (v18+) from: https://nodejs.org

### 2. Install dependencies
Open a terminal in this folder and run:
```
npm install
```

### 3. Start the server
```
npm start
```

Or for development with auto-restart:
```
npm run dev
```

### 4. Open the app
Visit: **http://localhost:3000**

---

## Admin Access
- Navigate to **http://localhost:3000/admin**
- Enter the access code set in the `ADMIN_CODE` environment variable (set a strong one in production)

---

## Email Setup (Optional)
By default, emails are logged to the console. To enable real email delivery:
1. Open the Admin Panel → Settings → Email / SMTP
2. Enter your SMTP credentials (Office 365, Gmail, etc.)
3. Enable "Email Notifications"

Or edit `.env`:
```
SMTP_HOST=smtp.office365.com
SMTP_PORT=587
SMTP_USER=your-email@oaktree.com
SMTP_PASS=your-password
SMTP_FROM=noreply@oaktree.com
```

---

## Features
- **Two meeting rooms**: Boardroom (12 people), Meeting room (4 people)
- **No login required** for employees — just enter name + email when booking
- **Admin panel** with full management controls
- **Email notifications**: booking confirmation, cancellation, override alerts, 15-min reminders
- **Calendar view**: day and week views with color-coded bookings
- **Dark mode** toggle
- **Booking rules**: office hours (8am–6pm), max 2 hours, 30-min slots
- **Admin features**: block slots, recurring bookings, analytics, audit log

---

## Project Structure
```
oaktree-booking/
├── server.js              # Express server + cron jobs
├── src/
│   ├── database/db.js     # SQLite setup + schema
│   ├── routes/
│   │   ├── bookings.js    # Employee booking CRUD
│   │   ├── admin.js       # Admin operations
│   │   └── rooms.js       # Room availability
│   └── services/
│       └── emailService.js # Nodemailer email service
├── public/
│   ├── index.html         # Dashboard
│   ├── book.html          # Book a room
│   ├── calendar.html      # Calendar view
│   ├── my-bookings.html   # My reservations
│   ├── admin.html         # Admin panel
│   ├── css/styles.css     # Full design system
│   └── js/                # Page-specific scripts
└── data/
    └── oaktree.db         # SQLite database (auto-created)
```
