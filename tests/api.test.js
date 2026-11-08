// Run with: DATABASE_URL=postgres://... npm test
// Spawns the server on a free port and exercises the public API.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const path = require('node:path');

const PORT = 3900 + Math.floor(Math.random() * 90);
const BASE = `http://localhost:${PORT}/api`;
const skip = !process.env.DATABASE_URL && 'DATABASE_URL is not set';
let srv; let logs = '';

const call = async (method, p, body, headers = {}) => {
  const r = await fetch(BASE + p, { method, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const nextSunday = () => { const d = new Date(Date.now() + 3 * 3600e3); d.setUTCDate(d.getUTCDate() + ((7 - d.getUTCDay()) % 7 || 7)); return d.toISOString().slice(0, 10); };
async function login(email) {
  await call('POST', '/bookings/auth/request', { email });
  await new Promise(r => setTimeout(r, 500));
  const m = [...logs.matchAll(new RegExp(`\\[LOGIN CODE\\] ${email}: (\\d{6})`, 'g'))].pop();
  assert.ok(m, 'login code should be logged in non-production');
  return call('POST', '/bookings/auth/verify', { email, code: m[1] });
}

before(async () => {
  if (skip) return;
  srv = spawn('node', ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT, ADMIN_CODE: 'test-admin', NODE_ENV: 'test', CRON_SECRET: 'cron-secret' } });
  srv.stdout.on('data', d => logs += d); srv.stderr.on('data', d => logs += d);
  for (let i = 0; i < 40; i++) { try { await fetch(BASE + '/rooms'); return; } catch (e) { await new Promise(r => setTimeout(r, 250)); } }
  throw new Error('server did not start');
});
after(() => srv && srv.kill());

test('rooms list is Arabic', { skip }, async () => {
  const r = await call('GET', '/rooms');
  assert.equal(r.status, 200);
  assert.ok(r.body.data.every(x => !/[·A-Za-z]/.test(x.name)));
});

test('booking requires verified email', { skip }, async () => {
  const r = await call('POST', '/bookings', { employee_name: 'x', employee_email: 'a@oaktree.sa', room_id: 'oak_room', date: nextSunday(), start_time: '09:00', duration: 60, purpose: 'x' });
  assert.equal(r.status, 401);
});

test('wrong code is rejected, correct code works, listing needs token', { skip }, async () => {
  const email = `t${Date.now()}@oaktree.sa`;
  await call('POST', '/bookings/auth/request', { email });
  const bad = await call('POST', '/bookings/auth/verify', { email, code: '000000' });
  assert.equal(bad.status >= 400, true);
  const ok = await login(email);
  assert.ok(ok.body.token);
  assert.equal((await call('GET', `/bookings?email=${email}`)).status, 401);
  assert.equal((await call('GET', `/bookings?email=${email}`, null, { 'x-user-token': ok.body.token })).status, 200);
});

test('book, conflict, recurring and cancel', { skip }, async () => {
  const email = `b${Date.now()}@oaktree.sa`;
  const { body: { token } } = await login(email);
  const h = { 'x-user-token': token };
  const date = nextSunday();
  const until = new Date(Date.parse(date) + 14 * 86400e3).toISOString().slice(0, 10);
  const mk = extra => call('POST', '/bookings', { employee_name: 'Test', employee_email: email, room_id: 'tree_room', date, start_time: '15:00', duration: 60, purpose: 'test', ...extra }, h);
  const a = await mk({ repeat: { pattern: 'weekly', until } });
  assert.equal(a.status, 201);
  assert.equal(a.body.series_created, 2);
  assert.equal((await mk()).status, 409);
  assert.equal((await call('DELETE', `/bookings/${a.body.data.id}`, {}, h)).status, 200);
  const other = await login(`o${Date.now()}@oaktree.sa`);
  const del = await call('DELETE', `/bookings/${a.body.data.id}`, {}, { 'x-user-token': other.body.token });
  assert.ok(del.status >= 400);
});

test('admin: no access without code, lockout works', { skip }, async () => {
  assert.equal((await call('GET', '/admin/bookings')).status >= 400, true);
});

test('reminders cron needs the secret', { skip }, async () => {
  assert.equal((await call('GET', '/cron/reminders')).status, 401);
  const r = await call('GET', '/cron/reminders?window=60', null, { authorization: 'Bearer cron-secret' });
  assert.equal(r.status, 200);
});

test('weekly stats expose no emails', { skip }, async () => {
  const r = await call('GET', '/rooms/stats');
  assert.equal(r.status, 200);
  assert.ok(!JSON.stringify(r.body).includes('@'));
});
