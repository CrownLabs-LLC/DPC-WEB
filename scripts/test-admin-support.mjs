#!/usr/bin/env node
/**
 * Offline tests for /api/admin-config and the /admin/support dashboard — no
 * credentials or network. The endpoint handler runs directly; the dashboard's
 * admin predicate is lifted out of the page and executed in a VM, and the
 * triage policy rules are asserted statically against the page source.
 * Usage: node scripts/test-admin-support.mjs   (also part of: npm test)
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [page, serve, vercel] = await Promise.all([
  read('admin/support.html'),
  read('serve.json'),
  read('vercel.json'),
]);

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

const jwtWithRole = (role) =>
  `header.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.signature`;

const ANON_JWT = jwtWithRole('anon');
const SERVICE_JWT = jwtWithRole('service_role');

/* ---------------- /api/admin-config ---------------- */

const { default: handler, looksLikeSecretKey, projectRefFrom } = await import('../api/admin-config.js');

const ADMIN_ENV = [
  'ADMIN_SUPABASE_URL', 'ADMIN_SUPABASE_ANON_KEY', 'SUPABASE_URL', 'SUPABASE_ANON_KEY',
];
const resetEnv = () => ADMIN_ENV.forEach((k) => { delete process.env[k]; });

// Case: wrong method -> 405, nothing leaked
resetEnv();
process.env.ADMIN_SUPABASE_URL = 'https://ebiuspbgzggrdiaswpcc.supabase.co';
process.env.ADMIN_SUPABASE_ANON_KEY = ANON_JWT;
{
  const { res, out } = mockRes();
  await handler({ method: 'POST' }, res);
  assert.equal(out.status, 405);
  assert.equal(out.body.configured, false);
  assert.ok(!JSON.stringify(out.body).includes(ANON_JWT), 'non-GET must not return the key');
  assert.equal(out.headers['Cache-Control'], 'no-store');
}

// Case: fully configured -> serves url + anon key + project ref
{
  const { res, out } = mockRes();
  await handler({ method: 'GET' }, res);
  assert.equal(out.status, 200);
  assert.deepEqual(out.body, {
    configured: true,
    supabaseUrl: 'https://ebiuspbgzggrdiaswpcc.supabase.co',
    supabaseAnonKey: ANON_JWT,
    projectRef: 'ebiuspbgzggrdiaswpcc',
  });
  assert.equal(out.headers['Cache-Control'], 'no-store');
}

// Case: trailing slash on the URL is normalized away
{
  process.env.ADMIN_SUPABASE_URL = 'https://ebiuspbgzggrdiaswpcc.supabase.co/';
  const { res, out } = mockRes();
  await handler({ method: 'GET' }, res);
  assert.equal(out.body.supabaseUrl, 'https://ebiuspbgzggrdiaswpcc.supabase.co');
}

// Case: unconfigured -> configured:false, no crash
resetEnv();
{
  const { res, out } = mockRes();
  await handler({ method: 'GET' }, res);
  assert.deepEqual(out.body, { configured: false, reason: 'missing_env' });
}

// Case: falls back to the site-wide Supabase vars when the admin ones are unset
resetEnv();
process.env.SUPABASE_URL = 'https://hohbsqkmrlhkstojfdgx.supabase.co';
process.env.SUPABASE_ANON_KEY = ANON_JWT;
{
  const { res, out } = mockRes();
  await handler({ method: 'GET' }, res);
  assert.equal(out.body.configured, true);
  assert.equal(out.body.projectRef, 'hohbsqkmrlhkstojfdgx');
}

// Case: a service-role key is refused rather than served to the browser —
// including values pasted with surrounding whitespace, which must not evade
// the classifier.
for (const secret of [
  SERVICE_JWT,
  'sb_secret_abc123',
  ` ${SERVICE_JWT} `,
  '\tsb_secret_abc123\n',
]) {
  resetEnv();
  process.env.ADMIN_SUPABASE_URL = 'https://ebiuspbgzggrdiaswpcc.supabase.co';
  process.env.ADMIN_SUPABASE_ANON_KEY = secret;
  const { res, out } = mockRes();
  const origError = console.error;
  console.error = () => {};
  await handler({ method: 'GET' }, res);
  console.error = origError;
  assert.deepEqual(out.body, { configured: false, reason: 'service_role_key_refused' });
  assert.ok(!JSON.stringify(out.body).includes(secret.trim()), 'refused key must not appear in the response');
}
resetEnv();

