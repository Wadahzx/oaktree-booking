// Small database-backed rate limiter (works on serverless where memory is not shared).
const { get } = require('../database/db');

function clientIp(req) {
  return String((req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown')).split(',')[0].trim();
}

// Counts one hit for `key`; returns { ok, count } where ok is false once `max` is exceeded within `windowSec`.
async function hit(key, max, windowSec) {
  const row = await get(`
    INSERT INTO rate_limits (key, count, window_start) VALUES (?, 1, NOW())
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN rate_limits.window_start < NOW() - make_interval(secs => ?) THEN 1 ELSE rate_limits.count + 1 END,
      window_start = CASE WHEN rate_limits.window_start < NOW() - make_interval(secs => ?) THEN NOW() ELSE rate_limits.window_start END
    RETURNING count`, [key, windowSec, windowSec]);
  return { ok: row.count <= max, count: row.count };
}

module.exports = { hit, clientIp };
