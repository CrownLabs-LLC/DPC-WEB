import { test, expect } from '@playwright/test';

test.beforeEach(async ({ context, page, baseURL }) => {
  const origin = new URL(baseURL).origin;
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/track') return route.fulfill({ status: 202, body: '{}' });
    return url.origin === origin ? route.continue() : route.abort();
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test('visitors can find Events, explore the archive and return to membership', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Accept', exact: true }).click();
  const moreNavigation = page.locator('.site-nav__more summary');
  if (await moreNavigation.isVisible()) await moreNavigation.click();
  await page.getByRole('navigation', { name: 'Main navigation', exact: true }).getByRole('link', { name: 'Events', exact: true }).click();
  await expect(page).toHaveURL(/\/events$/);
  await expect(page.locator('.site-header [aria-current="page"]')).toHaveText(['Events', 'Events']);
  await page.getByRole('link', { name: 'Upcoming gatherings', exact: true }).click();
  await expect(page.locator('#upcoming')).toBeInViewport();
  await expect(page.locator('.upcoming__status')).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: 'Add to calendar', exact: true }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('social-pour-2026-11-18.ics');
  const calendar = await page.request.get('/assets/events/social-pour-2026-11-18.ics');
  expect(calendar.ok()).toBe(true);
  const calendarText = await calendar.text();
  // November is Pacific standard time: the local evening is the next UTC day.
  expect(calendarText).toContain('DTSTART:20261119T010000Z');
  expect(calendarText).toContain('DTEND:20261119T040000Z');
  expect(calendarText).toContain('LOCATION:Wood Family Vineyards');
  await page.getByRole('link', { name: 'Explore past events', exact: true }).click();
  await expect(page.locator('#past-events')).toBeInViewport();
  const album = page.locator('.event-album summary').last();
  await album.focus();
  await album.press('Enter');
  await expect(page.locator('.event-album__photos')).toBeVisible();
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await expect.poll(() => page.locator('main img:visible').evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0))).toBe(true);
  expect(await page.locator('a[href^="#"]').evaluateAll(links => links.every(link => document.getElementById(link.hash.slice(1))))).toBe(true);
  await page.getByRole('link', { name: 'Explore DPC membership', exact: true }).click();
  await expect(page).toHaveURL(/\/#circles$/);
  await expect(page.locator('#circles')).toBeInViewport();
  expect(errors).toEqual([]);
});

test('event photo stories and membership navigation work without JavaScript', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  await context.route('**/*', route => new URL(route.request().url()).origin === new URL(baseURL).origin ? route.continue() : route.abort());
  const page = await context.newPage();
  await page.goto(`${baseURL}/events`);
  await page.locator('.event-album summary').first().click();
  await expect(page.getByAltText('Nick Martinez and Mayor John Marchand holding the Declaration of Welcome', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Explore DPC membership', exact: true }).click();
  await expect(page.locator('#circles a[data-join-cta]')).toHaveCount(6);
  await context.close();
});
