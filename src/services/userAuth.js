// Email-code login for "My bookings": a 6 digit code is emailed, then exchanged for a short-lived signed token.
const crypto = require('crypto');

const USER_TTL_MS = 4 * 60 * 60 * 1000;
const secret = () => process.env.SESSION_SECRET || ((process.env.ADMIN_CODE || 'Fathima') + '|' + (process.env.DATABASE_URL || ''));
const sign = payload => crypto.createHmac('sha256', secret()).update(payload).digest('base64url');

function readSigned(token) {
  try {
    const [payload, sig] = String(token || '').split('.');
    if (!payload || !sig) return null;
    const expected = sign(payload);
    if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return data.exp > Date.now() ? data : null;
  } catch { return null; }
}

function issueUserToken(email) {
  const exp = Date.now() + USER_TTL_MS;
  const payload = Buffer.from(JSON.stringify({ e: String(email).toLowerCase(), exp })).toString('base64url');
  return { token: `${payload}.${sign(payload)}`, exp };
}

// Email of the verified user making this request, or null
function userEmail(req) {
  const d = readSigned(req.headers['x-user-token']);
  return d && d.e ? d.e : null;
}

// True when the request carries a valid admin session token
function isAdmin(req) {
  const d = readSigned(req.headers['x-admin-token']);
  return !!(d && d.id && !d.e);
}

const hashCode = (email, code) => crypto.createHash('sha256').update(`${String(email).toLowerCase()}|${code}|${secret()}`).digest('hex');
const newCode = () => String(crypto.randomInt(100000, 1000000));
const sameHash = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

module.exports = { issueUserToken, userEmail, isAdmin, hashCode, newCode, sameHash };
