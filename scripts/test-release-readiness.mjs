import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [join, support, deploy, packageSource, serve, analytics, trackApi, dashboard, dashboardApi, setupSql, migrationSql, checkoutMigrationSql, playwrightConfig, checkoutWorkflow, ...linkedPages] = await Promise.all([
  read('join.html'),
  read('support.html'),
  read('DEPLOY.md'),
  read('package.json'),
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
const partners = linkedPages[2];
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
// The $49 Founding Slot Deposit is not sold to new members after the window
// closed, and join.html already stops disclosing it on the standard offer. The
// homepage must not advertise a charge the checkout no longer discloses.
assert.doesNotMatch(home, /Founding Slot Deposit/);
// The deposit-holder notice is a /join footnote, not homepage hero copy: it told
// every cold visitor not to buy, citing a charge they had never heard of, above
// the fold. Guard the removal so it cannot drift back onto the homepage.
assert.doesNotMatch(home, /Already paid a \$49 Founding Slot Deposit/);
// The Pour mechanic. Member venue selection is DISABLED on all three Circles in
// production (circle_venue_selection_policies.selection_enabled = false), so the
// system assigns all five venues and nobody picks anything. Any copy offering the
// member a choice of spots puts the page in conflict with the app.
assert.match(home, /at spots we pick for you/);
// The entitlement is five Pours. The old line also hard-promised five distinct
// spots, which was already wrong at eight partners and is wronger at ten, so the
// count comes off while the assignment mechanic stays.
assert.doesNotMatch(home, /one at each of five spots|five of downtown Livermore's best/);
// The hero headline carries no venue count. Eight partners today, more later;
// a hard number there reads as the size of the whole roster.
assert.match(home, /<h1 class="hero__headline">Five drinks a month at downtown Livermore's best spots\.<\/h1>/);
assert.doesNotMatch(home, /five of downtown Livermore/);
// No dashes in visible copy. The body font renders a double hyphen as a dash
// glyph, so `--` is caught here too, not just the em and en dash characters.
for (const [page, markup] of [['index.html', home], ['join.html', join]]) {
  const visible = markup.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)[\s\S]*?<\/\1>/g, '');
  assert.doesNotMatch(visible, /\u2014|\u2013|\s--\s/, `${page} still has a dash in visible copy`);
}
assert.doesNotMatch(
  home,
  /two you pick yourself|two you choose yourself|spots we assign from this roster|three spots we (?:pick|assign)|one at each of your five spots|five venues assigned|land at five venues/,
  'homepage promises member venue selection, which is disabled in production',
);
// Wingen is an active partner, not a pending one.
assert.doesNotMatch(home, /Coming Soon/);
// Annual memberships are prepaid for twelve months, so a blanket "cancel
// anytime" on a page that sells one can imply a prorated refund we do not
// offer. The membership stops renewing; it is not refunded mid-term.
for (const [page, markup] of [['index.html', home], ['join.html', join]]) {
  assert.doesNotMatch(
    markup.replace(/<!--[\s\S]*?-->/g, ''),
    /cancel anytime/i,
    `${page} says "cancel anytime", which implies a prorated annual refund`,
  );
}
assert.match(home, /Start with one Circle today/);
assert.doesNotMatch(home, /Pause feature|add (?:another|more) anytime|Welcome Kit fee|A \$50 value|THE INTRODUCTION/);
// The Coaster Passport section is on the page; its CSS sat orphaned from
// 2026-08-13 until it was reinstated. Guard the markup, not just the styles.
assert.match(home, /THE COASTER PASSPORT/);
assert.match(home, /data-screen-label="05 Coaster Passport"/);
assert.doesNotMatch(home, /public launch checkout supports one Circle|between now and launch|Full launch August 1/);
// Standard members pay membership only. The founding branch stays in the price
// table as dead-but-documented history, so this checks the fine print the page
// actually renders rather than the whole file.
const joinFineprint = join.match(/<p class="fine" id="offer-fineprint">([\s\S]*?)<\/p>/);
assert.ok(joinFineprint, 'join.html must keep the offer fine print element');
assert.doesNotMatch(joinFineprint[1], /FOUNDING SLOT DEPOSIT/i);
// The standard annual prices were null from the day the window closed, so the
// annual option (which is checked by default) rendered "$— / year" in the order
// summary. Display only: the server created annual standard sessions at the
// correct price throughout. Guard every Circle against that regression.
const standardPrices = join.match(/standard: \{([\s\S]*?)\}\s*\}/);
assert.ok(standardPrices, 'join.html must keep the standard price table');
assert.doesNotMatch(
  standardPrices[1],
  /annual:\s*null/,
  'standard annual prices must be set, or /join renders an unpriced annual option',
);
for (const [circle, monthly, annual] of [['tap', 59, 590], ['cellar', 69, 690], ['reserve', 79, 790]]) {
  assert.match(
    standardPrices[1],
    new RegExp(`${circle}:\\s*\\{\\s*monthly:\\s*${monthly},\\s*annual:\\s*${annual}\\b`),
    `standard ${circle} pricing must be $${monthly}/mo and $${annual}/yr`,
  );
}
// Case-insensitive: the instruction now follows the founding-window clause, so
// "please" sits mid-sentence. What matters is that the instruction is present.
assert.match(join, /please don’t use this public checkout/i);
assert.match(join, /Membership checkout is temporarily unavailable/);
// From #44: the server-side founding cutoff returns FOUNDING_OFFER_ENDED, which
// must reach the visitor as an explanation rather than an unknown-error fallback.
assert.match(
  join,
  /FOUNDING_OFFER_ENDED:\s*'Founding enrollment has ended\. Check your device date and time, then refresh to continue with standard membership, or email hello@downtownpourcollective\.com for help\.'/,
  'join.html must explain the server-side founding cutoff instead of exposing an unknown error',
);
// #44 also added a standard-price loop here. It is not repeated: this branch
// already carries the same loop plus an explicit annual:null guard further down,
// and a second `const standardPrices` in module scope is a SyntaxError.

// Retired launch-era phrasings. "ONE-TIME $49 WELCOME KIT" stays blocked: the
// live charge is the Member Welcome Kit, and the approved label carries
// "MEMBER", so the older bare wording is still a regression. "fee" likewise is
// not the approved noun; it is a charge.
assert.doesNotMatch(join, /add more anytime|Welcome Kit fee|ONE-TIME \$49 WELCOME KIT/);

// The Member Welcome Kit is a real one-time $49 line on standard checkout, so
// it has to be disclosed before payment, in the approved words. It is NOT the
// Founding Slot Deposit (a different, retired product), and it is NOT optional
// or a future add-on. Guard the disclosure, the naming, and the framing.
for (const [page, markup] of [['index.html', home], ['join.html', join]]) {
  assert.match(
    markup,
    /one-time \$49 Member Welcome Kit charge/i,
    `${page} must disclose the one-time $49 Member Welcome Kit charge`,
  );
  assert.doesNotMatch(
    markup,
    /Member Welcome Kit[^.]{0,60}(?:optional|add-on|add on|coming soon|later this year)/i,
    `${page} frames the Member Welcome Kit as optional or deferred; it is neither`,
  );
  assert.doesNotMatch(
    markup,
    /Member Welcome Kit[^.]{0,40}Founding Slot Deposit|Founding Slot Deposit[^.]{0,40}Member Welcome Kit/i,
    `${page} conflates the Member Welcome Kit with the Founding Slot Deposit`,
  );
}
// The charge is per account, not per membership term or per Circle.
assert.match(join, /charged once per member account/i);
// The once-per-account note is Welcome Kit wording. If it is appended outside
// the standard branch, the founding summary names a Founding Slot Deposit and
// then explains the Welcome Kit. Dead code post-cutoff, still wrong.
assert.match(
  join,
  /var oneTimeNote = isFounding\s*\n\s*\? ''/,
  'the once-per-account note must be scoped to the Welcome Kit branch',
);
// Events are separately coordinated, not membership entitlements. They may be
// described; they may not be sold as included or promised as invitations.
assert.doesNotMatch(home, /MEMBER EVENTS INCLUDED/i);
assert.doesNotMatch(
  home,
  /invitation to every member event|Your invitations arrive by email|Members are also invited to/i,
  'homepage sells separately coordinated events as a membership entitlement',
);
// The depositor footnote sits on a page that now also discloses a $49 Member
// Welcome Kit charge. Without the founding-window qualifier a reader meets two
// different $49 charges with nothing separating them.
assert.match(join, /If you paid a \$49 Founding Slot Deposit during the founding window/);

// Five Pours is the promise, not a ceiling. "Up to five" and supply caveats
// qualify it, and the structured data is what search and the assistants quote.
for (const [page, markup] of [['index.html', home], ['join.html', join]]) {
  assert.doesNotMatch(
    markup,
    /up to (?:five|5) Pours|when eligible venue supply allows|Five is the norm/i,
    `${page} qualifies the five Pour promise`,
  );
}
assert.doesNotMatch(join, /Membership checkout opens August 1/);
// Launch-day framing goes stale the moment the founding window closes, and the
// roster is eight spots, not five. Guard both the page copy and the JSON-LD,
// which is what Google and the AI assistants actually quote.
assert.doesNotMatch(join, /Subscriptions opened August 1\./);
assert.doesNotMatch(home, /five participating spots/);
// No member/founding-number field exists in the schema, and the member-number
// work is deferred, so the site must not promise one.
assert.doesNotMatch(home, /founding number/i);

// STANDING POLICY: the size of the membership is never published. Not the
// active count, not a remaining-spots figure, not "join N others". This is a
// permanent business rule, not a founding-window artifact, so it is enforced
// across every public page rather than left to whoever writes the next draft.
// A low number reads as low demand and a high one invites a claim we then have
// to keep accurate forever; either way the count is an internal figure.
// The digit patterns exclude a decimal-prefixed match so numbered legal clauses
// ("20.2 Members are granted...") do not trip them.
const MEMBER_COUNT_DISCLOSURE = [
  /(?<![\d.])\d{1,5}\s+(?:active\s+)?members\b/i,
  /(?<![\d.])\d{1,5}\s+(?:active\s+)?memberships\b/i,
  /(?:first|only|just)\s+(?:\d{1,5}|one|two|three|four|five|ten|twenty|fifty|one hundred|two hundred)\s+members(?:hips)?\b/i,
  /\bjoin\s+(?:\d{1,5}|hundreds|dozens)\s+of\s+(?:your\s+)?(?:neighbors|locals|members|others)\b/i,
  /(?<![\d.])\d{1,5}\s+(?:people|locals|neighbors)\s+(?:have\s+)?(?:already\s+)?joined\b/i,
  /\b(?:only|just)\s+(?:\d{1,5}|a few)\s+(?:spots?|memberships?|slots?)\s+(?:left|remain|remaining)\b/i,
  /\bmember(?:ship)?\s+count\b/i,
  /\bwe\s+(?:now\s+)?have\s+(?:\d{1,5}|hundreds|dozens)\s+members\b/i,
];
for (const [page, markup] of [
  ['index.html', home],
  ['join.html', join],
  ['partners.html', partners],
  ['terms.html', terms],
  ['privacy.html', privacy],
  ['support.html', support],
]) {
  const visible = markup.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)[\s\S]*?<\/\1>/g, '');
  for (const pattern of MEMBER_COUNT_DISCLOSURE) {
    assert.doesNotMatch(
      visible,
      pattern,
      `${page} discloses the size of the membership, which is never published`,
    );
  }
}
// The deadline and the Kickoff Party belong above the headline, not below the
// CTA where they fell past the fold on both desktop and mobile.
assert.match(home, /class="hero__strip"/);
assert.ok(
  home.indexOf('hero__strip') < home.indexOf('hero__headline'),
  'the hero deadline strip must precede the headline',
);
// Founding urgency is retired rather than inverted: no countdown, no loss
// framing, and no selling of benefits that only the founding class holds.
// Founding Member status itself stays permanent for those who earned it, so
// this guards the sales copy, not the status.
assert.doesNotMatch(
  home,
  /Founding 200|founding class|founding pricing|Founding Member status|August 31|through August|locked[- ]in pricing|price protection|rate is locked/i,
  'homepage still sells the closed founding window',
);
// September 15 is the founding class's invitation-only night, so it cannot sit
// in the join path as an incentive a new standard member would never receive.
assert.doesNotMatch(home, /Kickoff Party|September 15/);
// Standard pricing, and the annual figures that carry the "two months free"
// arithmetic. $59 x 10 = $590, and so on for the other two Circles.
for (const price of ['$590 / year', '$59 / month', '$690 / year', '$69 / month', '$790 / year', '$79 / month']) {
  assert.ok(home.includes(price), `homepage is missing standard price ${price}`);
}
assert.doesNotMatch(home, /\$5(?:5|50) \/|\$6(?:5|50) \/|\$7(?:5|50) \//);
for (const [page, markup] of [
  ['join.html', join],
  ['depositor-confirmation.html', depositorConfirmation],
]) {
  for (const [mechanism, pattern] of [
    ['hidden company field', /<(?:input|label)\b[^>]*(?:id|name|for)=["']company["']/i],
    ['.hp mechanism', /(?:^|[\s,{])\.hp\b|class=["'][^"']*\bhp\b/i],
    ['form company guard', /form\s*(?:\.\s*company|\[\s*["']company["']\s*\])/i],
    ['incident error message', /Something went wrong\. Please try again\./],
  ]) {
    assert.doesNotMatch(
      markup,
      pattern,
      `${page} must not restore the password-manager-triggered ${mechanism}`,
    );
  }
}

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
// Inverted deliberately. This used to pin the tuple to the values the server
// required; pinning is what broke /join when the server moved and cached pages
// did not. The config must now carry no tuple at all — join.html reads it live
// from /api/legal-versions.
assert.equal(
  configFor('www.downtownpourcollective.com').legalVersions,
  undefined,
  'join config must not carry a legal-version tuple; it is read from /api/legal-versions',
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
assert.match(deploy, /20260821160000_ops_subscription_overview\.sql/);
assert.match(deploy, /Stripe key can read subscriptions/);
assert.match(deploy, /production deployments come only from\s+Vercel's Git integration/);
assert.match(deploy, /Do not run `vercel --prod` from a local\s+checkout/);

const packageJson = JSON.parse(packageSource);
const localProductionDeployPattern = /\b(?:vercel|vc)\b.*(?:--prod\b|--target(?:=|\s+)production\b)/;
const localProductionDeployScript = Object.entries(packageJson.scripts ?? {}).find(
  ([, command]) => localProductionDeployPattern.test(command),
);
assert.equal(
  localProductionDeployScript,
  undefined,
  'package.json must not expose a local Vercel production-deploy script',
);
for (const command of ['vercel --prod', 'vc --prod']) {
  assert.match(command, localProductionDeployPattern, `${command} must remain guarded`);
}

assert.match(analytics, /sendEvent\('join_error', params\)/);
assert.match(analytics, /error_code:/);
assert.match(analytics, /http_status:/);
assert.match(trackApi, /if \(event === 'join_error'\)/);
assert.match(trackApi, /ALLOWED_ERROR_CODES\.has\(s\) \? s : 'unknown'/);
assert.match(dashboardApi, /join_error_codes/);
assert.match(dashboardApi, /Object\.create\(null\)/);
assert.match(dashboardApi, /event=in\.\(page_view,membership_checkout_complete\)/);
assert.match(dashboardApi, /event=eq\.join_error/);
assert.match(dashboardApi, /normalizeSubscriptionOverview/);
assert.match(dashboardApi, /unique_active_members: countOrNull/);
assert.match(dashboardApi, /return normalizeSubscriptionOverview\(overview\);/);
assert.match(dashboard, /Join errors/);
assert.match(dashboard, /Checkout completions/);
assert.match(dashboard, /No collection attempt recorded/);
assert.match(dashboard, /Funnel data reached its query limit; counts are incomplete/);
assert.match(dashboard, /CHECKOUT_NOT_ENABLED|join_error_codes/);
assert.match(dashboard, /Stalled handoffs/);
assert.match(dashboardApi, /checkout_fallback_clicks/);
assert.match(dashboardApi, /event=in\.\(join_submit,join_checkout_ready,join_checkout_departed,join_checkout_fallback_clicked,join_checkout_stalled\)/);
assert.match(playwrightConfig, /mobile-chromium/);
assert.match(playwrightConfig, /mobile-webkit/);
assert.match(checkoutWorkflow, /npm run test:e2e/);
assert.match(checkoutWorkflow, /'vercel\.json'/);

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
assert.ok(vercel.functions['api/health-check.js'].maxDuration >= 30);
assert.match(deploy, /column_name in \('error_code', 'http_status', 'flow_id'\)/);
assert.match(deploy, /join_checkout_ready/);
assert.match(deploy, /join_checkout_departed/);
assert.match(deploy, /join_checkout_fallback_clicked/);
assert.match(deploy, /join_checkout_stalled/);

// Legal versions are read live from /api/legal-versions. Reintroducing a
// hardcoded tuple in either checkout page is the exact regression that took
// /join down on 2026-08-17 — every cached copy of the page keeps submitting a
// version the server has already moved past. Guard the concept, not one shape:
// the object literal, a quoted version string on any of the four keys, and the
// absence of the live read all fail here.
for (const [page, markup] of [
  ['join.html', join],
  ['depositor-confirmation.html', depositorConfirmation],
]) {
  assert.doesNotMatch(
    markup,
    /legalVersions\s*:\s*\{/,
    `${page} reintroduced a hardcoded legalVersions object literal`,
  );
  assert.doesNotMatch(
    markup,
    /\b(?:tos|privacy|memberTerms|autoRenewalTerms)\s*:\s*['"]\d/,
    `${page} reintroduced a hardcoded legal version string`,
  );
  assert.match(markup, /\/api\/legal-versions/, `${page} no longer reads live legal versions`);
  assert.match(markup, /\?fresh=1/, `${page} no longer revalidates uncached before submit`);
  assert.match(
    markup,
    /Our terms were updated\. Please review and accept the current terms\./,
    `${page} lost the re-accept prompt`,
  );
}

// /join must not be CDN- or browser-cached: a cached copy is how a stale page
// survives a deploy. /depositor-confirmation already carried this header.
for (const source of ['/join', '/depositor-confirmation']) {
  const rule = vercel.headers.find((entry) => entry.source === source);
  assert.ok(rule, `vercel.json has no headers rule for ${source}`);
  assert.ok(
    rule.headers.some((h) => h.key === 'Cache-Control' && h.value === 'no-store'),
    `${source} is missing Cache-Control: no-store`,
  );
}

console.log('Release-readiness static checks passed.');
