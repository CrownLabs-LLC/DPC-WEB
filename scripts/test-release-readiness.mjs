import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [join, support, deploy, serve, analytics, trackApi, dashboard, dashboardApi, setupSql, migrationSql, ...linkedPages] = await Promise.all([
  read('join.html'),
  read('support.html'),
  read('DEPLOY.md'),
  read('serve.json'),
  read('assets/analytics.js'),
  read('api/track.js'),
  read('dashboard.html'),
  read('api/dashboard-data.js'),
  read('db/setup.sql'),
  read('db/20260730_join_error_observability.sql'),
  ...['index.html', 'join.html', 'partners.html', 'privacy.html', 'terms.html'].map(read),
]);
const home = linkedPages[0];

assert.match(home, /Join The Collective/);
assert.match(home, /one-time \$49 Founding Slot Deposit/);
assert.doesNotMatch(home, /Pause feature|add (?:another|more) anytime|Welcome Kit fee|A \$50 value|THE COASTER PASSPORT|THE INTRODUCTION/);
assert.match(join, /one-time \$49 FOUNDING SLOT DEPOSIT/i);
assert.doesNotMatch(join, /add more anytime|Welcome Kit fee|ONE-TIME \$49 WELCOME KIT/);

assert.match(join, /TURNSTILE_MAX_LOAD_ATTEMPTS = 50/);
assert.match(join, /error_code: 'turnstile_unavailable'/);
assert.match(join, /error_code: 'turnstile_incomplete'/);
assert.match(join, /'error-callback': showTurnstileUnavailable/);
assert.match(join, /id="turnstile-retry"/);
assert.match(join, /turnstileLoadAttempts = 0/);
assert.match(join, /renderTurnstile\(\)/);
assert.match(join, /id="turnstile-api-script"/);
assert.match(join, /function reloadTurnstileScript\(\)/);
assert.match(join, /document\.createElement\('script'\)/);
assert.match(join, /existing\.remove\(\)/);
assert.match(join, /TURNSTILE_SCRIPT_SRC \+ '&retry=' \+ Date\.now\(\)/);
assert.match(join, /script\.onerror = function \(\) \{ complete\(showTurnstileUnavailable\); \}/);
assert.match(join, /TURNSTILE_MAX_LOAD_ATTEMPTS \* 200/);
assert.match(join, /<p role="status"[^>]*>Loading security check…<\/p>/);

const configScript = join.match(
  /function dpcTurnstileSiteKeyForHost[\s\S]*?window\.DPC_JOIN = \{[\s\S]*?\n\};/,
)?.[0];
assert.ok(configScript, 'join config script must remain executable in isolation');
function configFor(hostname) {
  const context = { window: { location: { hostname } }, Date };
  vm.runInNewContext(configScript, context);
  return context.window.DPC_JOIN;
}
const testKey = '1x00000000000000000000AA';
assert.equal(configFor('www.downtownpourcollective.com').turnstileSiteKey, '0x4AAAAAAECO2A5oKsePqsOg');
assert.equal(configFor('downtownpourcollective.com').turnstileSiteKey, '0x4AAAAAAECO2A5oKsePqsOg');
assert.equal(configFor('dpc-preview.vercel.app').turnstileSiteKey, testKey);
assert.equal(configFor('127.0.0.1').turnstileSiteKey, testKey);
assert.notEqual(configFor('www.downtownpourcollective.com').turnstileSiteKey, testKey);

const rewrites = JSON.parse(serve).rewrites;
assert.ok(rewrites.some(({ source, destination }) => (
  source === '/support' && destination === '/support.html'
)));

assert.match(support, /role="group" aria-label="Support topics"/);
assert.match(support, /2601 Horseshoe Ct, Livermore, California 94551/);
assert.doesNotMatch(support, /<nav class="legal"[^>]*>[\s\S]*?<span>&copy;/);
for (const page of linkedPages) assert.match(page, /href="\/support"/);

assert.match(deploy, /Cloudflare Turnstile — membership checkout/);
assert.match(deploy, /TURNSTILE_SECRET_KEY/);
assert.match(deploy, /\/support/);
assert.match(deploy, /Join-error observability deployment order/);
assert.match(deploy, /Do not\s+deploy the matching web change until both checks pass/);

assert.match(analytics, /sendEvent\('join_error', params\)/);
assert.match(analytics, /error_code:/);
assert.match(analytics, /http_status:/);
assert.match(trackApi, /if \(event === 'join_error'\)/);
assert.match(trackApi, /ALLOWED_ERROR_CODES\.has\(s\) \? s : 'unknown'/);
assert.match(dashboardApi, /join_error_codes/);
assert.match(dashboardApi, /Object\.create\(null\)/);
assert.match(dashboardApi, /event=in\.\(page_view,deposit_click,deposit_confirmed\)/);
assert.match(dashboardApi, /event=eq\.join_error/);
assert.match(dashboard, /Join errors/);
assert.match(dashboard, /Funnel data reached its query limit; counts are incomplete/);
assert.match(dashboard, /CHECKOUT_NOT_ENABLED|join_error_codes/);

function setValues(source, name) {
  const body = source.match(new RegExp(`const ${name} = new Set\\(\\[([\\s\\S]*?)\\]\\);`))?.[1];
  assert.ok(body, `${name} must remain a literal Set`);
  return [...body.matchAll(/'([^']+)'/g)].map((match) => match[1]).sort();
}
assert.deepEqual(
  setValues(trackApi, 'ALLOWED_ERROR_CODES'),
  setValues(dashboardApi, 'JOIN_ERROR_CODES'),
  'track and dashboard error-code allowlists must stay aligned'
);

for (const sql of [setupSql, migrationSql]) {
  assert.match(sql, /add column if not exists error_code text/);
  assert.match(sql, /add column if not exists http_status integer/);
  assert.match(sql, /'join_submit'/);
  assert.match(sql, /'join_checkout_redirect'/);
  assert.match(sql, /'join_error'/);
  assert.match(sql, /'membership_checkout_complete'/);
  assert.match(sql, /'membership_checkout_cancelled'/);
  assert.match(sql, /site_events_error_code_check/);
  assert.match(sql, /error_code is null or error_code ~ '\^\[A-Za-z0-9_.:-\]\{1,100\}\$'/);
  assert.match(sql, /site_events_http_status_check/);
}

console.log('Release-readiness static checks passed.');
