#!/usr/bin/env node
/**
 * Offline tests for /api/track and /api/dashboard-data — no credentials or
 * network. Supabase + Resend calls are mocked at global fetch; Stripe at
 * node:https (the Stripe SDK does not use fetch).
 * Usage: node scripts/test-dashboard-endpoints.mjs   (also part of: npm test)
 */
import https from 'node:https';
import { PassThrough } from 'node:stream';

function mockRes() {
  const out = { status: null, body: null, headers: {} };
  const res = {
    setHeader(k, v) { out.headers[k] = v; return res; },
    status(c) { out.status = c; return res; },
    json(b) { out.body = b; return res; },
    end() { return res; },
  };
  return { res, out };
}

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log(`PASS: ${name}`);
  else { failures++; console.error(`FAIL: ${name}`, extra ?? ''); }
}

let importCount = 0;
async function fresh(path) {
  const { default: handler } = await import(`${path}?v=${++importCount}`);
  return handler;
}

/* ---------------- /api/track ---------------- */

// Case: not configured -> 202 stored:false, no fetch attempted
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_ANON_KEY;
{
  const handler = await fresh('../api/track.js');
  const { res, out } = mockRes();
  await handler({ method: 'POST', body: { event: 'page_view' } }, res);
  check('track unconfigured -> 202 stored:false', out.status === 202 && out.body.stored === false, out);
}

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_ANON_KEY = 'anon_test_key';

// Case: valid event -> inserts via REST -> 202 stored:true
{
  const calls = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    calls.push({ url: String(url), body: JSON.parse(opts.body) });
    return new Response(null, { status: 201 });
  };
  const handler = await fresh('../api/track.js');
  const { res, out } = mockRes();
  await handler({
    method: 'POST',
    body: { event: 'deposit_click', page: 'member', path: '/', referrer: 'https://www.google.com/search?q=x' },
  }, res);
  globalThis.fetch = origFetch;
  check('track valid event -> 202 stored:true', out.status === 202 && out.body.stored === true, out);
  check('track posts to site_events', calls[0]?.url.includes('/rest/v1/site_events'), calls);
  check('track strips referrer to hostname', calls[0]?.body.referrer === 'www.google.com', calls[0]?.body);
}

// Case: unknown event name -> 202 stored:false, nothing sent
{
  let called = false;
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => { called = true; return new Response(null, { status: 201 }); };
  const handler = await fresh('../api/track.js');
  const { res, out } = mockRes();
  await handler({ method: 'POST', body: { event: 'drop table students' } }, res);
  globalThis.fetch = origFetch;
  check('track rejects unknown event, sends nothing', out.body.stored === false && !called, out);
}

// Case: join funnel events are allowlisted
{
  const calls = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    calls.push(JSON.parse(opts.body).event);
    return new Response(null, { status: 201 });
  };
  const handler = await fresh('../api/track.js');
  for (const event of ['join_submit', 'join_checkout_redirect', 'join_error', 'membership_checkout_complete', 'membership_checkout_cancelled']) {
    const { res, out } = mockRes();
    await handler({ method: 'POST', body: { event, page: 'join', path: '/join' } }, res);
    check(`track allows ${event}`, out.status === 202 && out.body.stored === true, out);
  }
  globalThis.fetch = origFetch;
  check('track join funnel posted 5 events', calls.length === 5, calls);
}

// Case: GET -> 405
{
  const handler = await fresh('../api/track.js');
  const { res, out } = mockRes();
  await handler({ method: 'GET' }, res);
  check('track GET -> 405', out.status === 405, out);
}

/* ---------------- /api/dashboard-data ---------------- */

const STRIPE_FIXTURES = {
  '/v1/checkout/sessions': { object: 'list', has_more: false, data: [] },
  '/v1/payment_intents': {
    object: 'list', has_more: false,
    data: [
      {
        id: 'pi_1', object: 'payment_intent', status: 'succeeded', currency: 'usd',
        amount: 4900, created: Math.floor(Date.now() / 1000) - 3600,
        latest_charge: { billing_details: { email: 'buyer@example.com', name: 'Pat Buyer' } },
      },
      {
        id: 'pi_2', object: 'payment_intent', status: 'succeeded', currency: 'usd',
        amount: 14900, created: Math.floor(Date.now() / 1000) - 7200, latest_charge: null,
      },
    ],
  },
  '/v1/events': {
    object: 'list', has_more: false,
    data: [{ id: 'evt_bad', type: 'checkout.session.completed', created: Math.floor(Date.now() / 1000) - 600, pending_webhooks: 1 }],
  },
};

