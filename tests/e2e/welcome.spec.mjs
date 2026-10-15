import { test, expect } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import { createHmac } from 'node:crypto';

// A dead local proxy is a second, browser-level boundary: an unhandled request
// cannot hit production even during page teardown. All fixture URLs are fulfilled.
test.use({ proxy: { server: 'http://127.0.0.1:9' } });
const origin = 'https://www.downtownpourcollective.com';
const id = 'cs_live_' + 'a'.repeat(40);
const eventIdFor = sessionId => createHmac('sha256', 'welcome-event-test-secret-32-bytes-minimum').update(sessionId).digest('base64url');
const paid = { status: 'paid', circle: 'tap', billingInterval: 'monthly', amountPaid: 10800,
  currency: 'usd', welcomeKit: true, livemode: true, eventId: eventIdFor(id) };
const read = path => readFileSync(new URL('../../' + path, import.meta.url));
const headers = JSON.parse(read('vercel.json')).headers.find(r => r.source === '/welcome').headers;
const metaEvents = page => page.evaluate(() => window.fbq ? (window.fixtureMetaCalls || window.fbq.queue.map(args => Array.from(args))).filter(c => c[0] === 'track') : []);

async function fixture(page, context, { data = sessionId => ({ ...paid, eventId: eventIdFor(sessionId) }), status = 200, search = '?session_id=' + id,
  privacy = '', gate = null, sdkGate = null, bare = false } = {}) {
  const reads = [], sdk = [], escaped = [], resources = [], events = [];
  await page.exposeFunction('recordWelcomeMeta', args => { if (args[0] === 'track') events.push(args); });
  await page.addInitScript(signal => {
    // No unload beacon can bypass the route mock. This surface should never use one.
    navigator.sendBeacon = () => { throw new Error('Unexpected beacon on welcome'); };
    if (signal === 'GPC') Object.defineProperty(navigator, 'globalPrivacyControl', { value: true });
    if (signal === 'opt-out') localStorage.setItem('dpc_advertising_opt_out', '1');
    if (signal === 'storage') Object.defineProperty(window, 'sessionStorage', { get() { throw new Error('blocked'); } });
  }, privacy);
  await context.route('**/*', async route => {
    const request = route.request(); const url = new URL(request.url()); resources.push(url.href);
    if (url.origin === origin && url.pathname === '/welcome') return route.fulfill({
      contentType: 'text/html', body: read('welcome.html'), headers: Object.fromEntries(headers.map(h => [h.key, h.value])) });
    if (url.origin === origin && (url.pathname.startsWith('/assets/') || url.pathname === '/favicon.svg')) {
      const file = url.pathname.slice(1);
      if (!/^assets\/(?:welcome\.v1\.(?:js|css)|privacy-controls\.v2\.js|privacy-footer\.v2\.css|meta-pixel\.v5\.js|glass-fonts\.v1\.css|fonts\/glass-brand-[1-6]\.ttf)$/.test(file) && file !== 'favicon.svg') {
        escaped.push(url.href); return route.abort();
      }
      const contentType = file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.ttf') ? 'font/ttf' : 'image/svg+xml';
      return route.fulfill({ body: read(file), contentType });
    }
    if (url.origin === origin && url.pathname === '/api/welcome-checkout') {
      reads.push({ body: request.postDataJSON(), url: url.href, headers: request.headers() });
      if (gate) await gate;
      return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(typeof data === 'function' ? data(request.postDataJSON().sessionId) : data) });
    }
    if (url.href === 'https://connect.facebook.net/en_US/fbevents.js') {
      sdk.push({ url: url.href, headers: request.headers() });
      if (sdkGate) await sdkGate;
      return route.fulfill({ contentType: 'application/javascript', body: 'window.sdkLocation = location.href; window.fixtureMetaCalls=[]; window.fbq.callMethod=function(){var args=Array.from(arguments);window.fixtureMetaCalls.push(args);window.recordWelcomeMeta(args);};window.fbq.queue.forEach(function(args){window.fbq.callMethod.apply(null,args);});' });
    }
    if (url.origin === origin && url.pathname === '/fixture-away') return route.fulfill({ contentType: 'text/html', body: '<p>Away</p>' });
    escaped.push(url.href); return route.abort();
  });
  if (!bare) await page.goto(origin + '/welcome' + search, { waitUntil: 'domcontentloaded' });
  return { reads, sdk, escaped, resources, events };
}