// Case: a legitimate anon key with surrounding whitespace is still served,
// trimmed, rather than rejected as unconfigured.
{
  process.env.ADMIN_SUPABASE_URL = ' https://ebiuspbgzggrdiaswpcc.supabase.co/ ';
  process.env.ADMIN_SUPABASE_ANON_KEY = ` ${ANON_JWT} `;
  const { res, out } = mockRes();
  await handler({ method: 'GET' }, res);
  assert.equal(out.body.configured, true);
  assert.equal(out.body.supabaseAnonKey, ANON_JWT);
  assert.equal(out.body.supabaseUrl, 'https://ebiuspbgzggrdiaswpcc.supabase.co');
}
resetEnv();

assert.equal(looksLikeSecretKey(ANON_JWT), false);
assert.equal(looksLikeSecretKey('sb_publishable_abc123'), false);
assert.equal(looksLikeSecretKey(''), false);
assert.equal(looksLikeSecretKey('   '), false);
assert.equal(looksLikeSecretKey('not.a.jwt'), false);
assert.equal(looksLikeSecretKey(SERVICE_JWT), true);
assert.equal(looksLikeSecretKey('sb_secret_abc123'), true);
assert.equal(looksLikeSecretKey(` ${SERVICE_JWT} `), true, 'whitespace must not evade the service-role check');
assert.equal(looksLikeSecretKey('\tsb_secret_abc123\n'), true, 'whitespace must not evade the sb_secret_ check');
assert.equal(projectRefFrom('https://abc123.supabase.co'), 'abc123');
assert.equal(projectRefFrom('http://localhost:54321'), null);

/* ---------------- admin predicate (lifted from the page) ---------------- */

const predicate = page.match(/ {2}function isAdmin\(user\) \{[\s\S]*?\n {2}\}/)?.[0];
assert.ok(predicate, 'isAdmin must remain executable in isolation');
const context = { Array };
vm.runInNewContext(predicate, context);
const { isAdmin } = context;

assert.equal(isAdmin({ app_metadata: { role: 'admin' } }), true);
assert.equal(isAdmin({ app_metadata: { roles: ['admin'] } }), true);
assert.equal(isAdmin({ app_metadata: { roles: ['support', 'admin'] } }), true);
assert.equal(isAdmin({ app_metadata: { role: 'member' } }), false);
assert.equal(isAdmin({ app_metadata: { roles: ['member'] } }), false);
assert.equal(isAdmin({ app_metadata: { roles: 'admin' } }), false, 'a string roles claim is not an admin grant');
assert.equal(isAdmin({ app_metadata: {} }), false);
assert.equal(isAdmin({}), false);
assert.equal(isAdmin(null), false);

/* ---------------- page assertions ----------------
 * assert.match/doesNotMatch would dump the whole page on failure, so these go
 * through helpers that report just the pattern and why it matters. */

const pageHas = (re, why) => assert.ok(re.test(page), `admin/support.html should match ${re} — ${why}`);
const pageLacks = (re, why) => assert.ok(!re.test(page), `admin/support.html should not match ${re} — ${why}`);

/* ---------------- secrets never reach the page ---------------- */