function mockStripeHttps() {
  return (options) => {
    const req = new PassThrough();
    req.setTimeout = () => req;
    req.abort = () => {};
    const path = String(options.path || '').split('?')[0];
    const fixtureKey = Object.keys(STRIPE_FIXTURES).find((k) => path.startsWith(k));
    process.nextTick(() => {
      const res = new PassThrough();
      res.statusCode = fixtureKey ? 200 : 404;
      res.headers = { 'content-type': 'application/json', 'request-id': 'req_mock' };
      req.emit('response', res);
      res.end(JSON.stringify(fixtureKey ? STRIPE_FIXTURES[fixtureKey] : { error: { message: 'not found' } }));
    });
    return req;
  };
}

function mockDashboardFetch() {
  return async (url) => {
    const u = String(url);
    if (u.includes('/rest/v1/site_events')) {
      const now = Date.now();
      return new Response(JSON.stringify([
        { ts: new Date(now - 3600e3).toISOString(), event: 'page_view' },
        { ts: new Date(now - 3600e3).toISOString(), event: 'page_view' },
        { ts: new Date(now - 3500e3).toISOString(), event: 'deposit_click' },
        { ts: new Date(now - 40 * 86400e3).toISOString(), event: 'page_view' },
      ]), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (u.includes('/rest/v1/webhook_logs')) {
      return new Response(JSON.stringify([
        { ts: new Date().toISOString(), level: 'error', message: 'handler failed: boom', event_id: 'evt_x', session_id: null },
      ]), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (u.includes('api.resend.com')) {
      return new Response(JSON.stringify({ data: { data: [] } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error('unexpected fetch: ' + u);
  };
}

// Case: DASHBOARD_TOKEN unset -> 503
delete process.env.DASHBOARD_TOKEN;
{
  const handler = await fresh('../api/dashboard-data.js');
  const { res, out } = mockRes();
  await handler({ method: 'GET', headers: {}, query: {} }, res);
  check('dashboard no token configured -> 503', out.status === 503, out);
}

// Case: wrong token -> 401
process.env.DASHBOARD_TOKEN = 'sekret-token';
process.env.STRIPE_SECRET_KEY = 'sk_live_dummy';
process.env.RESEND_API_KEY = 're_dummy';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service_test_key';
{
  const handler = await fresh('../api/dashboard-data.js');
  const { res, out } = mockRes();
  await handler({ method: 'GET', headers: { authorization: 'Bearer nope' }, query: {} }, res);
  check('dashboard wrong token -> 401', out.status === 401, out);
}

// Case: correct token -> 200 with all sections
{
  const origFetch = globalThis.fetch;
  const origHttpsRequest = https.request;
  globalThis.fetch = mockDashboardFetch();
  https.request = mockStripeHttps();
  const handler = await fresh('../api/dashboard-data.js');
  const { res, out } = mockRes();
  await handler({ method: 'GET', headers: { authorization: 'Bearer sekret-token' }, query: { days: '7' } }, res);
  globalThis.fetch = origFetch;
  https.request = origHttpsRequest;

  check('dashboard authorized -> 200', out.status === 200, out.status);
  check('dashboard days honored', out.body?.days === 7, out.body?.days);
  const f = out.body?.funnel;
  check('funnel counts current period only', f?.totals?.visits === 2 && f?.totals?.clicks === 1, f?.totals);
  check('funnel previous period counted', f?.prev?.visits === 1, f?.prev);
  const dep = out.body?.deposits;
  check('deposits filter to $49 succeeded', dep?.count === 1 && dep?.amount_cents === 4900, dep);
  check('deposit email surfaced', dep?.recent?.[0]?.email === 'buyer@example.com', dep?.recent);
  const alerts = out.body?.alerts;
  check('undelivered stripe events surfaced', alerts?.undelivered_events?.length === 1, alerts);
  check('webhook error log surfaced', alerts?.webhook_errors?.length === 1, alerts);
  const health = out.body?.health;
  const byName = Object.fromEntries((health || []).map((c) => [c.name, c]));
  check('health: checkout session read probe ok', byName['Stripe key can read checkout sessions']?.ok === true, byName);
  check('health: payment intent read probe ok', byName['Stripe key can read payment intents']?.ok === true, byName);
  check('health: live mode detected from key prefix', byName['Stripe key is live mode']?.ok === true, byName);
  check('health: resend key accepted', byName['Resend key accepted by Resend']?.ok === true, byName);
}

process.exit(failures ? 1 : 0);
