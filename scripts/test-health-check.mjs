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
  delete process.env.CRON_SECRET;
  delete process.env.DASHBOARD_TOKEN;
}

// Stripe https mock: healthy or broken-key balance, empty/stale event list.
function mockStripeHttps({ balanceOk = true, staleEvent = false } = {}) {
  return (options) => {
    const req = new PassThrough();
    req.setTimeout = () => req;
    req.abort = () => {};
    const path = String(options.path || '').split('?')[0];
    process.nextTick(() => {
      const res = new PassThrough();
      res.headers = { 'content-type': 'application/json', 'request-id': 'req_mock' };
      let body;
      if (path.startsWith('/v1/balance')) {
        res.statusCode = balanceOk ? 200 : 401;
        body = balanceOk
          ? { object: 'balance', livemode: true, available: [] }
          : { error: { type: 'invalid_request_error', message: 'Invalid API Key provided' } };
      } else if (path.startsWith('/v1/events')) {
        res.statusCode = 200;
        body = {
          object: 'list', has_more: false,
          data: staleEvent
            ? [{ id: 'evt_stale', type: 'checkout.session.completed', created: Math.floor(Date.now() / 1000) - 7200, pending_webhooks: 1 }]
            : [],
        };
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

// fetch mock for Resend + Supabase; records sent alert emails.
function mockFetch({ priorAlert = false, recentWebhookErrors = false } = {}, sentEmails) {
  return async (url, opts) => {
    const u = String(url);
    if (u.includes('api.resend.com/domains')) {
      return new Response(JSON.stringify({ data: { data: [] } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (u.includes('api.resend.com/emails')) {
      sentEmails.push(JSON.parse(opts.body));
      return new Response(JSON.stringify({ id: 'email_mock' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (u.includes('/rest/v1/webhook_logs')) {
      if (opts?.method === 'POST') return new Response(null, { status: 201 });
      if (u.includes('source=eq.health-check')) {
        return new Response(JSON.stringify(priorAlert ? [{ ts: new Date().toISOString() }] : []), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify(recentWebhookErrors ? [{ ts: new Date().toISOString(), message: 'handler failed: boom' }] : []), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (u.includes('/rest/v1/site_events')) {
      return new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error('unexpected fetch: ' + u);
  };
}

async function run(handlerOpts, envTweaks, reqHeaders) {
  setHealthyEnv();
  if (envTweaks) envTweaks();
  const sentEmails = [];
  const origFetch = globalThis.fetch;
  const origHttps = https.request;
  globalThis.fetch = mockFetch(handlerOpts, sentEmails);
  https.request = mockStripeHttps(handlerOpts);
  const handler = await fresh();
  const { res, out } = mockRes();
  await handler({ method: 'GET', headers: reqHeaders || {} }, res);
  globalThis.fetch = origFetch;
  https.request = origHttps;
  return { out, sentEmails };
}

// Case 1: CRON_SECRET set, missing/wrong auth -> 401
{
  const { out } = await run({}, () => { process.env.CRON_SECRET = 'cron-secret'; }, { authorization: 'Bearer wrong' });
  check('cron secret enforced -> 401', out.status === 401, out);
}

// Case 2: CRON_SECRET set, correct bearer -> allowed
{
  const { out } = await run({}, () => { process.env.CRON_SECRET = 'cron-secret'; }, { authorization: 'Bearer cron-secret' });
  check('cron secret accepted -> 200', out.status === 200, out);
}

// Case 3: all healthy -> ok:true, no email
{
  const { out, sentEmails } = await run({});
  check('healthy -> ok:true', out.status === 200 && out.body.ok === true, out.body);
  check('healthy -> no alert email', sentEmails.length === 0, sentEmails);
}

// Case 4: broken Stripe key -> problems + alert email sent
{
  const { out, sentEmails } = await run({ balanceOk: false });
  check('broken key -> ok:false', out.body.ok === false, out.body);
  check('broken key problem named', out.body.problems.some((p) => p.includes('Stripe key accepted by Stripe')), out.body.problems);
  check('alert email sent', out.body.alerted === true && sentEmails.length === 1, out.body);
  check('alert email lists the problem', JSON.stringify(sentEmails[0]).includes('Invalid API Key'), sentEmails[0]);
}

// Case 5: stale undelivered event -> flagged
{
  const { out } = await run({ staleEvent: true });
  check('stale undelivered event flagged', out.body.problems.some((p) => p.includes('undelivered')), out.body.problems);
}

// Case 6: recent webhook errors -> flagged
{
  const { out } = await run({ recentWebhookErrors: true });
  check('recent webhook errors flagged', out.body.problems.some((p) => p.includes('webhook error')), out.body.problems);
}

// Case 7: prior alert within 6h -> throttled, no second email
{
  const { out, sentEmails } = await run({ balanceOk: false, priorAlert: true });
  check('alert throttled within 6h', out.body.throttled === true && out.body.alerted === false, out.body);
  check('throttled -> no email sent', sentEmails.length === 0, sentEmails);
}

process.exit(failures ? 1 : 0);
