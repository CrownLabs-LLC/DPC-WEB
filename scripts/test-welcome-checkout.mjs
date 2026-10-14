import assert from 'node:assert/strict';
import https from 'node:https';
import { PassThrough } from 'node:stream';
import { createWelcomeHandler } from '../api/welcome-checkout.js';
import { CATALOG, checkoutSummary } from '../api/lib/welcome-checkout.js';

const id = 'cs_live_' + 'a'.repeat(40);
const uuid = '01020304-1234-4567-8901-123456789012';
const catalog = CATALOG.live;
let checks = 0;
async function check(name, run) { await run(); checks++; console.log('PASS:', name); }
function session({ live = true, circle = 'tap', billing = 'monthly', kit = false, offer = 'standard' } = {}) {
  const cat = CATALOG[live ? 'live' : 'test'];
  return {
    id: live ? id : id.replace('cs_live_', 'cs_test_'), object: 'checkout.session',
    status: 'complete', payment_status: 'paid', mode: 'subscription', livemode: live,
    currency: 'usd', amount_total: kit ? 10800 : 5900, subscription: 'sub_fixture',
    customer: 'cus_private', customer_details: { email: 'private@example.invalid' },
    client_reference_id: uuid,
    metadata: { dpc_member_id: uuid, dpc_checkout_intent_id: uuid,
      dpc_circle: circle, dpc_billing_interval: billing, dpc_offer_type: offer },
    line_items: { has_more: false, data: [cat[circle + '_' + billing][offer === 'standard' ? 0 : 1], ...(kit ? [cat.kit] : [])]
      .map(price => ({ quantity: 1, price: { id: price, currency: 'usd' } })) },
    invoice: { id: 'in_fixture', object: 'invoice', status: 'paid', livemode: live,
      currency: 'usd', billing_reason: 'subscription_create', subscription: 'sub_fixture', amount_paid: kit ? 10800 : 5900 },
  };
}
const request = (body = { sessionId: id }) => ({ method: 'POST', body,
  headers: { host: 'www.downtownpourcollective.com', origin: 'https://www.downtownpourcollective.com',
    'content-type': 'application/json', 'sec-fetch-site': 'same-origin', 'x-vercel-forwarded-for': '192.0.2.1' } });
function response() {
  return { headers: {}, status(code) { this.code = code; return this; },
    setHeader(k, v) { this.headers[k] = v; }, json(value) { this.body = value; return this; } };
}
const env = { VERCEL_ENV: 'production', STRIPE_SECRET_KEY: 'rk_live_fixture' };
async function invoke({ req = request(), data = session(), environment = env, rateLimit = () => true, retrieve } = {}) {
  const res = response(); let reads = 0;
  await createWelcomeHandler({ env: environment, rateLimit,
    retrieve: retrieve || (async supplied => { reads++; assert.equal(supplied, req.body.sessionId); return data; }) })(req, res);
  return { ...res, reads };
}

