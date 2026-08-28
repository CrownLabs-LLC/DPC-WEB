#!/usr/bin/env node
/**
 * Offline tests for /api/track and /api/dashboard-data — no credentials or
 * network. Supabase + Resend calls are mocked at global fetch; Stripe at
 * node:https (the Stripe SDK does not use fetch).
 * Usage: node scripts/test-dashboard-endpoints.mjs   (also part of: npm test)
 */
import https from 'node:https';
import { PassThrough } from 'node:stream';

// One clock for the fixtures and the assertions. Reading Date.now() in both
// places lets a run that crosses an hour boundary compute a different expected
// hour key than the one the fixture produced.
const FIXED_NOW = Date.now();
const HOUR_MS = 3600e3;
const hourStart = (hoursBack) => Math.floor(FIXED_NOW / HOUR_MS) * HOUR_MS - hoursBack * HOUR_MS;

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
      ? { error_code: 'legal_versions_rate_limited', http_status: 429 }
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
    joinError?.error_code === 'legal_versions_rate_limited' && joinError?.http_status === 429,
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
  member_email: 'must-not-leak@example.com',
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
    { circle: 'tap', interval: 'monthly', offer_type: 'standard', count: 4, stripe_customer_id: 'cus_must_not_leak' },
    { circle: 'cellar', interval: 'annual', offer_type: 'founding', count: 3 },
    { circle: 'reserve', interval: 'monthly', offer_type: 'unknown', count: 2 },
    { circle: 'must-not-leak@example.com', interval: 'monthly', offer_type: 'standard', count: 1 },
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

