import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { RESTAURANTS, tastingState } from '../../api/lib/glass-tasting.js';

const api = /\/api\/glass-tasting(?:\?|$)/;
const start = '2026-09-29T19:00:00Z';
function response(slug, now = start) {
  const state = tastingState(new Date(now));
  const next = new Date(state.schedule.today + 'T00:00:00Z'); next.setUTCDate(next.getUTCDate() + 1);
  return { success: true, restaurant: { slug, name: RESTAURANTS[slug] }, date: state.schedule.today,
    serverNow: now, validUntil: next.toISOString().slice(0, 10) + 'T07:00:00Z' };
}
async function mock(page, options = {}) {
  const posts = [];
  const control = { now: start, enabled: true, getFailed: false, getCount: 0, getGate: null, postStatus: 200, postMessage: '', ...options };
  await page.route(api, async route => {
    const slug = new URL(route.request().url()).searchParams.get('restaurant');
    if (route.request().method() === 'GET') {
      control.getCount++;
      if (control.getGate) await control.getGate;
      if (control.getFailed) return route.abort();
      const state = tastingState(new Date(control.now));
      return route.fulfill({ json: { ...state, enabled: control.enabled, available: control.enabled && state.eligible, restaurant: { slug, name: RESTAURANTS[slug] } } });
    }
    posts.push(route.request().postDataJSON());
    if (control.postStatus !== 200) return route.fulfill({ status: control.postStatus, json: { success: false, message: control.postMessage } });
    return route.fulfill({ json: control.result || response(slug, control.now) });
  });
  return { posts, control };
}
test.beforeEach(async ({ context, baseURL }) => {
  const origin = new URL(baseURL).origin;
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
});
const submit = page => page.getByRole('button', { name: 'Confirm tasting check-in', exact: true });
async function checkIn(page, email = 'guest@example.com') {
  await expect(submit(page)).toBeEnabled();
  await page.getByLabel('Your email', { exact: true }).fill(email);
  await submit(page).click();
}

for (const [slug, name] of Object.entries(RESTAURANTS)) {
  test(`${name}: email-only check-in identifies the restaurant and date`, async ({ page }) => {
    const { posts } = await mock(page);
    await page.goto('/glass-comes-back/' + slug);
    await expect(page.locator('h1')).toContainText(name);
    await expect(page.getByRole('checkbox')).toBeChecked();
    await expect(page.locator('input')).toHaveCount(2);
    await expect(page.locator('#age-note')).toHaveText("By checking in, you confirm you're 21 or older.");
    expect(await page.locator('#submit').evaluate(button => button.previousElementSibling.id)).toBe('age-note');
    await expect(page.locator('.privacy-note a')).toHaveAttribute('href', '/privacy');
    await expect(page.locator('#same-visit')).toContainText('Your server can hand you one');
    await expect(page.locator('.availability')).toContainText('One tasting per person, per restaurant, per eligible day.');
    await page.getByRole('checkbox').uncheck();
    await checkIn(page, 'Guest+tag@Example.com');
    await expect(page.getByRole('heading', { name: 'Enjoy your pour.' })).toBeFocused();
    await expect(page.locator('#confirmation')).toContainText(name);
    await expect(page.locator('#confirmation-date')).toHaveText('Tuesday, September 29, 2026');
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ restaurant: slug, email: 'guest+tag@example.com', marketingOptIn: false, marketingChanged: true });
    expect(Object.keys(posts[0]).sort()).toEqual(['email', 'marketingChanged', 'marketingOptIn', 'requestId', 'restaurant']);
    expect(page.url()).not.toContain('Guest');
    expect(await page.evaluate(() => ({ local: JSON.stringify(localStorage), session: JSON.stringify(sessionStorage) }))).toEqual({ local: '{}', session: '{}' });
    await page.getByRole('button', { name: 'Check in another guest' }).click();
    await expect(page.getByLabel('Your email', { exact: true })).toHaveValue('');
    await expect(page.getByRole('checkbox')).toBeChecked();
    await checkIn(page);
    await expect(page.locator('#confirmation')).toBeVisible();
    expect(posts[1].marketingChanged).toBe(false);
    expect(posts[1].marketingOptIn).toBe(true);
    expect(posts[1].requestId).not.toBe(posts[0].requestId);
  });
}

