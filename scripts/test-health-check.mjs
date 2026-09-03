#!/usr/bin/env node
/**
 * Offline tests for /api/health-check — no credentials or network.
 * Stripe mocked at node:https; Resend/Supabase at global fetch.
 * Usage: node scripts/test-health-check.mjs   (also part of: npm test)
 */
import https from 'node:https';
import { PassThrough } from 'node:stream';

const OPS_TO = 'ops-owner@example.com';
const OPS_FROM = 'DPC Operations <ops-sender@example.com>';
const OPS_REPLY_TO = 'ops-reply@example.com';

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
  process.env.ALERT_TO = OPS_TO;
  process.env.ALERT_FROM = OPS_FROM;
  process.env.ALERT_REPLY_TO = OPS_REPLY_TO;
  process.env.VERCEL_ENV = 'production';
  delete process.env.DASHBOARD_TOKEN;
  delete process.env.NOTIFY_DEPOSIT_TO;
  delete process.env.NOTIFY_DEPOSIT_FROM;
  delete process.env.NOTIFY_TO;
  delete process.env.NOTIFY_FROM;
  delete process.env.AUTOACK_FROM;
  delete process.env.AUTOACK_REPLY_TO;
  delete process.env.WELCOME_FROM;
  delete process.env.WELCOME_REPLY_TO;
}