function mockDashboardFetch({ hangResendDomains = false, failSubscriptionOverview = false, partialSubscriptionOverview = false, extraCheckoutRows = [] } = {}) {
  return async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('/rest/v1/rpc/ops_subscription_overview')) {
      if (failSubscriptionOverview) {
        return new Response('{"message":"report unavailable"}', { status: 503 });
      }
      check('subscription overview uses POST', opts.method === 'POST', opts);
      const body = JSON.parse(opts.body || '{}');
      check('subscription overview pins the dashboard clock', Boolean(Date.parse(body.p_now)), body);
      return new Response(JSON.stringify(partialSubscriptionOverview
        ? { totals: OPS_SUBSCRIPTION_OVERVIEW.totals }
        : OPS_SUBSCRIPTION_OVERVIEW), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (u.includes('/rest/v1/site_events')) {
      const now = FIXED_NOW;
      const checkoutRows = [
        { ts: new Date(now - 2900e3).toISOString(), event: 'join_submit', flow_id: '00000000-0000-4000-8000-000000000001' },
        { ts: new Date(now - 2890e3).toISOString(), event: 'join_checkout_ready', flow_id: '00000000-0000-4000-8000-000000000001' },
        { ts: new Date(now - 2880e3).toISOString(), event: 'join_checkout_departed', flow_id: '00000000-0000-4000-8000-000000000001' },
        { ts: new Date(now - 2800e3).toISOString(), event: 'join_submit', flow_id: '00000000-0000-4000-8000-000000000002' },
        { ts: new Date(now - 2790e3).toISOString(), event: 'join_checkout_ready', flow_id: '00000000-0000-4000-8000-000000000002' },
        { ts: new Date(now - 2780e3).toISOString(), event: 'join_checkout_stalled', flow_id: '00000000-0000-4000-8000-000000000002' },
        { ts: new Date(now - 2770e3).toISOString(), event: 'join_checkout_fallback_clicked', flow_id: '00000000-0000-4000-8000-000000000002' },
        // Two attempts in an hour's last second that fail in the next one.
        // The outage belongs to the hour the attempts were made, and it has to
        // carry their error code rather than reporting no known cause.
        { ts: new Date(hourStart(5) + 3599e3).toISOString(), event: 'join_submit', flow_id: '00000000-0000-4000-8000-000000000003' },
        { ts: new Date(hourStart(5) + 3599.5e3).toISOString(), event: 'join_submit', flow_id: '00000000-0000-4000-8000-000000000004' },
        // Two attempts in the last second of an hour whose departures land in
        // the next one. Bucketing each event by its own clock hour would report
        // the earlier hour as a total outage.
        { ts: new Date(hourStart(3) + 3599e3).toISOString(), event: 'join_submit', flow_id: '00000000-0000-4000-8000-000000000005' },
        { ts: new Date(hourStart(3) + 3600e3 + 2e3).toISOString(), event: 'join_checkout_departed', flow_id: '00000000-0000-4000-8000-000000000005' },
        { ts: new Date(hourStart(3) + 3599.5e3).toISOString(), event: 'join_submit', flow_id: '00000000-0000-4000-8000-000000000006' },
        { ts: new Date(hourStart(3) + 3600e3 + 3e3).toISOString(), event: 'join_checkout_departed', flow_id: '00000000-0000-4000-8000-000000000006' },
        // A blocked hour from days ago. It stays in the record but must not
        // keep the "needs attention" banner permanently lit.
        { ts: new Date(hourStart(120)).toISOString(), event: 'join_submit', flow_id: '00000000-0000-4000-8000-000000000009' },
        { ts: new Date(hourStart(120) + 40e3).toISOString(), event: 'join_submit', flow_id: '00000000-0000-4000-8000-00000000000a' },
        // Two attempts moments ago, departures still in flight: the open hour
        // must not accuse itself of being an outage.
        { ts: new Date(now - 120e3).toISOString(), event: 'join_submit', flow_id: '00000000-0000-4000-8000-000000000007' },
        { ts: new Date(now - 110e3).toISOString(), event: 'join_submit', flow_id: '00000000-0000-4000-8000-000000000008' },
      ];
      const rows = [
        { ts: new Date(now - 3600e3).toISOString(), event: 'page_view', page: 'member', referrer: 'instagram.com' },
        { ts: new Date(now - 3600e3).toISOString(), event: 'page_view', page: 'join', referrer: 'www.downtownpourcollective.com' },
        { ts: new Date(now - 3500e3).toISOString(), event: 'membership_checkout_complete' },
        { ts: new Date(now - 3400e3).toISOString(), event: 'join_error', error_code: 'turnstile_unavailable' },
        { ts: new Date(now - 3300e3).toISOString(), event: 'join_error', error_code: 'turnstile_unavailable' },
        { ts: new Date(now - 3200e3).toISOString(), event: 'join_error', error_code: 'CHECKOUT_NOT_ENABLED' },
        { ts: new Date(now - 3150e3).toISOString(), event: 'join_error', error_code: 'CHECKOUT_IN_PROGRESS' },
        { ts: new Date(now - 3100e3).toISOString(), event: 'join_error', error_code: 'constructor' },
        { ts: new Date(now - 3000e3).toISOString(), event: 'join_error', error_code: '__proto__' },
        { ts: new Date(hourStart(5) + 3600e3 + 2e3).toISOString(), event: 'join_error', error_code: 'CHALLENGE_FAILED', flow_id: '00000000-0000-4000-8000-000000000003' },
        { ts: new Date(hourStart(5) + 3600e3 + 3e3).toISOString(), event: 'join_error', error_code: 'CHALLENGE_FAILED', flow_id: '00000000-0000-4000-8000-000000000004' },
        { ts: new Date(now - 40 * 86400e3).toISOString(), event: 'page_view', page: 'member', referrer: null },
        { ts: new Date(now - 40 * 86400e3).toISOString(), event: 'join_error', error_code: 'network' },
      ];
      const filtered = u.includes('join_checkout_ready')
        ? checkoutRows.concat(extraCheckoutRows)
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
    f?.daily?.reduce((sum, row) => sum + row.checkout_attempts, 0) === 10
  ), f?.daily);
  check('funnel previous period counted', f?.prev?.visits === 1, f?.prev);
  check('join errors counted by code', (
    f?.totals?.join_errors === 8
    && f?.totals?.join_error_codes?.turnstile_unavailable === 2
    && f?.totals?.join_error_codes?.CHECKOUT_NOT_ENABLED === 1
    && f?.totals?.join_error_codes?.CHECKOUT_IN_PROGRESS === 1
    && f?.totals?.join_error_codes?.unknown === 2
    && f?.totals?.join_error_codes?.CHALLENGE_FAILED === 2
    && Object.values(f?.totals?.join_error_codes || {}).reduce((sum, count) => sum + count, 0) === 8
  ), f?.totals);
  check('previous join errors counted', f?.prev?.join_errors === 1, f?.prev);
  check('checkout handoff attempts are correlated and counted', (
    f?.totals?.join_submits === 10
    && f?.totals?.checkout_ready === 2
    && f?.totals?.checkout_departed === 3
    && f?.totals?.checkout_stalled === 1
    && f?.totals?.checkout_fallback_clicks === 1
  ), f?.totals);
  check('funnel splits page views by page', (
    f?.totals?.home_views === 1 && f?.totals?.join_views === 1 && f?.totals?.visits === 2
  ), f?.totals);
  check('join entrances separate same-site referrals from cold arrivals', (
    f?.join_entries?.from_site === 1
    && f?.join_entries?.direct === 0
    && f?.cold_join_entries === 0
  ), f?.join_entries);
  check('landing-page traffic grouped by source', (
    f?.sources?.meta === 1 && f?.sources?.internal === 1 && f?.sources?.direct === 0
  ), f?.sources);
  // A hostname-only referrer cannot separate the homepage from /support, so
  // the same-site bucket must never be published as a homepage conversion.
  check('no funnel step claims same-site referrals are homepage click-through', (
    Array.isArray(f?.steps)
    && !f.steps.some((s) => s.key === 'join_from_home')
    && f.steps.find((s) => s.key === 'join')?.of === 'home'
    && f.steps.find((s) => s.key === 'join')?.bound === 'upper'
    && f.steps.find((s) => s.key === 'join')?.count === f?.totals?.join_views
    && f.steps.find((s) => s.key === 'complete')?.count === 1
  ), f?.steps);
  check('blocked checkout window detected', (
    f?.blocked_windows?.length === 2
    && f.blocked_windows[0].submits === 2
  ), f?.blocked_windows);
  // Mirror the endpoint's Pacific hour key so the assertions name real hours.
  const PT_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' });
  const PT_HOUR = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Los_Angeles', hour: '2-digit', hourCycle: 'h23',
  });
  const ptHour = (ms) => `${PT_DAY.format(new Date(ms))}T${PT_HOUR.format(new Date(ms))}`;
  const nowMs = FIXED_NOW;
  const straddleHour = ptHour(hourStart(3));
  const flagged = (f?.blocked_windows || []).map((w) => w.hour);
  check('an hour whose departures land in the next one is not an outage', (
    !flagged.includes(straddleHour)
    && f?.totals?.checkout_departed === 3
  ), { flagged, straddleHour });
  check('the still-open hour is never flagged as blocked', (
    !flagged.includes(ptHour(nowMs))
  ), { flagged, openHour: ptHour(nowMs) });
  check('only genuinely blocked hours are reported', (
    flagged.length === 2
    && flagged[0] === ptHour(hourStart(5))
    && flagged[1] === ptHour(hourStart(120))
  ), { flagged, expected: [ptHour(hourStart(5)), ptHour(hourStart(120))] });
  // The banner is driven by `recent`; the rest stay as record only.
  check('only a recent outage is marked for the alert banner', (
    f.blocked_windows[0].recent === true
    && f.blocked_windows[1].recent === false
    && f?.blocked_alert_hours === 24
  ), f?.blocked_windows);
  // The failures fired in the following hour. Bucketing them by their own
  // timestamp would leave the outage with no cause, or borrow an unrelated one.
  check('a blocked hour names the error its own attempts hit', (
    f?.blocked_windows?.[0]?.top_error_code === 'CHALLENGE_FAILED'
    && f.blocked_windows[0].errors === 2
  ), f?.blocked_windows);
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
    !/must-not-leak|email|first_name|last_name|stripe_customer_id/i.test(JSON.stringify(overview))
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