pageLacks(/SUPABASE_SERVICE_ROLE_KEY|serviceRoleKey/, 'the browser must never see the service-role key');
pageLacks(/eyJ[A-Za-z0-9_-]{20,}/, 'no hardcoded JWT or anon key belongs in the page');
pageHas(/fetch\('\/api\/admin-config'/, 'config must come from the endpoint, not be hardcoded');

/* ---------------- triage policy invariants ---------------- */

pageHas(
  /var STATUS_CHOICES = \['open', 'in_progress', 'closed'\];/,
  "the status dropdown must not offer 'resolved' — resolving also stamps a timestamp",
);
pageHas(
  /submit\(\{ status: 'resolved', resolvedAt: new Date\(\)\.toISOString\(\) \}\)/,
  'Resolve must set status and resolvedAt in one explicit action',
);
pageHas(
  /firstResp\.disabled = state\.busy \|\| Boolean\(t\.first_response_at\)/,
  'first response is a one-time event; a second click would overwrite it',
);
pageHas(
  /resolve\.disabled = state\.busy \|\| t\.status === 'resolved' \|\| t\.status === 'closed'/,
  'Resolve gates on status, not resolvedAt, so a reopened ticket stays resolvable',
);
pageLacks(/resolvedAt: null/, 'reopening must preserve resolvedAt as historical evidence');
pageHas(
  /escalatedTo: to, escalatedAt: new Date\(\)\.toISOString\(\)/,
  'escalation must set both fields in the same request',
);
pageHas(
  /escalatedTo: null, escalatedAt: null/,
  'clearing escalation must null both fields in the same request',
);

/* ---------------- pagination and filtering honesty ---------------- */

pageHas(
  /state\.filters\[key\] = \$\('f-' \+ key\)\.value;[\s\S]{0,240}?state\.ticketOffset = 0;/,
  'a filter change must reset the offset, or page 3 of a different result set shows',
);
pageHas(/state\.ticketOffset/, 'tickets need their own offset');
pageHas(/state\.feedbackOffset/, 'feedback needs its own offset — one request cannot page both');
pageHas(
  /state\.ticketsFull = rows\.length === state\.limit/,
  'next-page availability is inferred from a full page; the API returns no total',
);
pageHas(/state\.feedbackFull = rows\.length === state\.limit/, 'same inference for feedback');
pageHas(/Filters this page only/, 'the feedback filter must not imply it searches the whole table');

/* ---------------- session / race guards ---------------- */

pageHas(/var sessionGeneration = 0/, 'sign-out needs a generation counter so in-flight refresh cannot resurrect the session');
pageHas(/function invalidateSessionWork\(\)/, 'sign-out must invalidate pending refresh work');
pageHas(/invalidateSessionWork\(\);\s*\n\s*clearSession\(\)/, 'sign-out bumps generation before clearing storage');
pageHas(
  /if \(generation !== sessionGeneration\) throw authError\('signed_out'\)/,
  'a refresh that finishes after sign-out must refuse to write credentials back',
);
pageHas(
  /function saveSession\(next, expectedGeneration\)/,
  'saveSession must accept a generation so stale writers are rejected',
);
pageHas(
  /return \{ tickets: \(data && data\.tickets\) \|\| \[\] \}/,
  'ticket loader must return data without mutating shared state',
);
pageHas(
  /return \{ feedback: \(data && data\.feedbackSubmissions\) \|\| \[\] \}/,
  'feedback loader must return data without mutating shared state',
);
pageHas(
  /if \(seq !== state\[seqKey\]\) return;\s*\n\s*if \(tab === 'tickets'\) commitTickets/,
  'commit must happen only after the sequence check so older requests cannot overwrite newer filters',
);
pageHas(
  /if \(state\.tab !== tab\) return;/,
  'an inactive tab\'s failure must not clobber the visible tab',
);
pageHas(
  /function renderLoadError\(err, tab\)/,
  'load errors must target the originating tab, not whatever is currently selected',
);
pageHas(
  /var box = tab === 'tickets' \? \$\('tickets-body'\) : \$\('feedback-body'\)/,
  'error rendering must use the captured tab, not state.tab',
);
pageHas(/ticketSeq: 0/, 'tickets need their own request sequence');
pageHas(/feedbackSeq: 0/, 'feedback needs its own request sequence');
pageHas(
  /var seq = \+\+state\.ticketSeq;[\s\S]{0,200}?loadTickets\(\)/,
  'post-triage ticket refresh must bump ticketSeq only — never the feedback sequence',
);
pageHas(
  /first_response_already_set/,
  'UI must handle the atomic first-response conflict from the triage RPC',
);
pageHas(
  /apiCode === 'first_response_already_set'[\s\S]{0,800}?handleAuthFailure\(refreshErr\)/,
  'conflict recovery must not swallow 401/403 from the refetch',
);
pageHas(
  /First response was already recorded, but the ticket could not be refreshed/,
  'a failed conflict refetch must replace the pending "refreshing" message',
);

/* ---------------- auth states stay distinct ---------------- */

pageHas(/if \(resp\.status === 401\) throw authError\('expired'\)/, '401 is a token problem');
pageHas(/if \(resp\.status === 403\) throw authError\('forbidden'\)/, '403 is a role problem');
pageHas(/id="view-notadmin"/, '403 needs its own screen');
pageHas(/id="view-expired"/, 'an expired session needs its own screen');

/* ---------------- Edge Function contract ---------------- */

pageHas(/'admin-support-queue'/, 'the queue function is the only sanctioned read path');
pageHas(/'admin-support-triage'/, 'the triage function is the only sanctioned write path');
pageHas(/apikey: cfg\.supabaseAnonKey/, 'every function call needs the apikey header');
pageHas(/Authorization: 'Bearer ' \+ accessToken/, 'every function call needs the session token');
pageLacks(/\/rest\/v1\//, 'RLS gives an admin zero rows on a direct table read — never query tables directly');

/* ---------------- routing ---------------- */

assert.ok(
  JSON.parse(serve).rewrites.some(({ source, destination }) => (
    source === '/admin/support' && destination === '/admin/support.html'
  )),
  'serve.json must rewrite /admin/support for local preview',
);

const adminHeaders = JSON.parse(vercel).headers.find((h) => h.source === '/admin/(.*)');
assert.ok(adminHeaders, 'vercel.json must set headers for /admin/*');
assert.ok(adminHeaders.headers.some((h) => h.key === 'X-Robots-Tag' && /noindex/.test(h.value)));
assert.ok(adminHeaders.headers.some((h) => h.key === 'Cache-Control' && h.value === 'no-store'));

console.log('Admin support dashboard checks passed.');
