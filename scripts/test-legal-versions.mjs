#!/usr/bin/env node
/**
 * Offline tests for /api/legal-versions — no credentials or network. Supabase
 * is mocked at global fetch.
 * Usage: node scripts/test-legal-versions.mjs   (also part of: npm test)
 */

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
async function fresh() {
  const { default: handler } = await import(`../api/legal-versions.js?v=${++importCount}`);
  return handler;
}

const TUPLE = { tos: '3.0', privacy: '4.2', memberTerms: '3.0', autoRenewalTerms: '3.0' };

// respond: (url, opts) => Response
async function run(req, respond) {
  const calls = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    calls.push({ url: String(url), method: opts?.method, body: opts?.body });
    return respond(String(url), opts);
  };
  const handler = await fresh();
  const { res, out } = mockRes();
  try {
    await handler(req, res);
  } finally {
    globalThis.fetch = origFetch;
  }
  return { out, calls };
}

const ok = () => new Response(JSON.stringify(TUPLE), { status: 200, headers: { 'content-type': 'application/json' } });

/* ---------------- unconfigured ---------------- */

delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
{
  let called = false;
  const { out } = await run({ method: 'GET', query: {} }, () => { called = true; return ok(); });
  check('unconfigured -> 503, no tuple, nothing fetched',
    out.status === 503 && !out.body?.tos && !called, out);
  check('unconfigured -> no-store', out.headers['Cache-Control'] === 'no-store', out.headers);
}

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service_role_test_key';

/* ---------------- item 6: success ---------------- */
{
  const { out, calls } = await run({ method: 'GET', query: {} }, ok);
  check('success -> 200 with the RPC tuple',
    out.status === 200 && JSON.stringify(out.body) === JSON.stringify(TUPLE), out);
  check('calls the RPC, not a table select',
    calls[0]?.url === 'https://example.supabase.co/rest/v1/rpc/current_checkout_legal_versions'
    && calls[0]?.method === 'POST', calls);
}

/* ---------------- item 7: fails closed on RPC error ---------------- */
for (const [label, response] of [
  ['permission denied (grant regression)', new Response(JSON.stringify({ message: 'permission denied for function current_checkout_legal_versions' }), { status: 403 })],
  ['legal_currentness_unavailable (missing singleton)', new Response(JSON.stringify({ code: 'P0001', message: 'legal_currentness_unavailable' }), { status: 400 })],
  ['function not found', new Response(JSON.stringify({ message: 'Could not find the function' }), { status: 404 })],
  ['supabase 500', new Response('boom', { status: 500 })],
]) {
  const { out } = await run({ method: 'GET', query: {} }, () => response);
  check(`fails closed on ${label} -> 503, no tuple`,
    out.status === 503 && out.body?.tos === undefined, out);
  check(`fails closed on ${label} -> no-store`,
    out.headers['Cache-Control'] === 'no-store', out.headers);
}
{
  const { out } = await run({ method: 'GET', query: {} }, () => { throw new Error('network down'); });
  check('fails closed on network error -> 503 no-store',
    out.status === 503 && out.headers['Cache-Control'] === 'no-store', out);
}

/* ---------------- item 8: incomplete success is its own failure ---------------- */
for (const [label, body] of [
  ['missing a key', { tos: '3.0', privacy: '4.2', memberTerms: '3.0' }],
  ['a non-string version', { ...TUPLE, privacy: 4.2 }],
  ['an empty version', { ...TUPLE, autoRenewalTerms: '' }],
  ['null', null],
  ['an array', []],
]) {
  const { out } = await run({ method: 'GET', query: {} },
    () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
  check(`structurally incomplete 200 (${label}) -> 503 no-store`,
    out.status === 503 && out.headers['Cache-Control'] === 'no-store' && out.body?.tos === undefined, out);
}

/* ---------------- item 9: the cache header, precisely ---------------- */
{
  const { out } = await run({ method: 'GET', query: {} }, ok);
  const cc = out.headers['Cache-Control'];
  // Assert s-maxage specifically: a regression to a bare max-age would still
  // look like a cache header while silently disabling the whole mitigation —
  // Vercel caches a Function response only when s-maxage is present.
  check('success sets s-maxage=10', /(^|,\s*)s-maxage=10(\s*,|$)/.test(cc || ''), cc);
  check('success sets stale-while-revalidate=50', /stale-while-revalidate=50/.test(cc || ''), cc);
  check('success sets max-age=0 (browser revalidates)', /(^|,\s*)max-age=0(\s*,|$)/.test(cc || ''), cc);
  check('success is public', /(^|,\s*)public(\s*,|$)/.test(cc || ''), cc);
}

/* ---------------- item 11: ?fresh=1 bypasses the cache ---------------- */
{
  const { out, calls } = await run({ method: 'GET', query: { fresh: '1' } }, ok);
  check('?fresh=1 -> 200 no-store', out.status === 200 && out.headers['Cache-Control'] === 'no-store', out);
  check('?fresh=1 still calls the RPC', calls.length === 1, calls);
}
{
  const { out } = await run({ method: 'GET', url: '/api/legal-versions?fresh=1' }, ok);
  check('?fresh=1 detected from req.url when req.query is absent',
    out.headers['Cache-Control'] === 'no-store', out.headers);
}
{
  const { out } = await run({ method: 'GET', url: '/api/legal-versions?fresh=0' }, ok);
  check('fresh=0 is not a bypass', /s-maxage=10/.test(out.headers['Cache-Control'] || ''), out.headers);
}
{
  const { out } = await run({ method: 'GET', query: { fresh: ['1', '0'] } }, ok);
  check('repeated fresh param takes the first value', out.headers['Cache-Control'] === 'no-store', out.headers);
}

/* ---------------- method guard ---------------- */
{
  let called = false;
  const { out } = await run({ method: 'POST', query: {} }, () => { called = true; return ok(); });
  check('POST -> 405, nothing fetched', out.status === 405 && !called, out);
  check('405 is never cached', out.headers['Cache-Control'] === 'no-store', out.headers);
}

if (failures) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll /api/legal-versions checks passed.');