// Case: a partial but valid aggregate is projected safely instead of leaking
// undefined values or suppressing independent dashboard sections.
{
  const origFetch = globalThis.fetch;
  const origHttpsRequest = https.request;
  globalThis.fetch = mockDashboardFetch({ partialSubscriptionOverview: true });
  https.request = mockStripeHttps();
  const handler = await fresh('../api/dashboard-data.js');
  const { res, out } = mockRes();
  await handler({ method: 'GET', headers: { authorization: 'Bearer sekret-token' }, query: { days: '30' } }, res);
  globalThis.fetch = origFetch;
  https.request = origHttpsRequest;

  check('partial subscription report is normalized without hiding other sections', (
    out.status === 200
    && out.body?.subscription_overview?.totals?.active === 9
    && out.body?.subscription_overview?.new_paid?.h24 === null
    && out.body?.funnel?.totals?.visits === 2
    && Array.isArray(out.body?.health)
  ), out.body);
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

// Case: a long live outage must not be truncated by the history cap, and a
// capped history must say how much it left out.
{
  const blocked = [];
  // 13 consecutive blocked hours inside the 24-hour alert horizon. Offsets
  // start at 6 to clear the hours the shared fixture already occupies: the
  // open hour, the straddle hour at 3 (which has departures, so it is not
  // blocked) and the blocked hour at 5.
  for (let h = 6; h <= 18; h++) {
    blocked.push(
      { ts: new Date(hourStart(h) + 60e3).toISOString(), event: 'join_submit', flow_id: `00000000-0000-4000-9000-${String(h).padStart(12, '0')}` },
      { ts: new Date(hourStart(h) + 120e3).toISOString(), event: 'join_submit', flow_id: `00000000-0000-4000-9001-${String(h).padStart(12, '0')}` },
    );
  }
  // 15 more from well outside it, which the cap should trim to 12.
  for (let h = 1; h <= 15; h++) {
    blocked.push(
      { ts: new Date(hourStart(200 + h) + 60e3).toISOString(), event: 'join_submit', flow_id: `00000000-0000-4000-9002-${String(h).padStart(12, '0')}` },
      { ts: new Date(hourStart(200 + h) + 120e3).toISOString(), event: 'join_submit', flow_id: `00000000-0000-4000-9003-${String(h).padStart(12, '0')}` },
    );
  }
  process.env.DASHBOARD_TOKEN = 'tok';
  process.env.STRIPE_SECRET_KEY = 'sk_test_x';
  process.env.RESEND_API_KEY = 're_x';
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
  globalThis.fetch = mockDashboardFetch({ extraCheckoutRows: blocked });
  https.request = mockStripeHttps();
  const handler = await fresh('../api/dashboard-data.js');
  const { res, out } = mockRes();
  await handler({ method: 'GET', headers: { authorization: 'Bearer tok' }, query: { days: 30 } }, res);
  const f = out.body?.funnel;
  const recent = (f?.blocked_windows || []).filter((w) => w.recent);
  const older = (f?.blocked_windows || []).filter((w) => !w.recent);
  // 13 injected hours plus the shared fixture's own blocked hour at offset 5.
  check('a live outage longer than the history cap is reported in full', (
    recent.length === 14 && recent.every((w) => w.submits === 2)
  ), { recent: recent.length, hours: recent.map((w) => w.hour) });
  check('the alert total counts every live hour, not the first twelve', (
    recent.reduce((sum, w) => sum + w.submits, 0) === 28
  ), recent.map((w) => w.submits));
  check('historical blocked hours are capped and the remainder counted', (
    older.length === 12 && f?.blocked_omitted === 4
  ), { older: older.length, omitted: f?.blocked_omitted });
}

process.exit(failures ? 1 : 0);