// Stripe https mock: healthy or auth-rejected list endpoints, empty/stale events.
function mockStripeHttps({
  keyOk = true,
  staleEvent = false,
  staleEventType = 'checkout.session.completed',
} = {}) {
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
            ? [{
              id: 'evt_stale',
              type: staleEventType,
              created: Math.floor(Date.now() / 1000) - 7200,
              pending_webhooks: 1,
            }]
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
function mockFetch({
  priorAlertFingerprint = null,
  priorAlertMinutesAgo = 60,
  recentWebhookErrors = false,
  webhookQueryFails = false,
  observationInsertFails = false,
  gapInsertFails = false,
  supabaseDown = false,
  hangEmail = false,
  hangResendDomains = false,
  resendDomainErrorName = '',
  joinCanaryBroken = false,
  legalVersionsStatus = 200,
  legalVersionsBody = null,
  stalledHandoff = false,
  stalledHandoffCount = 1,
  fallbackHandoff = false,
  canaryDelayMs = 0,
} = {}, sentEmails, stats) {
  return async (url, opts) => {
    const u = String(url);
    if (u === 'https://www.downtownpourcollective.com/join') {
      if (canaryDelayMs) await new Promise((resolve) => setTimeout(resolve, canaryDelayMs));
      const body = joinCanaryBroken
        ? '<html><h1>Join</h1></html>'
        : '<a id="checkout-fallback">Open Secure Checkout</a><style>.btn[hidden]{display:none!important}</style>join_checkout_stalled window.location.assign';
      return new Response(body, { status: 200 });
    }
    if (u.startsWith('https://www.downtownpourcollective.com/api/legal-versions')) {
      if (canaryDelayMs) await new Promise((resolve) => setTimeout(resolve, canaryDelayMs));
      stats.legalVersionsUrls.push(u);
      const body = legalVersionsBody ?? { tos: '3.0', privacy: '4.2', memberTerms: '3.0', autoRenewalTerms: '3.0' };
      return new Response(JSON.stringify(body), { status: legalVersionsStatus, headers: { 'content-type': 'application/json' } });
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
        if (opts?.method === 'POST') {
          const row = JSON.parse(opts.body);
          stats.webhookInserts.push(row);
          if (
            row.source === 'health-check-observation' &&
            observationInsertFails
          ) {
            return new Response('insert failed', { status: 503 });
          }
          if (row.source === 'health-check-observation-gap' && gapInsertFails) {
            return new Response('gap insert failed', { status: 503 });
          }
          return new Response(null, { status: 201 });
        }
        if (u.includes('source=eq.health-check')) {
          stats.throttleReads += 1;
          const requested = u.match(/fingerprint=eq\.([0-9a-f]+)/)?.[1];
          const sinceText = u.match(/ts=gte\.([^&]+)/)?.[1];
          const since = sinceText
            ? new Date(decodeURIComponent(sinceText)).getTime()
            : 0;
          const priorAlertAt = Date.now() - priorAlertMinutesAgo * 60000;
          const rows = requested && requested === priorAlertFingerprint &&
            priorAlertAt >= since
            ? [{ ts: new Date(priorAlertAt).toISOString() }]
            : [];
          return new Response(JSON.stringify(rows), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        stats.webhookErrorQueries.push(u);
        if (webhookQueryFails) {
          return new Response('query failed', { status: 503 });
        }
        return new Response(JSON.stringify(
          recentWebhookErrors ? [{ ts: new Date().toISOString(), message: 'handler failed: boom' }] : []
        ), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (u.includes('/rest/v1/site_events')) {
        const rows = [];
        if (stalledHandoff) {
          for (let i = 0; i < stalledHandoffCount; i += 1) {
            rows.push({
              event: 'join_checkout_stalled',
              flow_id: '00000000-0000-4000-8000-' +
                String(i + 1).padStart(12, '0'),
            });
          }
        }
        if (fallbackHandoff) rows.push({ event: 'join_checkout_fallback_clicked', flow_id: '00000000-0000-4000-8000-000000000002' });
        return new Response(JSON.stringify(rows), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error('unexpected fetch: ' + u);
  };
}

async function run(
  mockOpts = {},
  envTweaks = null,
  reqHeaders = { authorization: 'Bearer cron-secret' },
  postImportEnvTweaks = null,
) {
  setHealthyEnv();
  if (envTweaks) envTweaks();
  const sentEmails = [];
  const stats = {
    throttleReads: 0,
    legalVersionsUrls: [],
    webhookInserts: [],
    webhookErrorQueries: [],
  };
  const origFetch = globalThis.fetch;
  const origHttps = https.request;
  globalThis.fetch = mockFetch(mockOpts, sentEmails, stats);
  https.request = mockStripeHttps(mockOpts);
  const handler = await fresh();
  if (postImportEnvTweaks) postImportEnvTweaks();
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

function insertsFrom(stats, source) {
  return stats.webhookInserts.filter((row) => row.source === source);
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
let brokenJoinFingerprint = null;
{
  const { out, sentEmails } = await run({ joinCanaryBroken: true });
  brokenJoinFingerprint = out.body.fingerprint;
  check('broken checkout canary is flagged', out.body.problems.some((p) => p.includes('checkout canary')), out.body.problems);
  check('broken checkout canary sends an alert', out.body.alerted === true && sentEmails.length === 1, out.body);
}

// Case 6: one stalled browser handoff is visible without paging operators.
{
  const { out, sentEmails } = await run({ stalledHandoff: true });
  check(
    'stalled checkout handoff is visible',
    out.body.warnings.some((warning) =>
      warning.includes('stalled checkout handoff')),
    out.body.warnings,
  );
  check(
    'one stalled checkout handoff sends no alert',
    out.body.alerted === false && sentEmails.length === 0,
    out.body,
  );
}

// Case 7: recovery-link use is dashboard context, not a paging incident
{
  const { out, sentEmails } = await run({ fallbackHandoff: true });
  check('fallback use alone remains healthy', out.body.ok === true, out.body);
  check('fallback use alone sends no alert', sentEmails.length === 0, sentEmails);
}

// Case 8: the four bounded canary probes run concurrently
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
  const { out, sentEmails } = await run({ keyOk: false }, () => {
    process.env.NOTIFY_DEPOSIT_TO = 'nick@downtownpourcollective.com,hello@downtownpourcollective.com';
    process.env.NOTIFY_DEPOSIT_FROM = 'Downtown Pour Collective <hello@downtownpourcollective.com>';
    process.env.NOTIFY_TO = 'nick@downtownpourcollective.com,partners@downtownpourcollective.com';
    process.env.NOTIFY_FROM = 'DPC Partners <partners@downtownpourcollective.com>';
    process.env.AUTOACK_FROM = 'Downtown Pour Collective <partners@downtownpourcollective.com>';
    process.env.AUTOACK_REPLY_TO = 'nick@downtownpourcollective.com';
    process.env.WELCOME_FROM = 'Downtown Pour Collective <hello@downtownpourcollective.com>';
    process.env.WELCOME_REPLY_TO = 'hello@downtownpourcollective.com';
  });
  brokenKeyFingerprint = out.body.fingerprint;
  check('broken key -> ok:false', out.body.ok === false, out.body);
  check('capability probe named', out.body.problems.some((p) => p.includes('Stripe key can read')), out.body.problems);
  check('alert email sent', out.body.alerted === true && sentEmails.length === 1, out.body);
  check(
    'alert email uses reviewed policy text',
    JSON.stringify(sentEmails[0])
      .includes('Stripe checkout access is rejected') &&
      !JSON.stringify(sentEmails[0]).includes('Invalid API Key'),
    sentEmails[0],
  );
  check('alert email uses only the ops recipient', JSON.stringify(sentEmails[0]?.to) === JSON.stringify([OPS_TO]), sentEmails[0]);
  check('alert email uses the ops sender', sentEmails[0]?.from === OPS_FROM, sentEmails[0]);
  check('alert email uses the ops reply-to', sentEmails[0]?.reply_to === OPS_REPLY_TO, sentEmails[0]);
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

// Case 17: SEV-1 retains the six-hour suppression window.
{
  const { out, sentEmails } = await run({
    joinCanaryBroken: true,
    priorAlertFingerprint: brokenJoinFingerprint,
  });
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

// Case 21: /api/legal-versions is down -> both checkout pages block, so page.
{
  const { out, sentEmails } = await run({ legalVersionsStatus: 503 });
  check('legal-versions outage flagged', out.body.problems.some((p) => p.includes('/api/legal-versions is unhealthy')), out.body.problems);
  check('legal-versions outage names the consequence', out.body.problems.some((p) => p.includes('checkout are blocked')), out.body.problems);
  check('legal-versions outage -> alert sent', out.body.alerted === true && sentEmails.length === 1, out.body);
}

// Case 22: a structurally incomplete 200 breaks checkout exactly as hard as a
// 503 does — this is what future schema drift looks like — so it must page too.
{
  const { out } = await run({ legalVersionsBody: { tos: '3.0', privacy: '4.2', memberTerms: '3.0' } });
  check('incomplete legal-versions tuple flagged', out.body.problems.some((p) => p.includes('incomplete tuple')), out.body.problems);
  check('incomplete legal-versions names the missing key', out.body.problems.some((p) => p.includes('autoRenewalTerms')), out.body.problems);
}

// Case 23: the probe must bypass the CDN. A cached 200 would keep reporting
// healthy straight through a grant regression or a missing singleton row.
{
  const { out, stats } = await run({});
  check('legal-versions probed exactly once', stats.legalVersionsUrls.length === 1, stats.legalVersionsUrls);
  check('legal-versions probe uses ?fresh=1', stats.legalVersionsUrls.every((u) => u.includes('fresh=1')), stats.legalVersionsUrls);
  check('healthy legal-versions raises nothing', !out.body.problems.some((p) => p.includes('legal-versions')), out.body.problems);
}

// Case 24: business-notification variables cannot activate the operational
// route when its own required settings are absent.
{
  const { out, sentEmails } = await run({}, () => {
    delete process.env.ALERT_TO;
    delete process.env.ALERT_FROM;
    delete process.env.ALERT_REPLY_TO;
    process.env.NOTIFY_DEPOSIT_TO = 'nick@downtownpourcollective.com,hello@downtownpourcollective.com';
    process.env.NOTIFY_DEPOSIT_FROM = 'Downtown Pour Collective <hello@downtownpourcollective.com>';
    process.env.NOTIFY_TO = 'nick@downtownpourcollective.com,partners@downtownpourcollective.com';
    process.env.NOTIFY_FROM = 'DPC Partners <partners@downtownpourcollective.com>';
    process.env.AUTOACK_FROM = 'Downtown Pour Collective <partners@downtownpourcollective.com>';
    process.env.AUTOACK_REPLY_TO = 'nick@downtownpourcollective.com';
    process.env.WELCOME_FROM = 'Downtown Pour Collective <hello@downtownpourcollective.com>';
    process.env.WELCOME_REPLY_TO = 'hello@downtownpourcollective.com';
  });
  check('business-only config sends no ops email', sentEmails.length === 0, sentEmails);
  check('missing ops config makes the health check unhealthy', out.body.ok === false, out.body);
  check(
    'missing ops config is present in health problems',
    ['ALERT_TO', 'ALERT_FROM', 'ALERT_REPLY_TO'].every((name) =>
      out.body.problems.some((problem) => problem.includes(name))),
    out.body,
  );
  check(
    'business-only config reports the blocking ops recipient',
    String(out.body.alert_error).includes('ALERT_TO') &&
      !String(out.body.alert_error).includes('ALERT_FROM') &&
      !String(out.body.alert_error).includes('ALERT_REPLY_TO'),
    out.body,
  );
}

// Case 25: missing optional reply-to remains visible but cannot silence the
// operational route.
{
  const { out, sentEmails } = await run({}, () => {
    delete process.env.ALERT_REPLY_TO;
  });
  check(
    'missing reply-to still sends an ops email',
    out.body.alerted === true && sentEmails.length === 1,
    out.body,
  );
  check(
    'missing reply-to makes the health check unhealthy',
    out.body.ok === false,
    out.body,
  );
  check(
    'missing reply-to is present in health problems',
    out.body.problems.some((problem) => problem.includes('ALERT_REPLY_TO')),
    out.body,
  );
  check(
    'missing reply-to does not set alert_error',
    !out.body.alert_error,
    out.body,
  );
  check(
    'missing reply-to is omitted from Resend',
    sentEmails.length === 1 && !Object.hasOwn(sentEmails[0], 'reply_to'),
    sentEmails[0],
  );
}

// Case 26: a future Vercel edit cannot restore Nick or hello@ to any
// operational delivery identity.
for (const [label, name, value] of [
  ['ALERT_TO', 'ALERT_TO', 'hello@downtownpourcollective.com'],
  ['ALERT_TO plus alias', 'ALERT_TO', 'hello+ops@downtownpourcollective.com'],
  ['ALERT_TO dotted alias', 'ALERT_TO', 'h.e.l.l.o@downtownpourcollective.com'],
]) {
  const { out, sentEmails } = await run({}, () => {
    process.env[name] = value;
  });
  check(
    `${label} rejects a prohibited ops identity`,
    sentEmails.length === 0,
    sentEmails,
  );
  check(
    `${label} makes the health check unhealthy`,
    out.body.ok === false,
    out.body,
  );
  check(
    `${label} is present in health problems`,
    out.body.problems.some((problem) => problem.includes(name)),
    out.body,
  );
  check(
    `${label} reports its prohibited ops identity`,
    String(out.body.alert_error).includes(name),
    out.body,
  );
}

// Case 27: missing sender configuration remains visible but falls back to a
// safe operations-only identity instead of silencing the alert.
{
  const { out, sentEmails } = await run({}, () => {
    delete process.env.ALERT_FROM;
  });
  check(
    'missing sender still sends an ops email',
    out.body.alerted === true && sentEmails.length === 1,
    out.body,
  );
  check(
    'missing sender makes the health check unhealthy',
    out.body.ok === false,
    out.body,
  );
  check(
    'missing sender is present in health problems',
    out.body.problems.some((problem) => problem.includes('ALERT_FROM')),
    out.body,
  );
  check(
    'missing sender does not set alert_error',
    !out.body.alert_error,
    out.body,
  );
  check(
    'missing sender uses the safe operations fallback',
    sentEmails[0]?.from ===
      'Downtown Pour Collective Operations <support@downtownpourcollective.com>',
    sentEmails[0],
  );
}

// Case 28: prohibited optional identities are reported, sanitized, and never
// allowed to block the required recipient route.
for (const [name, value] of [
  ['ALERT_FROM', 'DPC Operations <nick@downtownpourcollective.com>'],
  ['ALERT_REPLY_TO', 'hello@downtownpourcollective.com'],
]) {
  const { out, sentEmails } = await run({}, () => {
    process.env[name] = value;
  });
  check(
    `${name} remains visible as unhealthy`,
    out.body.ok === false,
    out.body,
  );
  check(
    `${name} still sends an ops email`,
    out.body.alerted === true && sentEmails.length === 1,
    out.body,
  );
  check(`${name} does not set alert_error`, !out.body.alert_error, out.body);
  check(
    `${name} is absent from the outbound message`,
    !JSON.stringify(sentEmails[0]).includes(value),
    sentEmails[0],
  );
}

// Case 29: configuration is read for each invocation so an authenticated
// post-deploy check proves which recipient the running function sees.
{
  const rotatedRecipient = 'rotated-ops@example.com';
  const { out, sentEmails } = await run(
    { keyOk: false },
    null,
    { authorization: 'Bearer cron-secret' },
    () => { process.env.ALERT_TO = rotatedRecipient; },
  );
  check(
    'runtime recipient change still sends',
    out.body.alerted === true,
    out.body,
  );
  check(
    'runtime recipient change reaches the current value',
    sentEmails[0]?.to?.length === 1 && sentEmails[0].to[0] === rotatedRecipient,
    sentEmails[0],
  );
}

// Case 30: malformed identities cannot reach Resend and turn a configuration
// defect into a silent provider rejection.
for (const [name, expected] of [
  ['ALERT_TO', 'blocked'],
  ['ALERT_FROM', 'fallback'],
  ['ALERT_REPLY_TO', 'omitted'],
]) {
  const { out, sentEmails } = await run({}, () => {
    process.env[name] = 'not-an-email';
  });
  check(
    `${name} malformed value is reported`,
    out.body.problems.some((problem) => problem.includes(`${name} is invalid`)),
    out.body,
  );
  if (expected === 'blocked') {
    check(
      `${name} malformed value blocks delivery`,
      sentEmails.length === 0,
      out.body,
    );
  } else {
    check(
      `${name} malformed value preserves delivery`,
      sentEmails.length === 1,
      out.body,
    );
    check(
      `${name} malformed value is absent from the message`,
      sentEmails[0] && !JSON.stringify(sentEmails[0]).includes('not-an-email'),
      sentEmails[0],
    );
  }
}

// Case 31: a terminal dot on the DPC domain cannot evade the prohibited
// mailbox check.
{
  const { out, sentEmails } = await run({}, () => {
    process.env.ALERT_TO = 'hello@downtownpourcollective.com.';
  });
  check(
    'terminal-dot alias blocks delivery',
    sentEmails.length === 0,
    out.body,
  );
  check(
    'terminal-dot alias is reported as prohibited',
    out.body.problems.some((problem) =>
      problem.includes('ALERT_TO contains a prohibited operational identity')),
    out.body,
  );
}

// Case 32: every authenticated healthy Production run leaves one atomic,
// allowlisted observation row independently of notification delivery.
{
  const { out, stats } = await run({});
  const rows = insertsFrom(stats, 'health-check-observation');
  check(
    'healthy production run writes one observation row',
    rows.length === 1,
    stats,
  );
  const row = rows[0];
  check(
    'observation row uses pinned bookkeeping identity',
    row?.level === 'info' && row?.message === 'health check observations',
    row,
  );
  check(
    'observation detail has only allowlisted top-level fields',
    JSON.stringify(Object.keys(row?.detail || {}).sort()) ===
      JSON.stringify(['checked_at', 'environment', 'observations', 'timings']),
    row,
  );
  check(
    'observation items have only key, severity, and state',
    row?.detail?.observations?.length > 0 &&
      row.detail.observations.every((item) =>
        JSON.stringify(Object.keys(item).sort()) ===
          JSON.stringify(['key', 'severity', 'state'])),
    row,
  );
  check(
    'healthy observations are explicit',
    row?.detail?.observations?.every((item) => item.state === 'healthy'),
    row,
  );
  check(
    'observation timings are integer milliseconds',
    Object.values(row?.detail?.timings || {}).length > 0 &&
      Object.values(row.detail.timings).every(Number.isInteger),
    row,
  );
  check(
    'observation evidence includes comparable total runtime',
    Number.isInteger(row?.detail?.timings?.total_ms),
    row,
  );
  check(
    'healthy response exposes explicit observations',
    out.body.observations?.length > 0,
    out.body,
  );
}

// Case 33: Preview and Development do not create Production evidence.
{
  const { stats } = await run({}, () => {
    process.env.VERCEL_ENV = 'preview';
  });
  check(
    'preview writes no production observation row',
    insertsFrom(stats, 'health-check-observation').length === 0,
    stats,
  );
}

// Case 34: bookkeeping can never feed the production webhook-error signal.
{
  const { stats } = await run({});
  check(
    'webhook error probe is source allowlisted',
    stats.webhookErrorQueries.length === 1 &&
      stats.webhookErrorQueries[0].includes('source=eq.stripe-webhook'),
    stats.webhookErrorQueries,
  );
}

// Case 35: a failed diagnostic query is unknown, never implicitly healthy.
{
  const { out } = await run({ webhookQueryFails: true });
  const observation = out.body.observations?.find((item) =>
    item.key === 'webhook_errors');
  check(
    'failed webhook query records unknown',
    observation?.state === 'unknown' && observation?.severity === 'SEV-2',
    out.body,
  );
}

// Case 36: a failed evidence append is visible and uses a distinct info-level
// coverage-gap source if the second write succeeds.
{
  const { out, stats } = await run({ observationInsertFails: true });
  const gaps = insertsFrom(stats, 'health-check-observation-gap');
  const observation = out.body.observations?.find((item) =>
    item.key === 'monitoring:observation-append');
  check(
    'failed observation append records a coverage gap',
    gaps.length === 1,
    stats,
  );
  check('coverage gap stays info-level', gaps[0]?.level === 'info', gaps[0]);
  check(
    'failed observation append is explicit unknown',
    observation?.state === 'unknown',
    out.body,
  );
}

// Case 37: outbound notifications use policy text, not arbitrary provider
// details, and the old generic subject is unreachable.
{
  const { sentEmails } = await run({ keyOk: false });
  const payload = JSON.stringify(sentEmails[0]);
  check(
    'alert subject contains severity, environment, and capability',
    /^\[SEV-0\]\[PROD\]\[[A-Z-]+\]/.test(sentEmails[0]?.subject || ''),
    sentEmails[0],
  );
  check(
    'alert excludes raw provider errors',
    !payload.includes('Invalid API Key'),
    sentEmails[0],
  );
  check(
    'old generic alert subject is absent',
    !payload.includes('DPC ops alert:'),
    sentEmails[0],
  );
}

// Case 38: mixed severities lead with the highest and disclose additional
// findings without leaking webhook log messages.
{
  const { sentEmails } = await run({
    legalVersionsBody: { tos: '3.0', privacy: '4.2', memberTerms: '3.0' },
    recentWebhookErrors: true,
  });
  const payload = JSON.stringify(sentEmails[0]);
  check(
    'mixed alert leads with SEV-0',
    sentEmails[0]?.subject?.startsWith('[SEV-0]'),
    sentEmails[0],
  );
  check(
    'mixed alert states additional findings exist',
    /additional finding/.test(sentEmails[0]?.subject || ''),
    sentEmails[0],
  );
  check(
    'mixed alert excludes webhook free text',
    !payload.includes('handler failed: boom'),
    sentEmails[0],
  );
}

// Case 39: an isolated handoff stall with healthy canaries is informational
// and never claims checkout is unavailable.
{
  const { out, sentEmails } = await run({ stalledHandoff: true });
  const observation = out.body.observations?.find((item) =>
    item.key === 'checkout_handoff_stalled');
  check(
    'isolated handoff stall is SEV-2',
    observation?.state === 'unhealthy' && observation?.severity === 'SEV-2',
    out.body,
  );
  check(
    'isolated handoff stall sends no immediate email',
    sentEmails.length === 0,
    sentEmails,
  );
}

// Case 40: an undelivered event outside the reviewed sensitive allowlist is
// dashboard-only during the immediate tranche.
{
  const { out, sentEmails } = await run({
    staleEvent: true,
    staleEventType: 'product.updated',
  });
  const observation = out.body.observations?.find((item) =>
    item.key === 'undelivered_events');
  check(
    'non-sensitive undelivered event is SEV-2',
    observation?.severity === 'SEV-2',
    out.body,
  );
  check(
    'non-sensitive undelivered event sends no email',
    sentEmails.length === 0,
    sentEmails,
  );
}

// Case 41: SEV-0 reminders use a 30-minute window rather than the legacy
// six-hour silence.
{
  const incident = { legalVersionsBody: { tos: '3.0' } };
  const first = await run(incident);
  const recent = await run({
    ...incident,
    priorAlertFingerprint: first.out.body.fingerprint,
    priorAlertMinutesAgo: 25,
  });
  const due = await run({
    ...incident,
    priorAlertFingerprint: first.out.body.fingerprint,
    priorAlertMinutesAgo: 31,
  });
  check(
    'SEV-0 remains quiet before 30 minutes',
    recent.out.body.throttled === true,
    recent.out.body,
  );
  check(
    'SEV-0 reminds after 30 minutes',
    due.out.body.alerted === true,
    due.out.body,
  );
}

// Case 42: Claude round-two polish — compact display-name syntax is accepted
// instead of mysteriously selecting the fallback sender.
{
  const compactSender = 'DPC Operations<ops-sender@example.com>';
  const { sentEmails } = await run({ keyOk: false }, () => {
    process.env.ALERT_FROM = compactSender;
  });
  check(
    'compact sender display syntax is accepted',
    sentEmails[0]?.from === compactSender,
    sentEmails[0],
  );
}

// Case 43: throttling controls notification delivery, never evidence capture.
{
  const first = await run({ joinCanaryBroken: true });
  const repeated = await run({
    joinCanaryBroken: true,
    priorAlertFingerprint: first.out.body.fingerprint,
  });
  check('throttled run still writes one observation row',
    repeated.out.body.throttled === true &&
      insertsFrom(
        repeated.stats,
        'health-check-observation',
      ).length === 1,
    repeated.stats);
  const evidence = insertsFrom(
    repeated.stats,
    'health-check-observation',
  )[0];
  check('throttled runtime includes its throttle phase',
    Number.isInteger(evidence?.detail?.timings?.throttle_read_ms) &&
      Number.isInteger(evidence?.detail?.timings?.total_ms),
    evidence);
}

// Case 44: a notification-provider failure also cannot erase run evidence.
{
  const failed = await run({ keyOk: false, hangEmail: true });
  check('alert-failed run still writes one observation row',
    /timed out/.test(failed.out.body.alert_error || '') &&
      insertsFrom(
        failed.stats,
        'health-check-observation',
      ).length === 1,
    failed.stats);
  const evidence = insertsFrom(
    failed.stats,
    'health-check-observation',
  )[0];
  check('alert-failed runtime includes the failed send',
    evidence?.detail?.timings?.alert_send_ms >= 4000 &&
      evidence?.detail?.timings?.total_ms >= 4000,
    evidence);
}

// Case 45: repeated stalls cross the interim threshold and become SEV-1.
{
  const { out, sentEmails } = await run({
    stalledHandoff: true,
    stalledHandoffCount: 2,
  });
  const observation = out.body.observations?.find((item) =>
    item.key === 'checkout_handoff_stalled');
  check('repeated checkout stalls are SEV-1',
    observation?.state === 'unhealthy' &&
      observation?.severity === 'SEV-1',
    out.body);
  check('repeated checkout stalls send an alert',
    out.body.alerted === true && sentEmails.length === 1,
    out.body);
}

// Case 46: the reviewed Stripe event allowlist promotes money/access events.
{
  const { out, sentEmails } = await run({ staleEvent: true });
  const observation = out.body.observations?.find((item) =>
    item.key === 'undelivered_events');
  check('sensitive undelivered event is SEV-0',
    observation?.state === 'unhealthy' &&
      observation?.severity === 'SEV-0',
    out.body);
  check('sensitive undelivered event sends an alert',
    out.body.alerted === true && sentEmails.length === 1,
    out.body);
}

// Case 47: durable evidence contains policy data, never provider diagnostics.
{
  const { stats } = await run({ keyOk: false });
  const evidence = insertsFrom(stats, 'health-check-observation')[0];
  check('observation evidence excludes arbitrary provider text',
    !JSON.stringify(evidence).includes('Invalid API Key'),
    evidence);
}

// Case 48: missing audience sync configuration is dashboard-only SEV-2.
{
  const { out, sentEmails } = await run({}, () => {
    delete process.env.RESEND_FOUNDING_AUDIENCE_ID;
  });
  const observation = out.body.observations?.find((item) =>
    item.key === 'check:Resend founding audience ID set');
  check('missing audience configuration is SEV-2',
    observation?.state === 'unhealthy' &&
      observation?.severity === 'SEV-2',
    out.body);
  check('missing audience configuration sends no email',
    out.body.problems.length === 0 &&
      out.body.warnings.length === 1 &&
      sentEmails.length === 0,
    out.body);
}

// Case 49: Preview and Development suppress Production evidence, while an
// unknown environment retains the pre-existing fail-noisy behavior.
for (const environment of ['preview', 'development']) {
  const { stats } = await run({}, () => {
    process.env.VERCEL_ENV = environment;
  });
  check(`${environment || 'unset'} writes no production evidence`,
    insertsFrom(stats, 'health-check-observation').length === 0,
    stats);
}
{
  const { stats } = await run({}, () => {
    delete process.env.VERCEL_ENV;
  });
  check('unset environment retains fail-noisy production evidence',
    insertsFrom(stats, 'health-check-observation').length === 1,
    stats);
}

process.exit(failures ? 1 : 0);