test('only verified payment shows success, kit instructions, exact paid value and opaque eventID', async ({ page, context }) => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const f = await fixture(page, context, { gate, search: '?session_id=' + id + '&email=private%40example.invalid#secret' });
  await expect(page.locator('h1')).toHaveText('Checking your payment.');
  expect((await metaEvents(page)).some(c => c[1] === 'Purchase')).toBe(false);
  await page.evaluate(() => {
    const original = window.DPCMetaPixel;
    window.DPCMetaPixel = { ...original, track(name, data) {
      if (name === 'Purchase') window.fixturePurchaseInput = data;
      return original.track(name, data);
    } };
  });
  release(); await expect(page.locator('h1')).toHaveText('You are in.');
  await expect(page.locator('#welcome-kit')).toBeVisible();
  await expect.poll(() => metaEvents(page)).toEqual([
    ['track', 'PageView'], ['track', 'Purchase', { content_name: 'tap_monthly', value: 108, currency: 'USD' }, { eventID: paid.eventId }],
  ]);
  expect(await page.evaluate(() => window.fixturePurchaseInput)).toEqual({
    status: 'paid', circle: 'tap', billingInterval: 'monthly', amountPaid: 10800,
    currency: 'usd', livemode: true, eventId: paid.eventId,
  });
  const storageKeys = await page.evaluate(() => Object.keys(sessionStorage));
  expect(storageKeys).toEqual(['dpc_purchase:' + paid.eventId]);
  expect(JSON.stringify([await metaEvents(page), storageKeys])).not.toMatch(/cs_(live|test)_/);
  expect(f.reads).toHaveLength(1); expect(f.reads[0].body).toEqual({ sessionId: id });
  expect(f.reads[0].url).toBe(origin + '/api/welcome-checkout'); expect(f.reads[0].headers.referer).toBeUndefined();
  expect(f.sdk[0].headers.referer).toBeUndefined();
  expect(await page.evaluate(() => window.sdkLocation)).toBe(origin + '/welcome');
  expect(f.escaped).toEqual([]);
});

test('real reload and Back recheck payment without repeating Purchase', async ({ page, context }) => {
  const f = await fixture(page, context);
  await expect.poll(async () => (await metaEvents(page)).filter(c => c[1] === 'Purchase').length).toBe(1);
  await page.reload(); await expect(page.locator('h1')).toHaveText('You are in.');
  expect((await metaEvents(page)).filter(c => c[1] === 'Purchase')).toHaveLength(0);
  await page.goto(origin + '/fixture-away'); await page.goBack();
  await expect(page.locator('h1')).toHaveText('You are in.');
  expect(f.events.filter(c => c[1] === 'Purchase')).toHaveLength(1);
  expect(f.reads.length).toBeGreaterThanOrEqual(2); expect(f.escaped).toEqual([]);
});

test('a pending payment can be checked again and then emits exactly one Purchase', async ({ page, context }) => {
  const data = { status: 'pending' };
  const f = await fixture(page, context, { data });
  await expect(page.locator('h1')).toHaveText('Payment isn’t confirmed yet.');
  Object.assign(data, paid);
  await page.getByRole('button', { name: 'Check payment again' }).click();
  await expect(page.locator('h1')).toHaveText('You are in.');
  await expect.poll(() => f.events.filter(c => c[1] === 'Purchase').length).toBe(1);
  expect(f.reads).toHaveLength(2);
});

test('each history entry keeps its own session and a fresh bare visit never reuses it', async ({ page, context }) => {
  const f = await fixture(page, context);
  await expect(page.locator('h1')).toHaveText('You are in.');
  const second = 'cs_live_' + 'b'.repeat(40);
  await page.goto(origin + '/welcome?session_id=' + second);
  await expect(page.locator('h1')).toHaveText('You are in.');
  await page.goBack(); await expect(page.locator('h1')).toHaveText('You are in.');
  expect(f.reads.at(-1).body.sessionId).toBe(id);
  const before = f.reads.length;
  await page.goto(origin + '/welcome');
  await expect(page.locator('h1')).toHaveText('Check your confirmation email.');
  expect(f.reads).toHaveLength(before);
  expect(f.events.filter(c => c[1] === 'Purchase').map(c => c[3].eventID)).toEqual([eventIdFor(id), eventIdFor(second)]);
  const storageKeys = await page.evaluate(() => Object.keys(sessionStorage));
  expect(storageKeys.sort()).toEqual([id, second].map(value => 'dpc_purchase:' + eventIdFor(value)).sort());
  expect(JSON.stringify([f.events, storageKeys])).not.toMatch(/cs_(live|test)_/);
});

