// Opt-in compatibility check against a separately downloaded public Meta SDK.
// All browser requests are intercepted; no visitor data or events leave the process.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { chromium, webkit, devices, expect } from '@playwright/test';

assert.ok(process.env.META_PIXEL_SDK_PATH, 'Set META_PIXEL_SDK_PATH to a local fbevents.js snapshot.');
const sdk = readFileSync(process.env.META_PIXEL_SDK_PATH, 'utf8');
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const origin = 'https://www.downtownpourcollective.com';
const pixelId = '28569583012647858';
const controls = read('assets/privacy-controls.v2.js');
const loader = process.env.META_PIXEL_LOADER_PATH ? readFileSync(process.env.META_PIXEL_LOADER_PATH, 'utf8') : read('assets/meta-pixel.v4.js');
const home = read('index.html');
const config = process.env.META_PIXEL_CONFIG_PATH
  ? readFileSync(process.env.META_PIXEL_CONFIG_PATH, 'utf8')
  : `fbq.registerPlugin('config:${pixelId}', {__fbEventsPlugin: 1, plugin: function(fbq, instance) { instance.configLoaded('${pixelId}'); }});`;
const clickId = 'IwAR' + 'abc123DEF_-'.repeat(8);
const attribution = '?fbclid=' + clickId + '&utm_source=meta&utm_medium=paid_social&utm_campaign=123456789012345';
const expectedUrl = origin + '/' + attribution;

