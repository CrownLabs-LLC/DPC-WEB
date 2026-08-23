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
    calls.push(JSON.parse(opts.body));
    return new Response(null, { status: 201 });
  };
  const handler = await fresh('../api/track.js');
  for (const event of [
    'join_submit',
    'join_checkout_redirect',
    'join_checkout_ready',
    'join_checkout_departed',
    'join_checkout_fallback_clicked',
    'join_checkout_stalled',
    'join_error',
    'membership_checkout_complete',
    'membership_checkout_cancelled',
    'partner_subscription_checkout_submitted',
    'partner_subscription_checkout_cancelled',
  ]) {
    const { res, out } = mockRes();
    const detail = event === 'join_error'
      ? { error_code: 'CHECKOUT_IN_PROGRESS', http_status: 409 }
      : event.startsWith('join_')
        ? { flow_id: '019ffeb2-9ac1-71e5-96c5-0c69b70f247e' }
        : {};
    await handler({ method: 'POST', body: { event, page: 'join', path: '/join', ...detail } }, res);
    check(`track allows ${event}`, out.status === 202 && out.body.stored === true, out);
  }
  globalThis.fetch = origFetch;
  check('track checkout funnels posted 11 events', calls.length === 11, calls);
  const joinError = calls.find((call) => call.event === 'join_error');
  check(
    'track persists sanitized join error detail',
    joinError?.error_code === 'CHECKOUT_IN_PROGRESS' && joinError?.http_status === 409,
    joinError
  );
  const joinSubmit = calls.find((call) => call.event === 'join_submit');
  check(
    'track omits error detail from non-error events',
    !Object.hasOwn(joinSubmit, 'error_code') && !Object.hasOwn(joinSubmit, 'http_status'),
    joinSubmit
  );
  check(
    'track persists an anonymous per-attempt flow id on join lifecycle events',
    joinSubmit?.flow_id === '019ffeb2-9ac1-71e5-96c5-0c69b70f247e',
    joinSubmit
  );
}

// Case: unsafe or out-of-range failure metadata is discarded
{
  const calls = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    calls.push(JSON.parse(opts.body));
    return new Response(null, { status: 201 });
  };
  const handler = await fresh('../api/track.js');
  const { res, out } = mockRes();
  await handler({
    method: 'POST',
    body: { event: 'join_error', error_code: 'contains user@example.com', http_status: 999 },
  }, res);
  const second = mockRes();
  await handler({
    method: 'POST',
    body: { event: 'join_error', error_code: 'constructor', http_status: 503 },
  }, second.res);
  globalThis.fetch = origFetch;
  check('track accepts join_error with discarded unsafe detail', out.body.stored === true, out);
  check(
    'track discards unsafe failure metadata',
    calls[0]?.error_code === null && calls[0]?.http_status === null,
    calls[0]
  );
  check(
    'track buckets arbitrary valid identifiers as unknown',
    second.out.body.stored === true && calls[1]?.error_code === 'unknown' && calls[1]?.http_status === 503,
    calls[1]
  );
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
  '/v1/subscriptions': { object: 'list', has_more: false, data: [] },
  '/v1/events': {
    object: 'list', has_more: false,
    data: [{ id: 'evt_bad', type: 'checkout.session.completed', created: Math.floor(Date.now() / 1000) - 600, pending_webhooks: 1 }],
  },
};

