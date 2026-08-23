#!/usr/bin/env node
/**
 * Offline tests for /api/health-check — no credentials or network.
 * Stripe mocked at node:https; Resend/Supabase at global fetch.
 * Usage: node scripts/test-health-check.mjs   (also part of: npm test)
 */
import https from 'node:https';
import { PassThrough } from 'node:stream';

function mockRes() {
  const out = { status: null, body: null };
  const res = {
    setHeader() { return res; },
    status(c) { out.status = c; return res; },
    json(b) { out.body = b; return res; },
  };
  return { res, out };
}

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log(`PASS: ${name}`);
  else { failures++; console.error(`FAIL: ${name}`, extra ?? ''); }
}

let importCount = 0;
async function fresh() {
  const { default: handler } = await import(`../api/health-check.js?v=${++importCount}`);
  return handler;
}

function setHealthyEnv() {
  process.env.STRIPE_SECRET_KEY = 'sk_live_dummy';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_dummy';
  process.env.RESEND_API_KEY = 're_dummy';
  process.env.RESEND_FOUNDING_AUDIENCE_ID = 'aud_dummy';
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon_dummy';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service_dummy';
  process.env.CRON_SECRET = 'cron-secret';
  delete process.env.DASHBOARD_TOKEN;
  delete process.env.VERCEL_ENV;
}

// Stripe https mock: healthy or auth-rejected list endpoints, empty/stale events.
function mockStripeHttps({ keyOk = true, staleEvent = false } = {}) {
  return (options) => {
    const req = new PassThrough();
    req.setTimeout = () => req;
    req.abort = () => {};
    const path = String(options.path || '').split('?')[0];
    process.nextTick(() => {
      const res = new PassThrough();
      res.headers = { 'content-type': 'application/json', 'request-id': 'req_mock' };
      let body;
      if (!keyOk) {
        res.statusCode = 401;
        body = { error: { type: 'invalid_request_error', message: 'Invalid API Key provided' } };
      } else if (path.startsWith('/v1/events')) {
        res.statusCode = 200;
        body = {
          object: 'list', has_more: false,
          data: staleEvent
            ? [{ id: 'evt_stale', type: 'checkout.session.completed', created: Math.floor(Date.now() / 1000) - 7200, pending_webhooks: 1 }]
            : [],
        };
      } else if (path.startsWith('/v1/checkout/sessions') || path.startsWith('/v1/subscriptions')) {
        res.statusCode = 200;
        body = { object: 'list', has_more: false, data: [] };
      } else {
        res.statusCode = 404;
        body = { error: { message: 'not found' } };
      }
      req.emit('response', res);
      res.end(JSON.stringify(body));
    });
    return req;
  };
}

