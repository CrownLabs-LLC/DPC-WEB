#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [page, serveSource, robots, vercelSource, sitemap] = await Promise.all([
  read('depositor-confirmation.html'),
  read('serve.json'),
  read('robots.txt'),
  read('vercel.json'),
  read('sitemap.xml'),
]);

assert.match(page, /<meta name="robots" content="noindex, nofollow, noarchive">/);
assert.match(page, /<meta name="referrer" content="no-referrer">/);
assert.match(page, /Your \$49 Founding Slot Deposit is already recorded/);
assert.match(page, /You will not be charged it again/);
assert.match(page, /Checkout contains only that recurring membership charge/);
assert.match(page, /paid deposit includes one Welcome Kit/);
assert.match(page, /up to five Membership Pours per monthly period/);
assert.match(page, /September 1, 2026 at 12:00 AM Pacific Time/);
assert.match(page, /member app is awaiting store approval/);
assert.match(page, /secure invitation[^<]+identifies the existing deposit and member record/);
assert.match(page, /Terms of Service[\s\S]*Privacy Policy[\s\S]*Member Terms &amp; Redemption Policy[\s\S]*automatic renewal terms/);

assert.doesNotMatch(page, /assets\/analytics\.js|DPCAnalytics|sendBeacon|localStorage|sessionStorage|console\./);
assert.doesNotMatch(page, /foundingDepositPriceId|price_[A-Za-z0-9]+/);
assert.ok(
  page.indexOf('id="depositor-token-bootstrap"') < page.indexOf('fonts.googleapis.com'),
  'token must be scrubbed before third-party fonts load',
);
assert.ok(
  page.indexOf('id="depositor-token-bootstrap"') < page.indexOf('id="turnstile-api-script"'),
  'token must be scrubbed before Turnstile loads',
);

assert.match(page, /checkoutKind: 'deposit_conversion'/);
assert.match(page, /depositorConfirmationToken: depositorToken/);
assert.match(page, /function offerType\(\) \{ return 'founding'; \}/);
assert.match(page, /parsed\.protocol === 'https:' && parsed\.hostname === 'checkout\.stripe\.com'/);
assert.match(page, /window\.location\.href = url/);
assert.match(page, /tos: '3\.0'/);
assert.match(page, /privacy: '4\.2'/);
assert.match(page, /memberTerms: '3\.0'/);
assert.match(page, /autoRenewalTerms: '3\.0'/);
assert.match(page, /0x4AAAAAAECO2A5oKsePqsOg/);
assert.match(page, /1x00000000000000000000AA/);
assert.match(page, /checkoutEndpoint: dpcCheckoutEndpointForHost\(window\.location\.hostname\)/);
assert.match(page, /if \(!needsTurnstile\)/);
assert.match(page, /if \(!turnstileToken\)/);
assert.match(page, /challengeToken: turnstileToken/);
assert.doesNotMatch(page, /pending-site-key/);
assert.match(page, /id="invite-error"[^>]+hidden/);
assert.match(page, /id="join-form"[^>]+hidden/);
assert.match(page, /DEPOSITOR_CONFIRMATION_INVALID[\s\S]*showInviteUnavailable\(\)/);

const configScript = page.match(
  /function dpcTurnstileSiteKeyForHost[\s\S]*?window\.DPC_DEPOSITOR_CONFIRMATION = \{[\s\S]*?\n\};/,
)?.[0];
assert.ok(configScript, 'private route config must remain executable in isolation');
function configFor(hostname) {
  const context = { window: { location: { hostname } }, Date };
  vm.runInNewContext(configScript, context);
  return context.window.DPC_DEPOSITOR_CONFIRMATION;
}
const productionEndpoint = 'https://ebiuspbgzggrdiaswpcc.supabase.co/functions/v1/circle-checkout';
assert.equal(configFor('www.downtownpourcollective.com').checkoutEndpoint, productionEndpoint);
assert.equal(configFor('downtownpourcollective.com').checkoutEndpoint, productionEndpoint);
assert.equal(configFor('preview.vercel.app').checkoutEndpoint, '');
assert.equal(configFor('127.0.0.1').checkoutEndpoint, '');
assert.equal(configFor('www.downtownpourcollective.com').turnstileSiteKey, '0x4AAAAAAECO2A5oKsePqsOg');
assert.equal(configFor('127.0.0.1').turnstileSiteKey, '1x00000000000000000000AA');
assert.deepEqual(
  { ...configFor('www.downtownpourcollective.com').legalVersions },
  {
    tos: '3.0',
    privacy: '4.2',
    memberTerms: '3.0',
    autoRenewalTerms: '3.0',
  },
);

const bootstrap = page.match(
  /<script id="depositor-token-bootstrap">([\s\S]*?)<\/script>/,
)?.[1];
assert.ok(bootstrap, 'token bootstrap must exist');

function runBootstrap(hash, search = '') {
  let domReady;
  let delivered;
  const replacements = [];
  const context = {
    window: {
      location: { hash, pathname: '/depositor-confirmation', search },
      history: {
        replaceState(...args) { replacements.push(args); },
      },
      __startDpcDepositorConfirmation(token) { delivered = token; },
    },
    document: {
      addEventListener(name, callback, options) {
        assert.equal(name, 'DOMContentLoaded');
        assert.equal(options?.once, true);
        domReady = callback;
      },
    },
  };
  vm.runInNewContext(bootstrap, context);
  assert.deepEqual(replacements, [[null, '', '/depositor-confirmation']]);
  assert.equal(typeof domReady, 'function');
  domReady();
  return delivered;
}

const lowerToken = 'ab'.repeat(32);
assert.equal(runBootstrap(`#token=${lowerToken}`, '?qa=synthetic'), lowerToken);
assert.equal(runBootstrap(`#token=${lowerToken.toUpperCase()}`), lowerToken);
assert.equal(runBootstrap(''), '');
assert.equal(runBootstrap('#token=too-short'), '');
assert.equal(runBootstrap(`#other=${lowerToken}`), '');

const serve = JSON.parse(serveSource);
assert.ok(serve.rewrites.some(({ source, destination }) => (
  source === '/depositor-confirmation'
    && destination === '/depositor-confirmation.html'
)));
assert.match(robots, /Disallow: \/depositor-confirmation/);
assert.doesNotMatch(sitemap, /depositor-confirmation/);

const vercel = JSON.parse(vercelSource);
const headers = vercel.headers.find(({ source }) => source === '/depositor-confirmation')?.headers;
assert.ok(headers, 'private route headers must exist');
const headerMap = Object.fromEntries(headers.map(({ key, value }) => [key, value]));
assert.equal(headerMap['X-Robots-Tag'], 'noindex, nofollow, noarchive');
assert.equal(headerMap['Cache-Control'], 'no-store');
assert.equal(headerMap['Referrer-Policy'], 'no-referrer');
assert.equal(headerMap['X-Content-Type-Options'], 'nosniff');

console.log('Depositor-confirmation security and contract checks passed.');