const OPS_SUBSCRIPTION_OVERVIEW = {
  totals: {
    active: 9,
    past_due: 4,
    cancelled: 2,
    paused: 1,
    terminated: 3,
    unique_active_members: 7,
  },
  new_paid: { h24: 1, d7: 3, d30: 8 },
  by_circle: [
    { circle: 'tap', interval: 'monthly', offer_type: 'standard', count: 4 },
    { circle: 'cellar', interval: 'annual', offer_type: 'founding', count: 3 },
    { circle: 'reserve', interval: 'monthly', offer_type: 'unknown', count: 2 },
  ],
  payment_verification: { verified: 11, missing: 2 },
  dunning: {
    in_dunning: 4,
    attempts: { zero: 2, one: 0, two: 1, three: 0, four_plus: 1 },
    next_retry_24h: 1,
    retry_overdue: 1,
    retries_exhausted: 1,
    grace_expiring_7d: 1,
  },
  access: { cancelled_with_access: 1, ending_7d: 1 },
  renewals: { due_7d: 2 },
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

function mockDashboardFetch({ hangResendDomains = false, failSubscriptionOverview = false } = {}) {
  return async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('/rest/v1/rpc/ops_subscription_overview')) {
      if (failSubscriptionOverview) {
        return new Response('{"message":"report unavailable"}', { status: 503 });
      }
      check('subscription overview uses POST', opts.method === 'POST', opts);
      const body = JSON.parse(opts.body || '{}');
      check('subscription overview pins the dashboard clock', Boolean(Date.parse(body.p_now)), body);
      return new Response(JSON.stringify(OPS_SUBSCRIPTION_OVERVIEW), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (u.includes('/rest/v1/site_events')) {
      const now = Date.now();
      const checkoutRows = [
        { ts: new Date(now - 2900e3).toISOString(), event: 'join_submit', flow_id: '00000000-0000-4000-8000-000000000001' },
        { ts: new Date(now - 2890e3).toISOString(), event: 'join_checkout_ready', flow_id: '00000000-0000-4000-8000-000000000001' },
        { ts: new Date(now - 2880e3).toISOString(), event: 'join_checkout_departed', flow_id: '00000000-0000-4000-8000-000000000001' },
        { ts: new Date(now - 2800e3).toISOString(), event: 'join_submit', flow_id: '00000000-0000-4000-8000-000000000002' },
        { ts: new Date(now - 2790e3).toISOString(), event: 'join_checkout_ready', flow_id: '00000000-0000-4000-8000-000000000002' },
        { ts: new Date(now - 2780e3).toISOString(), event: 'join_checkout_stalled', flow_id: '00000000-0000-4000-8000-000000000002' },
        { ts: new Date(now - 2770e3).toISOString(), event: 'join_checkout_fallback_clicked', flow_id: '00000000-0000-4000-8000-000000000002' },
      ];
      const rows = [
        { ts: new Date(now - 3600e3).toISOString(), event: 'page_view' },
        { ts: new Date(now - 3600e3).toISOString(), event: 'page_view' },
        { ts: new Date(now - 3500e3).toISOString(), event: 'membership_checkout_complete' },
        { ts: new Date(now - 3400e3).toISOString(), event: 'join_error', error_code: 'turnstile_unavailable' },
        { ts: new Date(now - 3300e3).toISOString(), event: 'join_error', error_code: 'turnstile_unavailable' },
        { ts: new Date(now - 3200e3).toISOString(), event: 'join_error', error_code: 'CHECKOUT_NOT_ENABLED' },
        { ts: new Date(now - 3150e3).toISOString(), event: 'join_error', error_code: 'CHECKOUT_IN_PROGRESS' },
        { ts: new Date(now - 3100e3).toISOString(), event: 'join_error', error_code: 'constructor' },
        { ts: new Date(now - 3000e3).toISOString(), event: 'join_error', error_code: '__proto__' },
        { ts: new Date(now - 40 * 86400e3).toISOString(), event: 'page_view' },
        { ts: new Date(now - 40 * 86400e3).toISOString(), event: 'join_error', error_code: 'network' },
      ];
      const filtered = u.includes('join_checkout_ready')
        ? checkoutRows
        : u.includes('event=eq.join_error')
        ? rows.filter((row) => row.event === 'join_error')
        : rows.filter((row) => ['page_view', 'membership_checkout_complete'].includes(row.event));
      return new Response(JSON.stringify(filtered), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (u.includes('/rest/v1/webhook_logs')) {
      return new Response(JSON.stringify([
        { ts: new Date().toISOString(), level: 'error', message: 'handler failed: boom', event_id: 'evt_x', session_id: null },
      ]), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (u.includes('api.resend.com')) {
      if (hangResendDomains) return new Promise(() => {});
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
  check('funnel counts current period only', f?.totals?.visits === 2 && f?.totals?.confirmations === 1, f?.totals);
  check('daily acquisition counts checkout attempts', (
    f?.daily?.reduce((sum, row) => sum + row.checkout_attempts, 0) === 2
  ), f?.daily);
  check('funnel previous period counted', f?.prev?.visits === 1, f?.prev);
  check('join errors counted by code', (
    f?.totals?.join_errors === 6
    && f?.totals?.join_error_codes?.turnstile_unavailable === 2
    && f?.totals?.join_error_codes?.CHECKOUT_NOT_ENABLED === 1
    && f?.totals?.join_error_codes?.CHECKOUT_IN_PROGRESS === 1
    && f?.totals?.join_error_codes?.unknown === 2
    && Object.values(f?.totals?.join_error_codes || {}).reduce((sum, count) => sum + count, 0) === 6
  ), f?.totals);
  check('previous join errors counted', f?.prev?.join_errors === 1, f?.prev);
  check('checkout handoff attempts are correlated and counted', (
    f?.totals?.join_submits === 2
    && f?.totals?.checkout_ready === 2
    && f?.totals?.checkout_departed === 1
    && f?.totals?.checkout_stalled === 1
    && f?.totals?.checkout_fallback_clicks === 1
  ), f?.totals);
  check('funnel and join-error events use separate query budgets', (
    f?.truncated === false
  ), f);
  const overview = out.body?.subscription_overview;
  check('billing-owned subscription overview is returned', (
    overview?.totals?.active === 9
    && overview?.dunning?.retries_exhausted === 1
    && overview?.renewals?.due_7d === 2
  ), overview);
  check('subscription overview remains PII-free', (
    !/email|first_name|last_name|stripe_customer_id/i.test(JSON.stringify(overview))
  ), overview);
  const alerts = out.body?.alerts;
  check('undelivered stripe events surfaced', alerts?.undelivered_events?.length === 1, alerts);
  check('webhook error log surfaced', alerts?.webhook_errors?.length === 1, alerts);
  const health = out.body?.health;
  const byName = Object.fromEntries((health || []).map((c) => [c.name, c]));
  check('health: checkout session read probe ok', byName['Stripe key can read checkout sessions']?.ok === true, byName);
  check('health: subscription read probe ok', byName['Stripe key can read subscriptions']?.ok === true, byName);
  check('health: live mode detected from key prefix', byName['Stripe key is live mode']?.ok === true, byName);
  check('health: resend key accepted', byName['Resend key accepted by Resend']?.ok === true, byName);
}

// Case: the billing report degrades independently while the dashboard stays up.
{
  const origFetch = globalThis.fetch;
  const origHttpsRequest = https.request;
  globalThis.fetch = mockDashboardFetch({ failSubscriptionOverview: true });
  https.request = mockStripeHttps();
  const handler = await fresh('../api/dashboard-data.js');
  const { res, out } = mockRes();
  await handler({ method: 'GET', headers: { authorization: 'Bearer sekret-token' }, query: { days: '30' } }, res);
  globalThis.fetch = origFetch;
  https.request = origHttpsRequest;

  check('subscription report failure keeps dashboard available', (
    out.status === 200
    && out.body?.subscription_overview?.error?.startsWith('subscription overview:')
    && out.body?.funnel?.totals?.visits === 2
  ), out.body);
}

// A transient Resend probe timeout stays red on the dashboard even though the
// paging health check treats it as a non-email warning.
{
  const origFetch = globalThis.fetch;
  const origHttpsRequest = https.request;
  globalThis.fetch = mockDashboardFetch({ hangResendDomains: true });
  https.request = mockStripeHttps();
  const handler = await fresh('../api/dashboard-data.js');
  const { res, out } = mockRes();
  const keepAlive = setTimeout(() => {}, 20000);
  await handler({ method: 'GET', headers: { authorization: 'Bearer sekret-token' }, query: { days: '7' } }, res);
  clearTimeout(keepAlive);
  globalThis.fetch = origFetch;
  https.request = origHttpsRequest;

  const byName = Object.fromEntries((out.body?.health || []).map((check) => [check.name, check]));
  check('health: Resend timeout remains visible as failed row', (
    byName['Resend key accepted by Resend']?.ok === false
    && byName['Resend key accepted by Resend']?.page === false
    && byName['Resend key accepted by Resend']?.detail.includes('timed out')
  ), byName);
}

process.exit(failures ? 1 : 0);