for (const [name, options, heading] of [
  ['pending', { data: { status: 'pending' } }, 'Payment isn’t confirmed yet.'],
  ['provider failure', { status: 503 }, 'We couldn’t confirm this checkout.'],
  ['malformed success', { data: { ...paid, amountPaid: '10800' } }, 'We couldn’t confirm this checkout.'],
  ['missing event ID', { data: { ...paid, eventId: undefined } }, 'We couldn’t confirm this checkout.'],
  ['raw live ID as event ID', { data: { ...paid, eventId: 'cs_live_' + 'a'.repeat(35) } }, 'We couldn’t confirm this checkout.'],
  ['raw test ID as event ID', { data: { ...paid, eventId: 'cs_test_' + 'a'.repeat(35) } }, 'We couldn’t confirm this checkout.'],
  ['invalid link', { search: '?session_id=invalid' }, 'Check your confirmation email.'],
  ['duplicate ID', { search: '?session_id=' + id + '&session_id=' + id }, 'Check your confirmation email.'],
  ['bare page', { search: '' }, 'Check your confirmation email.'],
]) test(name + ' never claims a purchase or emits Purchase', async ({ page, context }) => {
  const f = await fixture(page, context, options);
  await expect(page.locator('h1')).toHaveText(heading);
  await expect(page.locator('#welcome-kit')).toBeHidden();
  expect((await metaEvents(page)).filter(c => c[1] === 'Purchase')).toHaveLength(0);
  expect(await page.evaluate(() => Object.keys(sessionStorage))).toEqual([]);
  expect(f.escaped).toEqual([]);
});

for (const privacy of ['GPC', 'opt-out', 'storage']) test(privacy + ' preserves confirmation while suppressing Purchase', async ({ page, context }) => {
  const f = await fixture(page, context, { privacy, data: { ...paid, welcomeKit: false } });
  await expect(page.locator('h1')).toHaveText('You are in.');
  await expect(page.locator('#welcome-kit')).toBeHidden();
  expect((await metaEvents(page)).filter(c => c[1] === 'Purchase')).toHaveLength(0);
  if (privacy !== 'storage') expect(f.sdk).toHaveLength(0);
  expect(f.escaped).toEqual([]);
});

test('opting out while SDK loads cancels pending Purchase and leaves dedup unused', async ({ page, context }) => {
  let release; const sdkGate = new Promise(resolve => { release = resolve; });
  const f = await fixture(page, context, { sdkGate });
  await expect(page.locator('h1')).toHaveText('You are in.');
  await page.evaluate(() => { localStorage.setItem('dpc_advertising_opt_out', '1'); window.dispatchEvent(new Event('dpc:privacy-change')); });
  release(); await page.waitForFunction(() => window.sdkLocation);
  expect((await metaEvents(page)).filter(c => c[1] === 'Purchase')).toHaveLength(0);
  expect(await page.evaluate(key => sessionStorage.getItem('dpc_purchase:' + key), paid.eventId)).toBeNull();
  expect(f.escaped).toEqual([]);
});

test('test-mode checkout renders confirmation but never sends a production Purchase', async ({ page, context }) => {
  const testId = id.replace('cs_live_', 'cs_test_');
  await fixture(page, context, { data: { ...paid, livemode: false, eventId: eventIdFor(testId) }, search: '?session_id=' + testId });
  await expect(page.locator('h1')).toHaveText('You are in.');
  expect((await metaEvents(page)).filter(c => c[1] === 'Purchase')).toHaveLength(0);
  expect(JSON.stringify([await metaEvents(page), await page.evaluate(() => Object.keys(sessionStorage))])).not.toMatch(/cs_(live|test)_/);
});

test('welcome fits narrow and desktop screens with readable text and keyboard-accessible help', async ({ page, context }) => {
  await fixture(page, context); await expect(page.locator('h1')).toHaveText('You are in.');
  for (const width of [320, 360, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const link of await page.locator('a:visible').all()) expect((await link.boundingBox()).height).toBeGreaterThanOrEqual(44);
    if (process.env.DPC_WELCOME_SCREENSHOTS === '1' && test.info().project.name === 'desktop-chromium' && [320, 1280].includes(width)) {
      mkdirSync('.impeccable/review', { recursive: true });
      await page.screenshot({ path: '.impeccable/review/' + (width === 320 ? 'mobile' : 'desktop') + '.png', fullPage: true });
    }
  }
  await page.getByRole('link', { name: 'hello@downtownpourcollective.com', exact: true }).focus();
  await expect(page.getByRole('link', { name: 'hello@downtownpourcollective.com', exact: true })).toBeFocused();
});
