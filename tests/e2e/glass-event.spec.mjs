import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { TASTING_DATES } from '../../api/lib/glass-campaign.js';

test.beforeEach(async ({ context, baseURL, page }) => {
  const origin = new URL(baseURL).origin;
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.clock.setFixedTime(new Date('2026-09-24T19:00:00Z'));
});

test('event dates agree with the server schedule and all restaurant names are present', async ({ page }) => {
  const response = await page.goto('/glass-comes-back');
  expect(response.status()).toBe(200);
  await expect(page).toHaveTitle('The Glass Comes Back | Downtown Pour Collective');
  expect(await page.locator('time').evaluateAll(nodes => nodes.map(node => node.dateTime))).toEqual(TASTING_DATES);
  for (const date of TASTING_DATES) {
    const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' }).format(new Date(date + 'T12:00:00Z'));
    await expect(page.locator(`li:has(time[datetime="${date}"])`)).toContainText(weekday);
  }
  await expect(page.getByRole('list', { name: 'Participating restaurants' }).getByRole('listitem')).toHaveText([
    "Demitri's Taverna", 'Swirl on the Square', 'Calamari Bistro & Bar', 'L Campo',
  ]);
  await expect(page.getByText(/No tasting on October 7/)).toBeVisible();
  await expect(page.getByText(/During each restaurant's normal dining hours/)).toBeVisible();
  await expect(page.getByText(/Restaurant check-in is being prepared/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'On a tasting date.' })).toBeVisible();
});

test('the complete invitation works without JavaScript and its destinations resolve', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
  const page = await context.newPage();
  await page.goto('/glass-comes-back');
  await expect(page.getByRole('heading', { name: 'The Glass Comes Back.' })).toBeVisible();
  await expect(page.getByText(/same dining visit/)).toBeVisible();
  await expect(page.getByText(/Restaurant check-in is being prepared/)).toBeVisible();
  await expect(page.getByText(/You don't need to dine to pick up a glass/)).toBeVisible();
  await expect(page.getByText(/checkbox starts checked and is optional/)).toBeVisible();
  await expect(page.getByText(/paper check-in option/)).toBeVisible();
  await expect(page.getByText(/not the organizer, host, or sponsor/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Contact Nick · (925) 488-4889' })).toHaveAttribute('href', 'tel:+19254884889');
  await expect(page.getByRole('link', { name: 'Need a hand?' })).toHaveAttribute('href', 'mailto:hello@downtownpourcollective.com');
  await expect(page.getByRole('link', { name: 'Pick up a glass', exact: true })).toHaveAttribute('href', '/glass-pickup');
  const links = await page.locator('a[href^="/"]').evaluateAll(nodes => [...new Set(nodes.map(node => node.getAttribute('href')))]);
  for (const path of links) expect((await context.request.get(path)).status(), path).toBe(200);
  await expect(page.locator('input, form')).toHaveCount(0);
  await context.close();
});

test('keyboard anchors, narrow viewports and privacy controls work without trackers or API calls', async ({ page, baseURL, isMobile, browserName }) => {
  const requests = [];
  page.on('request', request => requests.push(request.url()));
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw Error('blocked storage'); } });
    Object.defineProperty(window, 'sessionStorage', { get() { throw Error('blocked storage'); } });
  });
  await page.goto('/glass-comes-back');
  // iOS WebKit's default hardware-keyboard mode omits links from Tab order.
  // Explicit focus still verifies native anchor activation on that device.
  if (isMobile && browserName === 'webkit') await page.getByRole('link', { name: 'Skip to event details' }).focus();
  else await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to event details' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('main')).toBeFocused();
  await page.getByRole('link', { name: 'Find a restaurant' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#restaurants')).toBeFocused();
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overflow at ${width}`).toBe(true);
  }
  await expect(page.getByRole('link', { name: 'Do Not Sell or Share My Personal Information', exact: true })).toBeVisible();
  expect(requests.every(url => new URL(url).origin === new URL(baseURL).origin)).toBe(true);
  expect(requests.some(url => /\/api\/|facebook|analytics|googletag/.test(url))).toBe(false);
});

test('the invitation ends at the Pacific date boundary while pickup remains available', async ({ page }) => {
  // October 15 in UTC is still the final tasting day in Livermore.
  await page.clock.setFixedTime(new Date('2026-10-15T06:59:59Z'));
  await page.goto('/glass-comes-back');
  await expect(page.locator('#tasting-instructions')).toBeVisible();
  await expect(page.getByText(/These tastings have ended/)).toHaveCount(0);

  await page.clock.setFixedTime(new Date('2026-10-15T07:00:00Z'));
  await page.reload();
  await expect(page.getByText(/These tastings have ended/)).toBeVisible();
  await expect(page.locator('#event-readiness, #tasting-instructions, #same-visit')).toHaveCount(3);
  for (const id of ['event-readiness', 'tasting-instructions', 'same-visit']) await expect(page.locator('#' + id)).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Our participating restaurants.' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'See the restaurants' })).toHaveAttribute('href', '#restaurants');
  await expect(page.getByRole('link', { name: 'Pick up a glass', exact: true })).toBeVisible();
  await expect(page.getByText(/while supplies last/, { exact: false }).last()).toBeVisible();
  await expect(page.locator('time')).toHaveCount(5);
});

test('capture the event page at desktop and phone sizes for review', async ({ page }, testInfo) => {
  test.skip(!process.env.GLASS_EVENT_SCREENSHOTS || testInfo.project.name === 'mobile-webkit');
  const name = testInfo.project.name === 'desktop-chromium' ? 'desktop' : 'mobile';
  await mkdir('.impeccable/review', { recursive: true });
  await page.goto('/glass-comes-back');
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `.impeccable/review/${name}.png`, fullPage: true });
  await page.clock.setFixedTime(new Date('2026-10-15T07:00:00Z'));
  await page.reload();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `.impeccable/review/${name}-ended.png`, fullPage: true });
});
