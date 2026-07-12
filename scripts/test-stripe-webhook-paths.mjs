#!/usr/bin/env node
/**
 * Offline webhook path tests — no Stripe CLI, no network, no credentials.
 * Usage: node scripts/test-stripe-webhook-paths.mjs   (or: npm test)
 *
 * Exercises the handler's response contract with signed mock events:
 * 1. missing env vars            -> 500 naming the vars
 * 2. live event + test key      -> 500 mode-mismatch
 * 3. ignored event type          -> 200 ignored_event_type
 * 4. Resend {error} response     -> 500 with detail (so Stripe retries)
 * 5. happy path                  -> 200 processed
 *
 * The Resend v4 SDK uses global fetch; the Stripe SDK uses node:https —
 * both are mocked at those layers. Signature verification runs for real
 * via stripe.webhooks.generateTestHeaderString.
 */
import Stripe from 'stripe';
import https from 'node:https';
import { Readable, PassThrough } from 'node:stream';

const WHSEC = 'whsec_test_secret_for_local_verification';
const stripe = new Stripe('sk_test_dummy');

function signedRequest(eventObj) {
  const payload = JSON.stringify(eventObj);
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: WHSEC });
  const req = Readable.from([Buffer.from(payload)]);
  req.method = 'POST';
  req.headers = { 'stripe-signature': header };
  return req;
}

function mockRes() {
  const out = { status: null, body: null };
  const res = {
    setHeader() { return res; },
    status(c) { out.status = c; return res; },
    json(b) { out.body = b; return res; },
  };
  return { res, out };
}

const baseEvent = (overrides) => ({
  id: 'evt_test_1',
  object: 'event',
  api_version: '2024-06-20',
  created: 1752000000,
  type: 'payout.paid',
  livemode: true,
  data: { object: { id: 'po_123' } },
  ...overrides,
});

const FOUNDING_SESSION = {
  id: 'cs_test_abc', object: 'checkout.session', payment_status: 'paid',
  currency: 'usd', amount_total: 4900,
  metadata: { product_type: 'founding_deposit' },
  customer_details: { email: 'buyer@example.com', name: 'Pat Buyer' },
  line_items: { data: [] },
};

// Returns a mock for https.request that answers every Stripe API call with
// the founding-deposit session (covers both sessions.retrieve and the
// welcome_sent metadata update).
function mockStripeHttps() {
  return () => {
    const req = new PassThrough();
    req.setTimeout = () => req;
    req.abort = () => {};
    process.nextTick(() => {
      const res = new PassThrough();
      res.statusCode = 200;
      res.headers = { 'content-type': 'application/json', 'request-id': 'req_mock' };
      req.emit('response', res);
      res.end(JSON.stringify(FOUNDING_SESSION));
    });
    return req;
  };
}

function mockResendFetch(body, status) {
  return async (url) => {
    const u = String(url);
    if (u.includes('api.resend.com')) {
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error('unexpected fetch: ' + u);
  };
}

// Fresh module instance per case so each one sees its own env vars.
let importCount = 0;
async function freshHandler() {
  const { default: handler } = await import(`../api/stripe-webhook.js?v=${++importCount}`);
  return handler;
}

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log(`PASS: ${name}`);
  else { failures++; console.error(`FAIL: ${name}`, extra ?? ''); }
}

// Case 1: missing env vars
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_WEBHOOK_SECRET;
delete process.env.RESEND_API_KEY;
{
  const handler = await freshHandler();
  const { res, out } = mockRes();
  await handler(signedRequest(baseEvent()), res);
  check('missing env -> 500', out.status === 500, out);
  check('missing env names listed', Array.isArray(out.body?.missing) && out.body.missing.length === 3, out.body);
}

// Case 2: live event with test key -> mode mismatch 500
process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
process.env.STRIPE_WEBHOOK_SECRET = WHSEC;
process.env.RESEND_API_KEY = 're_dummy';
{
  const handler = await freshHandler();
  const { res, out } = mockRes();
  await handler(signedRequest(baseEvent({ livemode: true })), res);
  check('live event + test key -> 500', out.status === 500, out);
  check('mode mismatch named', /live-mode event with test-mode API key/.test(out.body?.error || ''), out.body);
}

// Case 3: test event with test key, ignored type -> 200
{
  const handler = await freshHandler();
  const { res, out } = mockRes();
  await handler(signedRequest(baseEvent({ livemode: false })), res);
  check('matched mode, ignored type -> 200', out.status === 200 && out.body?.skipped === 'ignored_event_type', out);
}

// Case 4: Resend returns an API error body -> handler throws -> 500 with detail.
{
  const origFetch = globalThis.fetch;
  const origHttpsRequest = https.request;
  globalThis.fetch = mockResendFetch({ statusCode: 401, name: 'validation_error', message: 'API key is invalid' }, 401);
  https.request = mockStripeHttps();
  const handler = await freshHandler();
  const { res, out } = mockRes();
  await handler(signedRequest(baseEvent({
    livemode: false,
    type: 'checkout.session.completed',
    data: { object: { id: 'cs_test_abc' } },
  })), res);
  globalThis.fetch = origFetch;
  https.request = origHttpsRequest;
  check('resend API error -> 500 (Stripe will retry)', out.status === 500, out);
  check('500 detail names the resend failure', /welcome email send failed/.test(out.body?.detail || ''), out.body);
}

// Case 5: happy path — Resend succeeds everywhere -> 200 processed
{
  process.env.RESEND_FOUNDING_AUDIENCE_ID = 'aud_mock';
  const origFetch = globalThis.fetch;
  const origHttpsRequest = https.request;
  globalThis.fetch = mockResendFetch({ id: 'mock_ok' }, 200);
  https.request = mockStripeHttps();
  const handler = await freshHandler();
  const { res, out } = mockRes();
  await handler(signedRequest(baseEvent({
    livemode: false,
    type: 'checkout.session.completed',
    data: { object: { id: 'cs_test_abc' } },
  })), res);
  globalThis.fetch = origFetch;
  https.request = origHttpsRequest;
  check('happy path -> 200 processed', out.status === 200 && out.body?.processed === true, out);
}

process.exit(failures ? 1 : 0);