test('failed and throttled retries preserve entries and request identity; deliberate changes get new identity', async ({ page }) => {
  const { posts, control } = await mock(page, { postStatus: 503, postMessage: 'private@example.com upstream detail' });
  await page.goto('/glass-comes-back/l-campo');
  await checkIn(page, 'retry@example.com');
  await expect(page.getByRole('alert')).toContainText('paper option');
  await expect(page.getByRole('alert')).not.toContainText('private@example');
  await expect(page.locator('#confirmation')).toBeHidden();
  await expect(page.getByLabel('Your email', { exact: true })).toHaveValue('retry@example.com');
  control.postStatus = 429; control.postMessage = 'Please wait a minute, then try again. Your entries are still here.';
  await submit(page).click();
  await expect(page.getByRole('alert')).toContainText('wait a minute');
  expect(posts[1]).toEqual(posts[0]);
  control.postStatus = 200;
  await page.getByRole('checkbox').uncheck();
  await submit(page).click();
  await expect(page.locator('#confirmation')).toBeVisible();
  expect(posts[2].requestId).not.toBe(posts[0].requestId);
  expect(posts[2].marketingChanged).toBe(true);
});

test('server email validation is shown without losing the entered address', async ({ page }) => {
  await mock(page, { postStatus: 400, postMessage: 'Enter a valid email address to continue.' });
  await page.goto('/glass-comes-back/l-campo'); await checkIn(page, 'jane@gmail');
  await expect(page.getByRole('alert')).toHaveText('Enter a valid email address to continue.');
  await expect(page.getByLabel('Your email', { exact: true })).toHaveValue('jane@gmail');
  await expect(page.locator('#confirmation')).toBeHidden();
});

for (const [now, message] of [
  ['2026-09-28T19:00:00Z', 'next tasting is Tuesday, September 29'],
  ['2026-10-07T19:00:00Z', 'next tasting is Tuesday, October 13'],
  ['2026-10-15T07:00:00Z', 'These tastings have ended'],
]) test(`server date ${now} prevents a tasting submission`, async ({ page }) => {
  const { posts } = await mock(page, { now });
  await page.goto('/glass-comes-back/l-campo');
  await expect(page.locator('#load-status')).toContainText(message);
  await expect(page.locator('#submit')).toBeDisabled();
  await page.locator('#tasting-form').dispatchEvent('submit');
  expect(posts).toHaveLength(0);
  await expect(page.locator('#confirmation')).toBeHidden();
  await expect(page.locator('#tasting-form')).toBeHidden();
  await expect(page.locator('#tasting-intro')).toBeHidden();
  if (now === '2026-10-15T07:00:00Z') {
    await expect(page.getByRole('link', { name: 'pick up a glass' })).toBeVisible();
    await expect(page.locator('#same-visit')).toBeHidden();
    await expect(page.locator('#tasting-rule')).toBeHidden();
    await expect(page.locator('#paper-option')).toBeHidden();
  } else {
    await expect(page.locator('#load-status')).toContainText('See you Tuesday.');
    await expect(page.locator('#same-visit')).toContainText('no separate glass pickup form is needed');
  }
});

