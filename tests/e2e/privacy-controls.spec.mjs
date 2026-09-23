import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const pixelPages = new Map([
  ['/', readFileSync(new URL('../../index.html', import.meta.url), 'utf8')],
  ['/join', readFileSync(new URL('../../join.html', import.meta.url), 'utf8')],
  ['/subscription-success', readFileSync(new URL('../../subscription-success.html', import.meta.url), 'utf8')],
]);
const privacyControlsSource = readFileSync(new URL('../../assets/privacy-controls.v2.js', import.meta.url), 'utf8');
const metaPixelSource = readFileSync(new URL('../../assets/meta-pixel.v1.js', import.meta.url), 'utf8');

async function routeEnabledPixelAssets(page) {
  await page.route('https://www.downtownpourcollective.com/assets/privacy-controls.v2.js', route => {
    return route.fulfill({ status: 200, contentType: 'application/javascript', body: privacyControlsSource });
  });
  await page.route('https://www.downtownpourcollective.com/assets/meta-pixel.v1.js', route => {
    return route.fulfill({ status: 200, contentType: 'application/javascript', body: metaPixelSource });
  });
}

test.beforeEach(async ({ context }) => {
  // Local fixture tests never send browser data to production services.
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.hostname === '127.0.0.1' ? route.continue() : route.abort();
  });
});

test('keyboard opt-out persists across reload and is shared with another tab', async ({ page, context }) => {
  await page.goto('/privacy-choices');
  const other = await context.newPage();
  await other.goto('/privacy-choices');
  const button = page.getByRole('button', { name: 'Opt out of advertising sharing', exact: true });
  await button.focus();
  await button.press('Enter');
  await expect(page.getByRole('status')).toHaveText('Your advertising opt-out is saved in this browser.');
  await expect(other.getByRole('status')).toHaveText('Your advertising opt-out is saved in this browser.');
  await page.reload();
  await expect(page.getByRole('status')).toHaveText('Your advertising opt-out is saved in this browser.');
  expect((await context.cookies()).find(c => c.name === 'dpc_advertising_opt_out')?.value).toBe('1');
});

test('GPC automatically opts out even with previous analytics consent', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'globalPrivacyControl', { value: true, configurable: true });
    localStorage.setItem('dpc_cookie_consent', '1');
  });
  await page.goto('/privacy-choices');
  await expect(page.getByRole('status')).toContainText('Global Privacy Control is on');
  await expect(page.getByRole('status')).toContainText('also saved');
  await expect(page.getByRole('button')).toHaveAttribute('aria-disabled', 'true');
  expect(await page.evaluate(() => window.DPCPrivacy.canLoadAdvertising())).toBe(false);
});

test('blocked storage keeps the opt-out on this page and explains how to retry', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw Error('blocked'); } });
    Object.defineProperty(document, 'cookie', { get() { return ''; }, set() {} });
  });
  await page.goto('/privacy-choices');
  await page.getByRole('button').click();
  await expect(page.getByRole('status')).toContainText('did not let us save it for future visits');
  await expect(page.getByRole('button')).toHaveAttribute('aria-disabled', 'false');
});

test('privacy controls make zero third-party requests and fit mobile/desktop', async ({ page }) => {
  const external = [];
  page.on('request', req => { if (new URL(req.url()).hostname !== '127.0.0.1') external.push(req.url()); });
  await page.goto('/privacy-choices');
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByRole('button')).toBeVisible();
  }
  await expect(page.getByText(/do not use App-collected data/)).toBeVisible();
  expect(external).toEqual([]);
});

