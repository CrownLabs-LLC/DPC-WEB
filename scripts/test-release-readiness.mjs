import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [join, support, deploy, serve, analytics, trackApi, dashboard, dashboardApi, setupSql, migrationSql, checkoutMigrationSql, playwrightConfig, checkoutWorkflow, ...linkedPages] = await Promise.all([
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
  read('db/20260814_checkout_handoff_observability.sql'),
  read('playwright.config.mjs'),
  read('.github/workflows/checkout-navigation.yml'),
  ...['index.html', 'join.html', 'partners.html', 'privacy.html', 'terms.html'].map(read),
]);
const home = linkedPages[0];
const privacy = linkedPages[3];
const terms = linkedPages[4];
const [success, cancelled, depositorConfirmation] = await Promise.all([
  read('subscription-success.html'),
  read('subscription-cancelled.html'),
  read('depositor-confirmation.html'),
]);

// The launch weekend hosted Pour promotion is retired. Guard the whole concept —
// markup, styles, and every phrasing it shipped with — not just its headline.
const retiredLaunchWeekendPromo =
  /launch[-\s]weekend|personally hosted|hosted Pour|complimentary Pour|Plan My Pour|awaiting store approval|as soon as (?:it is|the member app is) available/i;
for (const [page, markup] of [
  ['index.html', home],
  ['join.html', join],
  ['subscription-success.html', success],
  ['depositor-confirmation.html', depositorConfirmation],
]) {
  assert.doesNotMatch(
    markup,
    retiredLaunchWeekendPromo,
    `${page} still references the retired launch weekend hosted Pour promotion`,
  );
}

assert.match(home, /Join The Collective/);
assert.match(home, /one-time \$49 Founding Slot Deposit/);
assert.match(home, /Already paid a \$49 Founding Slot Deposit/);
assert.match(home, /Wingen Bakery &amp; Restaurant[\s\S]*Coming Soon/);
assert.match(home, /Start with one Circle today/);
assert.doesNotMatch(home, /Pause feature|add (?:another|more) anytime|Welcome Kit fee|A \$50 value|THE COASTER PASSPORT|THE INTRODUCTION/);
assert.doesNotMatch(home, /public launch checkout supports one Circle|between now and launch|Full launch August 1/);
assert.match(join, /one-time \$49 FOUNDING SLOT DEPOSIT/i);
assert.match(join, /Please don’t use this public checkout/);
assert.match(join, /Membership checkout is temporarily unavailable/);
assert.doesNotMatch(join, /add more anytime|Welcome Kit fee|ONE-TIME \$49 WELCOME KIT/);
assert.doesNotMatch(join, /Membership checkout opens August 1/);

assert.match(success, /account-setup and app-download instructions/);
assert.match(cancelled, /remain held for up to 24 hours/);
assert.match(terms, /September 1, 2026 at 12:00 AM Pacific Time/);
assert.match(terms, /will not be charged again/);
assert.match(terms, /Membership Pause is not currently available/);
assert.doesNotMatch(terms, /Welcome Kit and Activation Fee|fourteen \(14\) calendar days|\[INSERT IN APP ROADMAP FOR CANCELLATION\]|Founding Annual memberships/);
assert.match(privacy, /Version 4\.2/);
assert.match(privacy, /Effective Date: August 1, 2026/);
assert.doesNotMatch(privacy, /Effective Date: \[DATE\]/);

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
assert.match(join, /id="checkout-handoff" role="status" hidden/);
assert.match(join, /id="checkout-fallback" hidden>Open Secure Checkout<\/a>/);
assert.match(join, /\.btn\[hidden\],[\s\S]*display: none !important/);
assert.match(join, /checkoutFallback\.href = url/);
assert.match(join, /checkoutFallback\.focus\(\)/);
assert.match(join, /window\.location\.assign\(url\)/);
assert.match(join, /join_checkout_ready/);
assert.match(join, /join_checkout_departed/);
assert.match(join, /join_checkout_fallback_clicked/);
assert.match(join, /join_checkout_stalled/);
assert.match(join, /CHECKOUT_STALL_MS = 8000/);
assert.ok(
  join.indexOf('checkoutFallback.href = url')
    < join.indexOf('window.location.assign(url)'),
  'the native Checkout link must be ready before programmatic navigation'
);

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
assert.deepEqual(
  { ...configFor('www.downtownpourcollective.com').legalVersions },
  {
    tos: '3.0',
    privacy: '4.2',
    memberTerms: '3.0',
    autoRenewalTerms: '3.0',
  },
);

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
assert.match(deploy, /physical iPhone in Safari/);
assert.match(deploy, /physical\s+Android phone in Chrome/);
assert.match(deploy, /20260814_checkout_handoff_observability\.sql/);

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
assert.match(dashboard, /Stalled handoffs/);
assert.match(dashboardApi, /checkout_fallback_clicks/);
assert.match(dashboardApi, /event=in\.\(join_submit,join_checkout_ready,join_checkout_departed,join_checkout_fallback_clicked,join_checkout_stalled\)/);
assert.match(playwrightConfig, /mobile-chromium/);
assert.match(playwrightConfig, /mobile-webkit/);
assert.match(checkoutWorkflow, /npm run test:e2e/);

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

for (const sql of [setupSql, checkoutMigrationSql]) {
  assert.match(sql, /add column if not exists flow_id text/);
  assert.match(sql, /'join_checkout_ready'/);
  assert.match(sql, /'join_checkout_departed'/);
  assert.match(sql, /'join_checkout_fallback_clicked'/);
  assert.match(sql, /'join_checkout_stalled'/);
  assert.match(sql, /site_events_flow_id_check/);
  assert.match(sql, /site_events_flow_ts_idx/);
}

const vercel = JSON.parse(await read('vercel.json'));
assert.ok(vercel.crons.some((cron) => cron.path === '/api/health-check' && cron.schedule === '*/5 * * * *'));

console.log('Release-readiness static checks passed.');
