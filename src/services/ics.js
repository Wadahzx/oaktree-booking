// Minimal iCalendar (RFC 5545) builder for meeting invitations.
// Riyadh is UTC+3 all year (no DST), so local times convert with a fixed offset.

function toUtcStamp(date, time) {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h - 3, mi, 0)).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

const esc = s => String(s == null ? '' : s)
  .replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

// Fold lines at 75 octets without splitting multi-byte characters.
function fold(line) {
  const parts = [];
  let cur = '';
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch) > (parts.length ? 74 : 75)) { parts.push(cur); cur = ch; }
    else cur += ch;
  }
  parts.push(cur);
  return parts.join('\r\n ');
}

/**
 * @param {object} p
 * @param {object} p.booking   booking row (id, date, start_time, end_time, purpose, notes, room_name, employee_name, employee_email)
 * @param {Array}  p.attendees [{name, email}] (the organizer is added automatically)
 * @param {'REQUEST'|'CANCEL'} p.method
 * @param {number} p.sequence  bump on every update so calendars replace the old copy
 */
function eventLines(booking, people, cancelled, sequence) {
  const lines = [
    'BEGIN:VEVENT',
    `UID:${booking.id}@oaktree-booking`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`,
    `DTSTART:${toUtcStamp(booking.date, booking.start_time)}`,
    `DTEND:${toUtcStamp(booking.date, booking.end_time)}`,
    `SEQUENCE:${sequence}`,
    `SUMMARY:${esc(booking.purpose)}`,
    `LOCATION:${esc(`${booking.room_name}، مقر مجموعة Oaktree`)}`,
    `DESCRIPTION:${esc(`${booking.purpose}\nالمنظم: ${booking.employee_name}${booking.notes ? `\n${booking.notes}` : ''}`)}`,
    `STATUS:${cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
    `ORGANIZER;CN=${esc(booking.employee_name)}:mailto:${booking.employee_email}`,
    ...people.map(p => `ATTENDEE;CN=${esc(p.name || p.email)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${p.email}`)
  ];
  if (!cancelled) lines.push('BEGIN:VALARM', 'TRIGGER:-PT15M', 'ACTION:DISPLAY', 'DESCRIPTION:تذكير بالاجتماع', 'END:VALARM');
  lines.push('END:VEVENT');
  return lines;
}

/**
 * @param {object} p
 * @param {object} p.booking   booking row
 * @param {Array}  p.attendees [{name, email}] (the organizer is added automatically)
 * @param {Array}  p.series    extra booking rows of a recurring series (one VEVENT each)
 * @param {'REQUEST'|'CANCEL'} p.method
 * @param {number} p.sequence
 */
function buildIcs({ booking, attendees = [], series = [], method = 'REQUEST', sequence = 0 }) {
  const cancelled = method === 'CANCEL';
  const people = [{ name: booking.employee_name, email: booking.employee_email }, ...attendees];
  const lines = [
    'BEGIN:VCALENDAR',
    'PRODID:-//Oaktree Group//Meeting Rooms//AR',
    'VERSION:2.0',
    'CALSCALE:GREGORIAN',
    `METHOD:${method}`
  ];
  for (const b of [booking, ...series]) lines.push(...eventLines(b, people, cancelled, sequence));
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

module.exports = { buildIcs };