test('public footer works without JavaScript and the choice page gives a fallback', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4173/');
  await page.getByRole('link', { name: 'Do Not Sell or Share My Personal Information', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Do Not Sell or Share My Personal Information');
  await expect(page.getByRole('status')).toContainText('Enable JavaScript and reload');
  await expect(page.getByRole('button')).toBeHidden();
  await context.close();
});

test('accepting existing analytics does not activate Meta', async ({ page }) => {
  const meta = [];
  page.on('request', req => { if (/facebook\.net|facebook\.com/.test(new URL(req.url()).hostname)) meta.push(req.url()); });
  await page.goto('/');
  await page.locator('#cookie-accept').click();
  expect(await page.evaluate(() => window.DPCPrivacy.canLoadAdvertising())).toBe(false);
  expect(await page.evaluate(() => typeof window.fbq)).toBe('undefined');
  expect(meta).toEqual([]);
});

test('production-disabled homepage, join and success paths make zero Meta requests', async ({ page }) => {
  const meta = [];
  page.on('request', request => {
    if (/facebook\.net|facebook\.com/.test(new URL(request.url()).hostname)) meta.push(request.url());
  });
  for (const path of pixelPages.keys()) {
    await page.goto(path);
    expect(await page.evaluate(() => window.DPCMetaPixel?.getState().sdkRequested)).toBe(false);
  }
  expect(meta).toEqual([]);
});

test('enabled fixture sends one PageView on each allowlisted path with sanitized URLs', async ({ page }) => {
  const meta = [];
  await routeEnabledPixelAssets(page);
  await page.route('https://connect.facebook.net/**', route => {
    meta.push(route.request().url());
    return route.fulfill({ status: 200, contentType: 'application/javascript', body: '/* inert test SDK */' });
  });

  for (const [path, source] of pixelPages) {
    await page.route(url => url.hostname === 'www.downtownpourcollective.com' && url.pathname === path, route => {
      return route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: source.replace('name="dpc-advertising-enabled" content="false"', 'name="dpc-advertising-enabled" content="true"')
      });
    }, { times: 1 });
    await page.goto(`https://www.downtownpourcollective.com${path}?email=person%40example.com&utm_source=test#private-fragment`);
    await expect.poll(() => meta.length).toBe([...pixelPages.keys()].indexOf(path) + 1);
    expect(new URL(page.url()).search).toBe('');
    expect(new URL(page.url()).hash).toBe('');
    expect(await page.evaluate(() => localStorage.getItem('dpc_cookie_consent'))).toBeNull();
    expect(await page.evaluate(() => window.fbq.queue.map(args => Array.from(args)).filter(call => call[0] === 'track'))).toEqual([['track', 'PageView']]);
  }
  expect(meta).toEqual(pixelPages.size === 3 ? Array(3).fill('https://connect.facebook.net/en_US/fbevents.js') : []);
  expect(meta.join(' ')).not.toMatch(/person|example|utm|private/i);
});

test('enabled fixture honors saved opt-out and GPC before any SDK request', async ({ page }) => {
  const source = pixelPages.get('/join').replace(
    'name="dpc-advertising-enabled" content="false"',
    'name="dpc-advertising-enabled" content="true"'
  );
  const meta = [];
  await routeEnabledPixelAssets(page);
  page.on('request', request => {
    if (/facebook\.net|facebook\.com/.test(new URL(request.url()).hostname)) meta.push(request.url());
  });

  await page.addInitScript(() => localStorage.setItem('dpc_advertising_opt_out', '1'));
  await page.route(url => url.hostname === 'www.downtownpourcollective.com' && url.pathname === '/join', route => route.fulfill({ status: 200, contentType: 'text/html', body: source }), { times: 1 });
  await page.goto('https://www.downtownpourcollective.com/join');
  expect(await page.evaluate(() => window.DPCMetaPixel.getState().sdkRequested)).toBe(false);

  await page.evaluate(() => localStorage.removeItem('dpc_advertising_opt_out'));
  await page.addInitScript(() => Object.defineProperty(navigator, 'globalPrivacyControl', { value: true, configurable: true }));
  await page.route(url => url.hostname === 'www.downtownpourcollective.com' && url.pathname === '/join', route => route.fulfill({ status: 200, contentType: 'text/html', body: source }), { times: 1 });
  await page.goto('https://www.downtownpourcollective.com/join');
  expect(await page.evaluate(() => window.DPCMetaPixel.getState().sdkRequested)).toBe(false);
  expect(meta).toEqual([]);
});

for (const width of [320, 1280]) {
  test(`privacy footer is reachable without accepting analytics at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route('**/api/track', route => route.fulfill({ status: 202, body: '{}' }));
    await page.route('**/api/legal-versions*', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tos: '3.0', privacy: '4.2', memberTerms: '3.0', autoRenewalTerms: '3.0' }) }));
    for (const path of ['/', '/partners', '/join', '/reserved-confirmation', '/subscription-success', '/subscription-cancelled', '/partner-subscription-success', '/partner-subscription-cancelled']) {
      await page.goto(path);
      await expect(page.locator('#cookie-banner')).toBeVisible();
      const privacyLink = page.getByRole('link', { name: 'Do Not Sell or Share My Personal Information', exact: true });
      const geometry = await privacyLink.evaluate(element => {
        document.documentElement.style.setProperty('scroll-behavior', 'auto', 'important');
        element.scrollIntoView({ block: 'center', behavior: 'instant' });
        const link = element.getBoundingClientRect();
        const banner = document.querySelector('#cookie-banner').getBoundingClientRect();
        return {
          linkTop: link.top,
          linkBottom: link.bottom,
          bannerTop: banner.top,
          viewportHeight: window.innerHeight,
        };
      });
      expect(geometry.linkTop).toBeGreaterThanOrEqual(0);
      expect(geometry.linkBottom).toBeLessThanOrEqual(geometry.viewportHeight);
      expect(geometry.linkBottom).toBeLessThanOrEqual(geometry.bannerTop);
      await privacyLink.focus();
      await expect(privacyLink).toBeFocused();
      await privacyLink.press('Enter');
      await expect(page).toHaveURL(/\/privacy-choices$/);
      expect(await page.evaluate(() => localStorage.getItem('dpc_cookie_consent'))).toBeNull();
    }
  });
}
