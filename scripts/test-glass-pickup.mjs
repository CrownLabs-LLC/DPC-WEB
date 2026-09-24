import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import handler from '../api/glass-pickup.js';
import { tastingSchedule, pickupConfiguration } from '../api/lib/glass-campaign.js';

const original = { ...process.env }, realFetch = global.fetch;
const calls = [];
Object.assign(process.env, { SUPABASE_URL: 'https://hohbsqkmrlhkstojfdgx.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test-service-only', GLASS_PICKUP_ENABLED: 'true', VERCEL_ENV: 'preview' });
const valid = () => ({ requestId: randomUUID(), email: ' Guest+tag@Example.com ', marketingOptIn: true, marketingChanged: false });
async function invoke(body = valid(), method = 'POST', headers = {}) {
  const result = { headers: {} };
  await handler({ method, body, headers: { host: 'campaign.test', origin: 'https://campaign.test', 'content-type': 'application/json', ...headers } }, {
    setHeader(key, value) { result.headers[key] = value; },
    status(code) { result.status = code; return this; },
    json(body) { result.body = body; return this; },
  });
  assert.equal(result.headers['Cache-Control'], 'no-store');
  return result;
}
try {
  global.fetch = async (url, options) => { calls.push({ url, options }); return { ok: true }; };
  const body = valid(); const first = await invoke(body); const repeated = await invoke(body);
  assert.equal(first.status, 200); assert.deepEqual(first, repeated);
  assert.deepEqual(Object.keys(first.body).sort(), ['schedule', 'success']);
  const rpc = JSON.parse(calls[0].options.body);
  assert.equal(rpc.p_email, 'guest+tag@example.com'); assert.equal(rpc.p_request_id, body.requestId);
  assert.equal(rpc.p_marketing_changed, false); assert.equal(calls[0].options.headers.apikey, 'test-service-only');
  assert.ok(!JSON.stringify(first).includes('guest')); assert.ok(!JSON.stringify(first).includes('test-service'));
  assert.ok(!('p_date' in rpc) && !('p_venue' in rpc));
  const optOut = await invoke({ ...valid(), marketingOptIn: false, marketingChanged: true });
  assert.equal(optOut.status, 200); assert.equal(JSON.parse(calls.at(-1).options.body).p_marketing_opt_in, false);
  const beforeInvalid = calls.length;
  for (const patch of [{ email: '' }, { email: 'not-email' }, { email: 'a'.repeat(254) + '@b.co' }, { email: 'a\u0000@b.co' }, { requestId: 'not-uuid' }, { marketingOptIn: 'yes' }, { marketingChanged: null }, { marketingOptIn: false, marketingChanged: false }]) {
    assert.equal((await invoke({ ...valid(), ...patch })).status, 400);
  }
  assert.equal((await invoke('{broken')).status, 400);
  assert.equal((await invoke({ ...valid(), extra: 'a'.repeat(2048) })).status, 413);
  assert.equal((await invoke(valid(), 'POST', { origin: 'https://other.test' })).status, 403);
  assert.equal((await invoke(valid(), 'POST', { 'content-type': 'text/plain' })).status, 415);
  assert.equal((await invoke(valid(), 'PUT')).status, 405);
  assert.equal(calls.length, beforeInvalid, 'Invalid requests never reach database');
  assert.equal((await invoke(JSON.stringify(valid()))).status, 200);
  global.fetch = async () => ({ ok: false, json: () => { throw new Error('Must not read private upstream errors'); } });
  assert.equal((await invoke()).status, 503);
  global.fetch = async () => { throw new Error('email@example.com private upstream failure'); };
  const failed = await invoke(); assert.equal(failed.status, 503); assert.ok(!JSON.stringify(failed).includes('email@example'));
  process.env.GLASS_PICKUP_ENABLED = 'false';
  assert.equal((await invoke()).status, 503); assert.equal((await invoke(undefined, 'GET')).body.available, false);
  process.env.GLASS_PICKUP_ENABLED = 'true';
  process.env.SUPABASE_URL = 'https://ebiuspbgzggrdiaswpcc.supabase.co';
  assert.equal(pickupConfiguration(), null, 'Preview cannot use production');
  process.env.VERCEL_ENV = 'production'; assert.ok(pickupConfiguration());
  process.env.SUPABASE_URL = 'https://hohbsqkmrlhkstojfdgx.supabase.co'; assert.equal(pickupConfiguration(), null);
  delete process.env.SUPABASE_SERVICE_ROLE_KEY; assert.equal(pickupConfiguration(), null);
  assert.equal(tastingSchedule(new Date('2026-10-15T06:59:59Z')).ended, false);
  assert.deepEqual(tastingSchedule(new Date('2026-10-15T07:00:00Z')), { today: '2026-10-15', dates: [], ended: true });
  assert.deepEqual(tastingSchedule(new Date('2026-10-07T07:00:00Z')).dates, ['2026-10-13', '2026-10-14']);
  assert.equal(tastingSchedule(new Date('2026-09-01T07:00:00Z')).dates.length, 5);
  assert.equal(tastingSchedule(new Date('2026-09-30T06:59:59Z')).dates[0], '2026-09-29');
  console.log('PASS: glass pickup validation, safe duplicate responses, opt-out intent, fail-closed configuration, preview isolation, upstream privacy, and Pacific dates.');
} finally {
  global.fetch = realFetch;
  for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key];
  Object.assign(process.env, original);
}
