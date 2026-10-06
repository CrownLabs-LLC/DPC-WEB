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
const loader = process.env.META_PIXEL_LOADER_PATH ? readFileSync(process.env.META_PIXEL_LOADER_PATH, 'utf8') : read('assets/meta-pixel.v1.js');
const home = read('index.html').replace('name="dpc-advertising-enabled" content="false"', 'name="dpc-advertising-enabled" content="true"');
const config = `fbq.registerPlugin('${pixelId}', {__fbEventsPlugin: 1, plugin: function(fbq, instance) { instance.configLoaded('${pixelId}'); }});`;

console.log('Meta SDK SHA256:', createHash('sha256').update(sdk).digest('hex'));
for (const [name, engine, options] of [
  ['desktop-chromium', chromium, {}],
  ['mobile-webkit', webkit, devices['iPhone 12']]
]) {
  const browser = await engine.launch();
  try {
    for (const scenario of ['navigation-and-restore', 'cross-tab-opt-out', 'GPC']) {
      const context = await browser.newContext({ ...options, serviceWorkers: 'block' });
      try {
        const beacons = [];
        const configRequests = [];
        await context.route('**/*', async route => {
          const url = new URL(route.request().url());
          let body;
          let contentType = 'application/javascript';
          if (url.origin === origin && url.pathname === '/') { body = home; contentType = 'text/html'; }
          else if (url.origin === origin && url.pathname === '/privacy-choices') { body = read('privacy-choices.html'); contentType = 'text/html'; }
          else if (url.origin === origin && url.pathname === '/assets/privacy-controls.v2.js') body = controls;
          else if (url.origin === origin && url.pathname === '/assets/meta-pixel.v1.js') body = loader;
          else if (url.href === 'https://connect.facebook.net/en_US/fbevents.js') body = sdk;
          else if (url.origin === 'https://connect.facebook.net' && url.pathname === '/signals/config/' + pixelId) { body = config; configRequests.push(url.href); }
          else if (/(^|\.)facebook\.com$/.test(url.hostname) && url.pathname.replace(/\/$/, '') === '/tr') {
            const params = new URLSearchParams(url.search);
            for (const [key, value] of new URLSearchParams(route.request().postData() || '')) params.set(key, value);
            beacons.push({ event: params.get('ev'), url: params.get('dl') });
            return route.fulfill({ status: 200, body: '' });
          }
          if (body === undefined) return route.abort();
          return route.fulfill({ status: 200, contentType, body });
        });
        const page = await context.newPage();
        await page.goto(origin + '/?utm_source=fixture&fbclid=fixture#private');
        await expect.poll(() => beacons.length).toBe(1);
        assert.equal(configRequests.length, 1, 'SDK must use the local config stub');
        assert.deepEqual(beacons, [{ event: 'PageView', url: origin + '/' }]);

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
        assert.deepEqual(beacons, [{ event: 'PageView', url: origin + '/' }], scenario + ': navigation must send nothing');

        if (scenario !== 'navigation-and-restore') {
          await page.evaluate(() => window.fbq('track', 'PageView'));
          await page.waitForTimeout(250);
          assert.deepEqual(beacons, [{ event: 'PageView', url: origin + '/' }], scenario + ': revoked SDK must refuse direct events');
        }

        // Exercise the SDK's real listener using a synthetic bfcache lifecycle event.
        await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
        await page.evaluate(() => window.fbq('track', 'PageView'));
        await page.waitForTimeout(250);
        assert.deepEqual(beacons, [{ event: 'PageView', url: origin + '/' }], scenario + ': restore/revoked SDK must send nothing');
        console.log('PASS:', name, scenario, 'one clean initial PageView; no later beacons.');
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}