console.log('Meta SDK SHA256:', createHash('sha256').update(sdk).digest('hex'));
console.log('Meta config:', process.env.META_PIXEL_CONFIG_PATH ? createHash('sha256').update(config).digest('hex') : 'local stub');
for (const [name, engine, options] of [
  ['desktop-chromium', chromium, devices['Desktop Chrome']],
  ['mobile-webkit', webkit, devices['iPhone 12']]
]) {
  const browser = await engine.launch();
  try {
    for (const scenario of ['navigation-and-restore', 'cross-tab-opt-out', 'GPC', 'checkout-events']) {
      const context = await browser.newContext({ ...options, serviceWorkers: 'block' });
      try {
        const beacons = [];
        const configRequests = [];
        await context.route('**/*', async route => {
          const url = new URL(route.request().url());
          let body;
          let contentType = 'application/javascript';
          if (url.origin === origin && url.pathname === '/') { body = home; contentType = 'text/html'; }
          else if (url.origin === origin && url.pathname === '/join') { body = read('join.html'); contentType = 'text/html'; }
          else if (url.origin === origin && url.pathname === '/privacy-choices') { body = read('privacy-choices.html'); contentType = 'text/html'; }
          else if (url.origin === origin && url.pathname === '/assets/privacy-controls.v2.js') body = controls;
          else if (url.origin === origin && url.pathname === '/assets/meta-pixel.v4.js') body = loader;
          else if (url.href === 'https://connect.facebook.net/en_US/fbevents.js') body = sdk;
          else if (url.origin === 'https://connect.facebook.net' && url.pathname === '/signals/config/' + pixelId) { body = config; configRequests.push(url.href); }
          else if (/(^|\.)facebook\.com$/.test(url.hostname) && url.pathname.replace(/\/$/, '') === '/tr') {
            const params = new URLSearchParams(url.search);
            for (const [key, value] of new URLSearchParams(route.request().postData() || '')) params.set(key, value);
            const beacon = { event: params.get('ev'), url: params.get('dl') };
            const data = Object.fromEntries([...params].filter(([key]) => /^cd\[/.test(key)));
            if (Object.keys(data).length) beacon.data = data;
            beacons.push(beacon);
            assert.doesNotMatch(params.toString(), /person|example|private|session_id/);
            return route.fulfill({ status: 200, body: '' });
          }
          if (body === undefined) return route.abort();
          return route.fulfill({ status: 200, contentType, body });
        });
        const page = await context.newPage();
        await page.goto(expectedUrl + '&email=person%40example.com&session_id=private#private');
        await expect.poll(() => beacons.length).toBe(1);
        assert.equal(configRequests.length, 1, 'SDK must use the locally supplied config');
        assert.deepEqual(beacons, [{ event: 'PageView', url: expectedUrl }]);
        if (process.env.META_PIXEL_CONFIG_PATH) {
          const fbc = (await context.cookies()).find(cookie => cookie.name === '_fbc')?.value;
          assert.ok(fbc?.endsWith('.' + clickId), 'Meta must derive its click-attribution cookie from fbclid');
        }

        if (scenario === 'checkout-events') {
          await page.goto(origin + '/join?circle=cellar&billing=annual');
          await expect.poll(() => beacons.length).toBe(3);
          await page.locator('#firstName').fill('Private');
          await page.locator('#email').fill('person@example.invalid');
          await page.evaluate(() => {
            window.DPCMetaPixel.track('JoinCheckoutClick');
            window.DPCMetaPixel.track('InitiateCheckout', { circle: 'reserve', billingInterval: 'annual', email: 'person@example.invalid', value: 999 });
            window.DPCMetaPixel.track('InitiateCheckout', { circle: 'reserve', billingInterval: 'annual', email: 'person@example.invalid', value: 999 });
            window.DPCMetaPixel.track('Purchase');
          });
          await expect.poll(() => beacons.length).toBe(5);
          assert.deepEqual(beacons.slice(1), [
            { event: 'PageView', url: origin + '/join' },
            { event: 'ViewContent', url: origin + '/join', data: { 'cd[content_name]': 'membership', 'cd[content_category]': 'cellar' } },
            { event: 'JoinCheckoutClick', url: origin + '/join' },
            { event: 'InitiateCheckout', url: origin + '/join', data: { 'cd[content_name]': 'reserve_annual', 'cd[value]': '790', 'cd[currency]': 'USD' } },
          ]);
          console.log('PASS:', name, scenario, 'real SDK emits only the approved events, with catalog parameters and no personal form values.');
          continue;
        }

        if (scenario === 'cross-tab-opt-out') {
          const other = await context.newPage();
          await other.goto(origin + '/privacy-choices');
          await other.getByRole('button', { name: 'Opt out of advertising sharing', exact: true }).click();
          await expect.poll(() => page.evaluate(() => window.DPCPrivacy.canLoadAdvertising())).toBe(false);
        } else if (scenario === 'GPC') {
          await page.evaluate(() => {
            Object.defineProperty(navigator, 'globalPrivacyControl', { value: true, configurable: true });
            window.dispatchEvent(new Event('focus'));
          });
          assert.equal(await page.evaluate(() => window.DPCPrivacy.canLoadAdvertising()), false);
        }

        await page.evaluate(() => {
          location.hash = 'coaster-passport';
          history.pushState(null, '', '/?after=push#private');
          history.replaceState(null, '', '/?after=replace#private');
          window.dispatchEvent(new PopStateEvent('popstate'));
        });
        await page.waitForTimeout(250);
        assert.deepEqual(beacons, [{ event: 'PageView', url: expectedUrl }], scenario + ': navigation must send nothing');

        if (scenario !== 'navigation-and-restore') {
          await page.evaluate(() => window.fbq('track', 'PageView'));
          await page.waitForTimeout(250);
          assert.deepEqual(beacons, [{ event: 'PageView', url: expectedUrl }], scenario + ': revoked SDK must refuse direct events');
        }

        // Exercise the SDK's real listener using a synthetic bfcache lifecycle event.
        await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
        await page.evaluate(() => window.fbq('track', 'PageView'));
        await page.waitForTimeout(250);
        assert.deepEqual(beacons, [{ event: 'PageView', url: expectedUrl }], scenario + ': restore/revoked SDK must send nothing');
        console.log('PASS:', name, scenario, 'one clean initial PageView; no later beacons.');
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}