// fetch mock for Resend + Supabase; records sent alert emails + throttle reads.
function mockFetch({ priorAlertFingerprint = null, recentWebhookErrors = false, supabaseDown = false, hangEmail = false, hangResendDomains = false, resendDomainErrorName = '', joinCanaryBroken = false, stalledHandoff = false, fallbackHandoff = false, canaryDelayMs = 0 } = {}, sentEmails, stats) {
  return async (url, opts) => {
    const u = String(url);
    if (u === 'https://www.downtownpourcollective.com/join') {
      if (canaryDelayMs) await new Promise((resolve) => setTimeout(resolve, canaryDelayMs));
      const body = joinCanaryBroken
        ? '<html><h1>Join</h1></html>'
        : '<a id="checkout-fallback">Open Secure Checkout</a><style>.btn[hidden]{display:none!important}</style>join_checkout_stalled window.location.assign';
      return new Response(body, { status: 200 });
    }
    if (u.includes('/functions/v1/circle-checkout')) {
      if (canaryDelayMs) await new Promise((resolve) => setTimeout(resolve, canaryDelayMs));
      if (opts?.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'access-control-allow-methods': 'POST, OPTIONS' } });
      return new Response(JSON.stringify({ success: false, error: { code: 'INVALID_REQUEST' } }), { status: 400, headers: { 'content-type': 'application/json' } });
    }
    if (u.includes('api.resend.com/domains')) {
      if (hangResendDomains) return new Promise(() => {});
      if (resendDomainErrorName) {
        const status = resendDomainErrorName === 'restricted_api_key'
          ? 401
          : resendDomainErrorName === 'invalid_api_Key' ? 403 : 500;
        return new Response(JSON.stringify({ name: resendDomainErrorName, message: 'Resend probe failed' }), { status, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({ data: { data: [] } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (u.includes('api.resend.com/emails')) {
      if (hangEmail) return new Promise(() => {}); // stalled Resend: never settles
      sentEmails.push(JSON.parse(opts.body));
      return new Response(JSON.stringify({ id: 'email_mock' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (u.includes('/rest/v1/')) {
      if (supabaseDown) return new Response('unavailable', { status: 503 });
      if (u.includes('/rest/v1/webhook_logs')) {
        if (opts?.method === 'POST') return new Response(null, { status: 201 });
        if (u.includes('source=eq.health-check')) {
          stats.throttleReads += 1;
          const requested = u.match(/fingerprint=eq\.([0-9a-f]+)/)?.[1];
          const rows = requested && requested === priorAlertFingerprint ? [{ ts: new Date().toISOString() }] : [];
          return new Response(JSON.stringify(rows), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        return new Response(JSON.stringify(
          recentWebhookErrors ? [{ ts: new Date().toISOString(), message: 'handler failed: boom' }] : []
        ), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (u.includes('/rest/v1/site_events')) {
        const rows = [];
        if (stalledHandoff) rows.push({ event: 'join_checkout_stalled', flow_id: '00000000-0000-4000-8000-000000000001' });
        if (fallbackHandoff) rows.push({ event: 'join_checkout_fallback_clicked', flow_id: '00000000-0000-4000-8000-000000000002' });
        return new Response(JSON.stringify(rows), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error('unexpected fetch: ' + u);
  };
}

async function run(mockOpts = {}, envTweaks = null, reqHeaders = { authorization: 'Bearer cron-secret' }) {
  setHealthyEnv();
  if (envTweaks) envTweaks();
  const sentEmails = [];
  const stats = { throttleReads: 0 };
  const origFetch = globalThis.fetch;
  const origHttps = https.request;
  globalThis.fetch = mockFetch(mockOpts, sentEmails, stats);
  https.request = mockStripeHttps(mockOpts);
  const handler = await fresh();
  const { res, out } = mockRes();
  // withTimeout/AbortSignal timers are unref'ed; socketless mocks would let
  // the event loop drain before they fire, so hold the loop open.
  const keepAlive = setTimeout(() => {}, 20000);
  const startedAt = Date.now();
  await handler({ method: 'GET', headers: reqHeaders }, res);
  const elapsed = Date.now() - startedAt;
  clearTimeout(keepAlive);
  globalThis.fetch = origFetch;
  https.request = origHttps;
  return { out, sentEmails, stats, elapsed };
}

// Case 1: CRON_SECRET missing -> fail closed with 503
{
  const { out } = await run({}, () => { delete process.env.CRON_SECRET; });
  check('no CRON_SECRET -> 503 (fails closed)', out.status === 503, out);
}

// Case 2: wrong bearer -> 401
{
  const { out } = await run({}, null, { authorization: 'Bearer wrong' });
  check('wrong bearer -> 401', out.status === 401, out);
}

// Case 3: dashboard token accepted for manual runs
{
  const { out } = await run({}, () => { process.env.DASHBOARD_TOKEN = 'dash-token'; }, { authorization: 'Bearer dash-token' });
  check('dashboard token accepted -> 200', out.status === 200, out);
}

// Case 4: all healthy -> ok:true, no email
{
  const { out, sentEmails } = await run({});
  check('healthy -> ok:true', out.status === 200 && out.body.ok === true, out.body);
  check('healthy -> no alert email', sentEmails.length === 0, sentEmails);
}

// Case 5: production join markup loses its native handoff recovery -> alert
{
  const { out, sentEmails } = await run({ joinCanaryBroken: true });
  check('broken checkout canary is flagged', out.body.problems.some((p) => p.includes('checkout canary')), out.body.problems);
  check('broken checkout canary sends an alert', out.body.alerted === true && sentEmails.length === 1, out.body);
}

// Case 6: a real stalled browser handoff is surfaced within the signal window
{
  const { out, sentEmails } = await run({ stalledHandoff: true });
  check('stalled checkout handoff is flagged', out.body.problems.some((p) => p.includes('stalled checkout handoff')), out.body.problems);
  check('stalled checkout handoff sends an alert', out.body.alerted === true && sentEmails.length === 1, out.body);
}

// Case 7: recovery-link use is dashboard context, not a paging incident
{
  const { out, sentEmails } = await run({ fallbackHandoff: true });
  check('fallback use alone remains healthy', out.body.ok === true, out.body);
  check('fallback use alone sends no alert', sentEmails.length === 0, sentEmails);
}

// Case 8: the three bounded canary probes run concurrently
{
  const { out, elapsed } = await run({ canaryDelayMs: 300 });
  check('parallel canary remains healthy', out.body.ok === true, out.body);
  check('parallel canary completes within one probe window', elapsed < 700, `took ${elapsed}ms`);
}

// Case 9: preview failures are visible but never page production operators
{
  const { out, sentEmails } = await run({ joinCanaryBroken: true }, () => { process.env.VERCEL_ENV = 'preview'; });
  check('preview canary failure remains visible', out.body.ok === false, out.body);
  check('preview canary failure suppresses alert email', out.body.alert_suppressed === true && sentEmails.length === 0, out.body);
}

// Case 10: broken Stripe key -> capability problems + alert email sent
let brokenKeyFingerprint = null;
{
  const { out, sentEmails } = await run({ keyOk: false });
  brokenKeyFingerprint = out.body.fingerprint;
  check('broken key -> ok:false', out.body.ok === false, out.body);
  check('capability probe named', out.body.problems.some((p) => p.includes('Stripe key can read')), out.body.problems);
  check('alert email sent', out.body.alerted === true && sentEmails.length === 1, out.body);
  check('alert email lists the problem', JSON.stringify(sentEmails[0]).includes('Invalid API Key'), sentEmails[0]);
  check('fingerprint returned', typeof brokenKeyFingerprint === 'string' && brokenKeyFingerprint.length > 0, out.body);
}

// Case 11: a transient Resend management-endpoint timeout remains visible in
// logs but does not page operators when the actual email path is still usable.
{
  const { out, sentEmails } = await run({ hangResendDomains: true });
  check('Resend probe timeout marks health JSON unhealthy', out.body.ok === false, out.body);
  check('Resend probe timeout is returned as a warning', out.body.warnings.some((warning) => warning.includes('timed out')), out.body);
  check('Resend probe timeout leaves paging problems empty', out.body.problems.length === 0, out.body);
  check('Resend probe timeout alone sends no alert', out.body.alerted === false && sentEmails.length === 0, out.body);
}

// Case 12: a transient Resend API failure is also non-paging.
{
  const { out, sentEmails } = await run({ resendDomainErrorName: 'application_error' });
  check('transient Resend API failure marks health JSON unhealthy', out.body.ok === false, out.body);
  check('transient Resend API failure is returned as a warning', out.body.warnings.some((warning) => warning.includes('Resend probe failed')), out.body);
  check('transient Resend API failure leaves paging problems empty', out.body.problems.length === 0, out.body);
  check('transient Resend API failure sends no alert', out.body.alerted === false && sentEmails.length === 0, out.body);
}

// Case 13: an explicit Resend credential rejection remains a paging problem.
{
  const { out, sentEmails } = await run({ resendDomainErrorName: 'invalid_api_Key' });
  check('invalid Resend key is flagged', out.body.problems.some((p) => p.includes('Resend key accepted')), out.body.problems);
  check('invalid Resend key attempts an alert', out.body.alerted === true && sentEmails.length === 1, out.body);
}

// Case 14: a restricted Resend key is a persistent permission mismatch.
{
  const { out, sentEmails } = await run({ resendDomainErrorName: 'restricted_api_key' });
  check('restricted Resend key is flagged', out.body.problems.some((p) => p.includes('Resend key accepted')), out.body.problems);
  check('restricted Resend key attempts an alert', out.body.alerted === true && sentEmails.length === 1, out.body);
}

// Case 15: stale undelivered event -> flagged
{
  const { out } = await run({ staleEvent: true });
  check('stale undelivered event flagged', out.body.problems.some((p) => p.includes('undelivered')), out.body.problems);
}

// Case 16: recent webhook errors -> flagged
{
  const { out } = await run({ recentWebhookErrors: true });
  check('recent webhook errors flagged', out.body.problems.some((p) => p.includes('webhook error')), out.body.problems);
}

// Case 17: same incident within 6h -> throttled, no second email
{
  const { out, sentEmails } = await run({ keyOk: false, priorAlertFingerprint: brokenKeyFingerprint });
  check('same fingerprint throttled', out.body.throttled === true && out.body.alerted === false, out.body);
  check('throttled -> no email sent', sentEmails.length === 0, sentEmails);
}

// Case 18: a DIFFERENT prior incident does not suppress a new one
{
  const { out, sentEmails } = await run({ keyOk: false, priorAlertFingerprint: 'deadbeef00000000' });
  check('new incident alerts despite recent unrelated alert', out.body.alerted === true && sentEmails.length === 1, out.body);
}

// Case 19: Resend hangs on the alert send -> handler still returns before the
// function deadline with alert_error populated (bounded by ALERT_SEND timeout)
{
  const { out, elapsed } = await run({ keyOk: false, hangEmail: true });
  check('hanging alert send -> handler still returns 200', out.status === 200, out);
  check('hanging alert send -> alert_error populated', /timed out/.test(out.body.alert_error || ''), out.body);
  check('hanging alert send -> within time budget', elapsed < 10000, `took ${elapsed}ms`);
}

// Case 20: Supabase down -> throttle I/O skipped entirely, alert still sends
{
  const { out, sentEmails, stats } = await run({ supabaseDown: true });
  check('supabase down flagged', out.body.problems.some((p) => p.includes('Supabase reachable')), out.body.problems);
  check('supabase down -> alert still sent', out.body.alerted === true && sentEmails.length === 1, out.body);
  check('supabase down -> throttle read skipped', stats.throttleReads === 0, stats);
}

process.exit(failures ? 1 : 0);