test('confirmation expires at the server deadline even with a wrong device clock', async ({ page }) => {
  await page.clock.install({ time: new Date('2001-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2001-01-01T01:00:00Z'));
  const { control } = await mock(page, { now: '2026-09-30T06:59:55Z' });
  await page.goto('/glass-comes-back/l-campo'); await checkIn(page);
  await expect(page.locator('#confirmation')).toBeVisible();
  await expect(page.locator('#confirmation-date')).toHaveText('Tuesday, September 29, 2026');
  control.now = '2026-09-30T07:00:01Z';
  await page.clock.runFor(6000);
  await expect(page.locator('#confirmation')).toBeHidden();
  await expect(page.locator('#form-panel')).toBeVisible();
  await expect(submit(page)).toBeEnabled();
  await checkIn(page);
  await expect(page.locator('#confirmation-date')).toHaveText('Wednesday, September 30, 2026');
});

test('committed confirmation stays visible through slow refreshes, connection failures and app switches', async ({ page }) => {
  await page.clock.install({ time: new Date('2001-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2001-01-01T01:00:00Z'));
  const { control } = await mock(page);
  await page.goto('/glass-comes-back/l-campo'); await checkIn(page);
  await expect(page.locator('#confirmation')).toBeVisible();
  let release;
  control.getGate = new Promise(resolve => { release = resolve; });
  const beforeRefresh = control.getCount;
  await page.clock.runFor(60001);
  await expect.poll(() => control.getCount).toBeGreaterThan(beforeRefresh);
  await expect(page.locator('#confirmation')).toBeVisible();
  await expect(page.locator('#form-panel')).toBeHidden();
  control.getGate = null; release();
  await expect(page.locator('#submit')).toBeEnabled();
  control.getFailed = true;
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.locator('#confirmation')).toBeVisible();
  await page.evaluate(() => {
    delete document.hidden;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.locator('#load-status')).toContainText('paper option');
  await expect(page.locator('#confirmation')).toBeVisible();
  await expect(page.locator('#form-panel')).toBeHidden();
  await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
  await expect(page.locator('#confirmation')).toBeVisible();
  await page.getByRole('button', { name: 'Check in another guest' }).click();
  await expect(page.locator('#confirmation')).toBeHidden();
  await expect(page.locator('#form-panel')).toBeVisible();
  await expect(page.locator('#submit')).toBeDisabled();
});

for (const update of [{ now: '2026-09-30T19:00:00Z' }, { enabled: false }]) {
  test(`successful availability updates can invalidate a receipt: ${JSON.stringify(update)}`, async ({ page }) => {
    const { control } = await mock(page);
    await page.goto('/glass-comes-back/l-campo'); await checkIn(page);
    await expect(page.locator('#confirmation')).toBeVisible();
    Object.assign(control, update);
    await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
    await expect(page.locator('#confirmation')).toBeHidden();
    await expect(page.locator('#form-panel')).toBeVisible();
  });
}

test('offline confirmation still expires, including after sleep pauses the monotonic clock', async ({ page }) => {
  await page.clock.install({ time: new Date('2001-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2001-01-01T01:00:00Z'));
  const { control } = await mock(page, { now: '2026-09-30T06:59:55Z' });
  await page.goto('/glass-comes-back/l-campo'); await checkIn(page);
  await expect(page.locator('#confirmation')).toBeVisible();
  control.getFailed = true;
  // The device calendar is wrong but elapsed wall time catches a sleep interval
  // while performance.now() and the expiry timer remain paused.
  await page.clock.setFixedTime(new Date('2001-01-01T01:00:06Z'));
  await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
  await expect(page.locator('#confirmation')).toBeHidden();
  await expect(page.locator('#form-panel')).toBeVisible();
  await expect(page.locator('#load-status')).toContainText('paper option');
  // Moving the device clock back cannot restore an expired confirmation.
  await page.clock.setFixedTime(new Date('2001-01-01T01:00:00Z'));
  await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
  await expect(page.locator('#confirmation')).toBeHidden();
});

test('date conflict keeps entries and a new submission gets a fresh request identity', async ({ page }) => {
  const { control, posts } = await mock(page, { postStatus: 409, postMessage: 'The tasting date has changed. Please check in again for today.' });
  await page.goto('/glass-comes-back/l-campo'); await checkIn(page);
  await expect(page.getByRole('alert')).toContainText('date has changed');
  await expect(page.getByLabel('Your email', { exact: true })).toHaveValue('guest@example.com');
  control.postStatus = 200; control.now = '2026-09-30T19:00:00Z';
  await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
  await expect(submit(page)).toBeEnabled(); await submit(page).click();
  await expect(page.locator('#confirmation')).toBeVisible();
  expect(posts[1].requestId).not.toBe(posts[0].requestId);
});

for (const patch of [{ success: false }, { restaurant: { slug: 'demitris-taverna', name: "Demitri's Taverna" } }, { validUntil: start }]) {
  test(`uncommitted, wrong-restaurant or expired response is never a confirmation: ${JSON.stringify(patch)}`, async ({ page }) => {
    await mock(page, { result: { ...response('l-campo'), ...patch } });
    await page.goto('/glass-comes-back/l-campo'); await checkIn(page);
    await expect(page.getByRole('alert')).toContainText('paper option');
    await expect(page.locator('#confirmation')).toBeHidden();
    await expect(page.getByLabel('Your email', { exact: true })).toHaveValue('guest@example.com');
  });
}

test('blocked storage, narrow layout and keyboard access keep the short form usable', async ({ page, baseURL, isMobile, browserName }) => {
  const requests = [];
  page.on('request', req => requests.push(req.url()));
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw Error('blocked'); } });
    Object.defineProperty(window, 'sessionStorage', { get() { throw Error('blocked'); } });
  });
  await mock(page);
  await page.goto('/glass-comes-back/calamari-bistro-bar');
  const skip = page.getByRole('link', { name: 'Skip to tasting check-in' });
  if (isMobile && browserName === 'webkit') await skip.focus(); else await page.keyboard.press('Tab');
  await expect(skip).toBeFocused(); await page.keyboard.press('Enter'); await expect(page.locator('main')).toBeFocused();
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overflow ${width}`).toBe(true);
  }
  await checkIn(page);
  await expect(page.locator('#confirmation')).toBeVisible();
  expect(requests.every(url => new URL(url).origin === new URL(baseURL).origin)).toBe(true);
  expect(requests.some(url => /facebook|analytics|googletag|\/api\/(?!glass-tasting)/.test(url))).toBe(false);
});

test('without JavaScript every restaurant still identifies itself and offers the paper fallback', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
  const page = await context.newPage();
  for (const [slug, name] of Object.entries(RESTAURANTS)) {
    await page.goto('/glass-comes-back/' + slug);
    await expect(page.locator('h1')).toContainText(name);
    // Playwright's text locator deliberately excludes noscript content.
    await expect(page.locator('noscript p')).toBeVisible();
    await expect(page.locator('noscript p')).toContainText('Please enable JavaScript to check in, or ask restaurant staff for the paper option.');
    await expect(page.locator('#load-status')).toBeEmpty();
    await expect(page.locator('time')).toHaveCount(6);
    await expect(page.locator('#tasting-form')).toBeHidden();
    await expect(page.locator('#confirmation')).toBeHidden();
    await expect(page.getByRole('link', { name: 'Do Not Sell or Share My Personal Information', exact: true })).toBeVisible();
  }
  await context.close();
});

test('capture the restaurant form and confirmation for review', async ({ page }, info) => {
  test.skip(!process.env.GLASS_TASTING_SCREENSHOTS || info.project.name === 'mobile-webkit');
  const name = 'tasting-' + (info.project.name === 'desktop-chromium' ? 'desktop' : 'mobile');
  await mkdir('.impeccable/review', { recursive: true });
  const { control } = await mock(page); await page.goto('/glass-comes-back/calamari-bistro-bar');
  await expect(submit(page)).toBeEnabled(); await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `.impeccable/review/${name}.png`, fullPage: true });
  await page.getByRole('link', { name: 'See all event details' }).focus();
  await page.screenshot({ path: `.impeccable/review/${name}-focus.png`, fullPage: true });
  await checkIn(page); await expect(page.locator('#confirmation')).toBeVisible();
  await page.screenshot({ path: `.impeccable/review/${name}-confirmation.png`, fullPage: true });
  control.getFailed = true;
  await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
  await expect(page.locator('#load-status')).toContainText('paper option');
  await expect(page.locator('#confirmation')).toBeVisible();
  await page.screenshot({ path: `.impeccable/review/${name}-offline-confirmation.png`, fullPage: true });
});


test('a known closed date names the actual next weekday, while a disabled service stays an error', async ({ page }) => {
  const { control } = await mock(page, { now: '2026-09-28T19:00:00Z' });
  // Public schedule fixture with Wednesday next proves the greeting is derived
  // from that schedule, not hard-coded to the first Tuesday of the campaign.
  await page.route(api, route => route.fulfill({ json: {
    ...tastingState(new Date(control.now)),
    schedule: { today: '2026-09-28', dates: ['2026-09-30'], endDate: '2026-10-14', ended: false },
    restaurant: { slug: 'l-campo', name: 'L Campo' }, enabled: true, available: false,
  } }));
  await page.goto('/glass-comes-back/l-campo');
  await expect(page.locator('#load-status')).toContainText('See you Wednesday. The next tasting is Wednesday, September 30');
  await expect(page.locator('#tasting-form')).toBeHidden();
  await expect(page.locator('#confirmation')).toBeHidden();
  await page.unroute(api);
  await mock(page, { enabled: false });
  await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
  await expect(page.locator('#load-status')).toContainText('Tasting check-in is unavailable');
  await expect(page.locator('#load-status')).not.toContainText('See you');
  await expect(page.locator('#tasting-form')).toBeVisible();
  await expect(page.locator('#submit')).toBeDisabled();
  await expect(page.locator('#confirmation')).toBeHidden();
});
