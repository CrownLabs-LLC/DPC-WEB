import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import handler from '../api/glass-tasting.js';
import { RESTAURANTS, restaurantFor, tastingConfiguration, tastingRateKey, tastingState } from '../api/lib/glass-tasting.js';
import { TASTING_DATES, pickupRateKey } from '../api/lib/glass-campaign.js';

const original = { ...process.env }, realFetch = global.fetch;
const calls = [];
Object.assign(process.env, { SUPABASE_URL: 'https://hohbsqkmrlhkstojfdgx.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test-service-only', GLASS_TASTING_ENABLED: 'true', VERCEL_ENV: 'preview' });
const valid = () => ({ requestId: randomUUID(), email: ' Guest+tag@Example.com ', marketingOptIn: true, marketingChanged: false, restaurant: 'demitris-taverna' });
const committed = { status: 'confirmed', date: '2026-09-29', serverNow: '2026-09-29T19:00:00Z', validUntil: '2026-09-30T07:00:00Z' };
async function invoke(body = valid(), method = 'POST', headers = {}, query = { restaurant: 'demitris-taverna' }) {
  const result = { headers: {} };
  await handler({ method, body, query, headers: { host: 'campaign.test', origin: 'https://campaign.test', 'content-type': 'application/json', 'x-vercel-forwarded-for': '192.0.2.1', ...headers } }, {
    setHeader(key, value) { result.headers[key] = value; },
    status(code) { result.status = code; return this; },
    json(body) { result.body = body; return this; },
  });
  assert.equal(result.headers['Cache-Control'], 'no-store');
  assert.equal(result.headers['X-Content-Type-Options'], 'nosniff');
  return result;
}
const upstream = value => { global.fetch = async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => value }; }; };
try {
  upstream({ ...committed, privateEmail: 'secret@example.com', originalTimestamp: 'old', contactId: 'private' });
  const body = valid();
  const first = await invoke(body), duplicate = await invoke(body);
  assert.equal(first.status, 200); assert.deepEqual(first, duplicate);
  assert.deepEqual(Object.keys(first.body).sort(), ['date', 'restaurant', 'serverNow', 'success', 'validUntil']);
  assert.doesNotMatch(JSON.stringify(first), /secret@example|contactId|originalTimestamp|test-service-only|guest\+tag/);
  const rpc = JSON.parse(calls[0].options.body);
  assert.equal(rpc.p_email, 'guest+tag@example.com');
  assert.equal(rpc.p_request_id, body.requestId);
  assert.equal(rpc.p_restaurant, body.restaurant);
  assert.equal(rpc.p_marketing_changed, false);
  assert.equal(calls[0].url, process.env.SUPABASE_URL + '/rest/v1/rpc/register_glass_tasting');
  assert.equal(calls[0].options.headers.apikey, 'test-service-only');
  assert.deepEqual(Object.keys(rpc).sort(), ['p_email', 'p_marketing_changed', 'p_marketing_opt_in', 'p_rate_key', 'p_request_id', 'p_restaurant', 'p_wording_version']);
  assert.match(rpc.p_rate_key, /^[0-9a-f]{64}$/);
  assert.doesNotMatch(calls[0].options.body, /192\.0\.2\.1/);
  const req = { headers: { 'x-vercel-forwarded-for': '192.0.2.1' } };
  assert.equal(rpc.p_rate_key, tastingRateKey(req, 'test-service-only'));
  assert.notEqual(rpc.p_rate_key, pickupRateKey(req, 'test-service-only'), 'Tasting has a separate network bucket from pickup');
  for (const [slug, name] of Object.entries(RESTAURANTS)) {
    const result = await invoke({ ...valid(), restaurant: slug });
    assert.deepEqual(result.body.restaurant, { slug, name });
    assert.equal((await invoke(undefined, 'GET', {}, { restaurant: slug })).body.restaurant.name, name);
    const html = readFileSync(new URL(`../glass-comes-back/${slug}.html`, import.meta.url), 'utf8');
    assert.ok(html.includes(`data-restaurant="${slug}"`));
    assert.ok(html.includes(name.replaceAll('&', '&amp;')));
    assert.ok(html.includes(`https://www.downtownpourcollective.com/glass-comes-back/${slug}`));
  }
  assert.equal((await invoke({ ...valid(), marketingOptIn: false, marketingChanged: true })).status, 200);
  assert.equal(JSON.parse(calls.at(-1).options.body).p_marketing_opt_in, false);
  const beforeInvalid = calls.length;
  for (const patch of [{ email: '' }, { email: 'jane@gmail' }, { email: 'a\u0000@b.co' }, { email: 'a'.repeat(254) + '@b.co' },
    { requestId: 'bad' }, { marketingOptIn: 'yes' }, { marketingChanged: null }, { marketingOptIn: false, marketingChanged: false },
    { date: '2026-09-29' }, { eventDate: '2026-09-29' }, { now: '2026-09-29' }]) assert.equal((await invoke({ ...valid(), ...patch })).status, 400);
  for (const slug of ['__proto__', 'constructor', 'bad', null, ['l-campo']]) {
    assert.equal(restaurantFor(slug), null);
    assert.equal((await invoke({ ...valid(), restaurant: slug })).status, 404);
  }
  assert.equal((await invoke(undefined, 'GET', {}, {})).status, 404);
  assert.equal((await invoke('null')).status, 400);
  assert.equal((await invoke('{broken')).status, 400);
  assert.equal((await invoke([])).status, 400);
  assert.equal((await invoke({ ...valid(), email: 'a'.repeat(2049) })).status, 413);
  assert.equal((await invoke(valid(), 'POST', { origin: 'https://other.test' })).status, 403);
  assert.equal((await invoke(valid(), 'POST', { 'content-type': 'text/plain' })).status, 415);
  assert.equal((await invoke(valid(), 'PUT')).status, 405);
  for (const address of [undefined, '', 'fake', '192.0.2.1, 198.51.100.1', ['192.0.2.1']]) {
    assert.equal((await invoke(valid(), 'POST', { 'x-vercel-forwarded-for': address })).status, 503);
  }
  assert.equal(calls.length, beforeInvalid, 'Invalid requests cannot reach the database');
  assert.equal((await invoke(JSON.stringify(valid()))).status, 200);
  for (const [status, http] of [['limited', 429], ['closed', 409], ['expired', 409]]) {
    upstream({ status }); const result = await invoke(); assert.equal(result.status, http);
    assert.deepEqual(Object.keys(result.body).sort(), ['message', 'success']);
    if (status === 'limited') assert.equal(result.headers['Retry-After'], '60');
  }
  for (const result of [true, null, {}, { ...committed, status: 'unknown' }, { ...committed, date: '2026-10-07' },
    { ...committed, serverNow: 'bad' }, { ...committed, validUntil: committed.serverNow },
    { ...committed, validUntil: '2026-11-01T00:00:00Z' }, { ...committed, date: '2026-09-30' }]) {
    upstream(result); assert.equal((await invoke()).status, 503);
  }
  global.fetch = async () => ({ ok: false, json() { throw Error('Must not read private upstream error'); } });
  assert.equal((await invoke()).status, 503);
  global.fetch = async () => { throw Error('secret@example.com provider error'); };
  assert.doesNotMatch(JSON.stringify(await invoke()), /secret@example/);
  process.env.GLASS_TASTING_ENABLED = 'false';
  assert.equal(tastingConfiguration(), null);
  assert.equal((await invoke()).status, 503);
  assert.equal((await invoke(undefined, 'GET')).body.available, false);
  process.env.GLASS_TASTING_ENABLED = 'true';
  delete process.env.GLASS_PICKUP_ENABLED;
  assert.ok(tastingConfiguration(), 'Tasting activation is independent of pickup');
  process.env.SUPABASE_URL = 'https://ebiuspbgzggrdiaswpcc.supabase.co';
  assert.equal(tastingConfiguration(), null, 'Preview cannot write to production');
  process.env.VERCEL_ENV = 'production'; assert.ok(tastingConfiguration());
  process.env.SUPABASE_URL = 'https://hohbsqkmrlhkstojfdgx.supabase.co'; assert.equal(tastingConfiguration(), null);
  delete process.env.SUPABASE_SERVICE_ROLE_KEY; assert.equal(tastingConfiguration(), null);
  for (const date of TASTING_DATES) assert.equal(tastingState(new Date(date + 'T19:00:00Z')).eligible, true);
  for (const date of ['2026-09-28', '2026-10-01', '2026-10-07', '2026-10-15']) assert.equal(tastingState(new Date(date + 'T19:00:00Z')).eligible, false);
  assert.equal(tastingState(new Date('2026-09-29T06:59:59Z')).eligible, false);
  assert.equal(tastingState(new Date('2026-09-29T07:00:00Z')).eligible, true);
  assert.equal(tastingState(new Date('2026-10-15T06:59:59Z')).eligible, true);
  assert.equal(tastingState(new Date('2026-10-15T07:00:00Z')).schedule.ended, true);
  const migration = readFileSync(new URL('../db/20260925152006_glass_tasting.sql', import.meta.url), 'utf8');
  assert.deepEqual([...migration.matchAll(/'(2026-\d{2}-\d{2})'/g)].map(match => match[1]), TASTING_DATES, 'DB and information-page schedule share the same five dates');
  console.log('PASS: tasting API restaurant binding, unverified email validation, safe repeat responses, explicit preference intent, separate rate bucket, date-input rejection, Pacific schedule, activation isolation and upstream privacy.');
} finally {
  global.fetch = realFetch;
  for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key];
  Object.assign(process.env, original);
}