await check('all twelve live/test Circle plans and founding offers produce only the public projection', () => {
  for (const live of [true, false]) for (const circle of ['tap', 'cellar', 'reserve']) for (const billing of ['monthly', 'annual']) for (const offer of ['standard', 'founding']) {
    const s = session({ live, circle, billing, offer });
    assert.deepEqual(checkoutSummary(s, s.id, live), { status: 'paid', circle, billingInterval: billing,
      amountPaid: 5900, currency: 'usd', welcomeKit: false, livemode: live });
  }
});
await check('actual paid invoice includes kit and differs from catalog/Checkout totals after adjustments', () => {
  const s = session({ kit: true }); s.amount_total = 10800; s.invoice.amount_paid = 9850;
  assert.equal(checkoutSummary(s, id, true).amountPaid, 9850);
  assert.equal(checkoutSummary(s, id, true).welcomeKit, true);
});
await check('the verifier rejects unrelated, unbound, wrong-mode and malformed Stripe objects', () => {
  const mutations = [
    s => s.id = 'cs_live_wrong', s => s.object = 'payment_intent', s => s.mode = 'payment',
    s => s.livemode = false, s => s.currency = 'eur', s => s.client_reference_id = 'other',
    s => delete s.metadata, s => s.metadata.dpc_circle = 'other', s => s.metadata.dpc_billing_interval = 'weekly',
    s => s.metadata.dpc_offer_type = 'operator', s => s.metadata.dpc_member_id = 'cus_private',
    s => s.metadata.dpc_checkout_intent_id = 'not-an-intent',
    s => s.line_items.has_more = true, s => s.line_items.data = [],
    s => s.line_items.data[0].price.id = 'price_other', s => s.line_items.data[0].price.currency = 'eur',
    s => s.line_items.data[0].quantity = 2,
    s => s.line_items.data.push(s.line_items.data[0]),
    s => s.line_items.data.push({ quantity: 1, price: { id: catalog.reserve_annual[0], currency: 'usd' } }),
    s => s.invoice = 'in_not_expanded', s => s.invoice.object = 'other', s => s.invoice.livemode = false,
    s => s.invoice.status = 'open', s => s.invoice.currency = 'eur', s => s.invoice.billing_reason = 'subscription_cycle',
    s => s.invoice.subscription = 'sub_other', s => s.subscription = null,
    s => s.invoice.amount_paid = -1, s => s.invoice.amount_paid = 1.2, s => s.invoice.amount_paid = '5900',
    s => s.invoice.amount_paid = 100000000,
  ];
  for (const mutate of mutations) { const s = session(); mutate(s); assert.equal(checkoutSummary(s, id, true), null, String(mutate)); }
});
await check('open, unpaid and no-payment-required sessions never produce a Purchase summary', () => {
  for (const [status, payment_status] of [['open', 'unpaid'], ['expired', 'unpaid'], ['complete', 'unpaid'], ['complete', 'no_payment_required']]) {
    const s = session(); Object.assign(s, { status, payment_status });
    assert.deepEqual(checkoutSummary(s, id, true), { status: 'pending' });
  }
});
await check('endpoint returns no PII, IDs or raw Stripe data and forbids caches', async () => {
  const r = await invoke(); assert.equal(r.code, 200);
  assert.equal(r.headers['Cache-Control'], 'private, no-store');
  assert.equal(r.headers['Vercel-CDN-Cache-Control'], 'no-store');
  assert.doesNotMatch(JSON.stringify(r.body), /private|customer|metadata|cs_live|sub_|in_fixture|01020304/);
});
await check('method, origin, content type and strict body reject before Stripe access', async () => {
  const requests = [
    { ...request(), method: 'GET' }, { ...request(), headers: {} },
    ...[{}, { sessionId: [id] }, { sessionId: id, amount: 100 }, { sessionId: id + '@private' }, { sessionId: 'cs_live_short' }, '{'].map(request),
    ...[{ origin: 'https://attacker.invalid' }, { 'sec-fetch-site': 'cross-site' }, { 'content-type': 'text/plain' }].map(headers => ({ ...request(), headers: { ...request().headers, ...headers } })),
  ];
  for (const req of requests) { const r = await invoke({ req }); assert.ok(r.code >= 400); assert.equal(r.reads, 0); }
});
await check('deployment/key/session modes fail closed and previews require test keys', async () => {
  for (const environment of [{}, { ...env, STRIPE_SECRET_KEY: 'sk_test_fixture' }, { ...env, VERCEL_ENV: 'preview' }]) {
    const r = await invoke({ environment }); assert.equal(r.code, 503); assert.equal(r.reads, 0);
  }
  const s = session({ live: false });
  const good = await invoke({ environment: { VERCEL_ENV: 'preview', STRIPE_SECRET_KEY: 'rk_test_fixture' }, req: request({ sessionId: s.id }), data: s });
  assert.equal(good.code, 200); assert.equal(good.body.livemode, false);
  assert.equal((await invoke({ req: request({ sessionId: s.id }) })).code, 404);
});
await check('rate limiting avoids provider calls and provider errors expose no sensitive messages', async () => {
  const limited = await invoke({ rateLimit: () => false });
  assert.equal(limited.code, 429); assert.equal(limited.reads, 0); assert.equal(limited.headers['Retry-After'], '60');
  for (const code of ['resource_missing', 'api_connection_error']) {
    const r = await invoke({ retrieve: async () => { throw Object.assign(new Error('secret private customer'), { code }); } });
    assert.equal(r.code, code === 'resource_missing' ? 404 : 503);
    assert.deepEqual(r.body, { status: 'unavailable' });
  }
});
await check('real Stripe SDK uses only GET with expanded line items and invoice, pinned schema and no retry', async () => {
  const original = https.request; const seen = [];
  https.request = options => {
    seen.push(options);
    const req = new PassThrough(); req.setTimeout = () => req; req.abort = () => {};
    process.nextTick(() => {
      const res = new PassThrough(); res.statusCode = 200; res.headers = { 'content-type': 'application/json' };
      req.emit('response', res); res.end(JSON.stringify(session()));
    });
    return req;
  };
  try {
    const res = response(); await createWelcomeHandler({ env, rateLimit: () => true })(request(), res);
    assert.equal(res.code, 200); assert.equal(seen.length, 1);
    assert.equal(seen[0].method, 'GET'); assert.equal(seen[0].host, 'api.stripe.com');
    assert.ok(seen[0].path.startsWith('/v1/checkout/sessions/' + id + '?'));
    assert.match(decodeURIComponent(seen[0].path), /expand\[0\]=line_items/);
    assert.match(decodeURIComponent(seen[0].path), /expand\[1\]=invoice/);
    assert.equal(seen[0].headers['Stripe-Version'], '2024-06-20');
  } finally { https.request = original; }
});
console.log(`Welcome checkout: ${checks} groups passed.`);
