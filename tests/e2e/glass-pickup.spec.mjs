import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
const schedule = { today: '2026-09-24', dates: ['2026-09-29', '2026-09-30', '2026-10-06', '2026-10-13', '2026-10-14'], endDate: '2026-10-14', ended: false };
test.beforeEach(async ({ context, page }) => {
  await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.route('**/api/glass-pickup', route => route.fulfill({ json: route.request().method() === 'GET' ? { available: true, schedule } : { success: true, schedule } }));
});

test('email-only pickup, optional marketing, confirmation and repeat guest', async ({ page }) => {
  await page.goto('/glass-pickup');
  await expect(page.getByRole('button', { name: 'Confirm glass pickup' })).toBeEnabled();
  await expect(page.getByRole('checkbox')).toBeChecked();
  expect(await page.locator('input').count()).toBe(2);
  await page.getByLabel('Your email', { exact: true }).fill('guest@example.com');
  await page.getByRole('checkbox').uncheck();
  const request = page.waitForRequest(r => r.url().endsWith('/api/glass-pickup') && r.method() === 'POST');
  await page.getByRole('button', { name: 'Confirm glass pickup' }).click();
  expect((await request).postDataJSON()).toMatchObject({ email: 'guest@example.com', marketingOptIn: false, marketingChanged: true });
  await expect(page.getByRole('heading', { name: "You're ready for pickup." })).toBeFocused();
  await expect(page.getByText('Show this screen to the person handing out glasses.')).toBeVisible();
  await expect(page.getByText('October 14', { exact: true })).toBeVisible();
  expect(page.url()).not.toContain('guest');
  expect(await page.evaluate(() => ({ local: JSON.stringify(localStorage), session: JSON.stringify(sessionStorage) }))).toEqual({ local: '{}', session: '{}' });
  await page.getByRole('button', { name: 'Check in another guest' }).click();
  await expect(page.getByLabel('Your email', { exact: true })).toHaveValue('');
  await expect(page.getByRole('checkbox')).toBeChecked();
});

test('retry retains request identity and input; changed intent gets a new request', async ({ page }) => {
  const ids = []; let fail = true;
  await page.route('**/api/glass-pickup', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { available: true, schedule } });
    ids.push(route.request().postDataJSON().requestId);
    return route.fulfill({ status: fail ? 503 : 200, json: fail ? { success: false } : { success: true, schedule } });
  });
  await page.goto('/glass-pickup');
  await page.getByLabel('Your email', { exact: true }).fill('retry@example.com');
  const submit = page.getByRole('button', { name: 'Confirm glass pickup' });
  await submit.click(); await expect(page.getByRole('alert')).toContainText('paper option');
  await expect(page.getByLabel('Your email', { exact: true })).toHaveValue('retry@example.com');
  await submit.click(); await expect(page.getByRole('alert')).toBeVisible();
  await page.getByRole('checkbox').uncheck(); fail = false;
  await submit.click(); await expect(page.getByRole('heading', { name: "You're ready for pickup." })).toBeVisible();
  expect(ids[0]).toBe(ids[1]); expect(ids[2]).not.toBe(ids[1]);
});

test('pickup remains usable after tastings end without expired invitations', async ({ page }) => {
  const ended = { today: '2026-10-15', dates: [], endDate: '2026-10-14', ended: true };
  await page.route('**/api/glass-pickup', route => route.fulfill({ json: route.request().method() === 'GET' ? { available: true, schedule: ended } : { success: true, schedule: ended } }));
  await page.goto('/glass-pickup');
  await page.getByLabel('Your email', { exact: true }).fill('later@example.com');
  await page.getByRole('button', { name: 'Confirm glass pickup' }).click();
  await expect(page.getByRole('heading', { name: "You're ready for pickup." })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'The tastings have ended.' })).toBeVisible();
  await expect(page.locator('#tasting-description')).toContainText('ended on October 14, 2026');
  await expect(page.locator('#tasting-instructions')).toBeHidden(); await expect(page.locator('#dates')).toBeHidden();
});

test('background throttle preserves entries and retry identity without a guest challenge', async ({ page }) => {
  const submissions = [];
  await page.route('**/api/glass-pickup', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { available: true, schedule } });
    submissions.push(route.request().postDataJSON());
    return route.fulfill(submissions.length === 1
      ? { status: 429, headers: { 'Retry-After': '60' }, json: { success: false, message: 'A lot of guests are checking in right now. Please wait a minute, then try again. Your entries are still here.' } }
      : { json: { success: true, schedule } });
  });
  await page.goto('/glass-pickup');
  await page.getByLabel('Your email', { exact: true }).fill('limited@example.com');
  await page.getByRole('checkbox').uncheck();
  await page.getByRole('button', { name: 'Confirm glass pickup' }).click();
  await expect(page.getByRole('alert')).toContainText('wait a minute');
  await expect(page.getByLabel('Your email', { exact: true })).toHaveValue('limited@example.com');
  await expect(page.getByRole('checkbox')).not.toBeChecked();
  await expect(page.locator('#confirmation')).toBeHidden();
  await page.getByRole('button', { name: 'Confirm glass pickup' }).click();
  await expect(page.getByRole('heading', { name: "You're ready for pickup." })).toBeVisible();
  expect(submissions[1]).toEqual(submissions[0]);
});

test('a mistyped domain shows the email correction instead of an outage', async ({ page }) => {
  let postedEmail;
  await page.route('**/api/glass-pickup', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { available: true, schedule } });
    postedEmail = route.request().postDataJSON().email;
    return route.fulfill({ status: 400, json: { success: false, message: 'Enter a valid email address to continue.' } });
  });
  await page.goto('/glass-pickup');
  await page.getByLabel('Your email', { exact: true }).fill('jane@gmail');
  await page.getByRole('button', { name: 'Confirm glass pickup' }).click();
  expect(postedEmail).toBe('jane@gmail');
  await expect(page.getByRole('alert')).toHaveText('Enter a valid email address to continue.');
  await expect(page.getByLabel('Your email', { exact: true })).toHaveValue('jane@gmail');
  await expect(page.locator('#confirmation')).toBeHidden();
});

for (const status of [413, 415, 503]) {
  test(`request error ${status} exposes only appropriate guest guidance`, async ({ page }) => {
    const message = status === 413 ? 'Please check your email and try again.'
      : status === 415 ? 'Use the glass pickup form.' : 'Private upstream failure: contact@example.com';
    await page.route('**/api/glass-pickup', route => route.fulfill(route.request().method() === 'GET'
      ? { json: { available: true, schedule } } : { status, json: { success: false, message } }));
    await page.goto('/glass-pickup');
    await page.getByLabel('Your email', { exact: true }).fill('guest@example.com');
    await page.getByRole('button', { name: 'Confirm glass pickup' }).click();
    if (status < 500) await expect(page.getByRole('alert')).toHaveText(message);
    else {
      await expect(page.getByRole('alert')).toContainText('Pickup check-in is unavailable');
      await expect(page.getByRole('alert')).not.toContainText('contact@example.com');
    }
    await expect(page.locator('#confirmation')).toBeHidden();
  });
}

test('ended copy follows a changed server schedule without a client date edit', async ({ page }) => {
  const extended = { today: '2026-10-22', dates: [], endDate: '2026-10-21', ended: true };
  await page.route('**/api/glass-pickup', route => route.fulfill({ json: { available: true, schedule: extended } }));
  await page.goto('/glass-pickup');
  await expect(page.locator('#tasting-description')).toContainText('ended on October 21, 2026');
  await expect(page.locator('#tasting-description')).not.toContainText('October 14');
});

test('server unavailable never shows success and can be retried', async ({ page }) => {
  await page.route('**/api/glass-pickup', route => route.fulfill({ json: { available: false, schedule } }));
  await page.goto('/glass-pickup');
  await expect(page.getByRole('button', { name: 'Check-in unavailable' })).toBeDisabled();
  await expect(page.getByRole('status')).toContainText('paper option');
  await expect(page.locator('#confirmation')).toBeHidden();
});

test('no-JavaScript fallback is readable and never submits email through a URL', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4173/glass-pickup');
  await expect(page.getByText(/Please enable JavaScript to check in/)).toBeVisible();
  await expect(page.locator('form')).toBeHidden();
  await expect(page.getByRole('link', { name: 'Do Not Sell or Share My Personal Information', exact: true })).toBeVisible();
  await context.close();
});

test('keyboard and small viewport access, no contact analytics or storage dependency', async ({ page }) => {
  const requests = [];
  page.on('request', req => requests.push(req.url()));
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw Error('blocked'); } });
    Object.defineProperty(window, 'sessionStorage', { get() { throw Error('blocked'); } });
  });
  await page.goto('/glass-pickup');
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.getByLabel('Your email', { exact: true }).fill('keyboard@example.com');
  const checkbox = page.getByRole('checkbox'); await checkbox.focus(); await checkbox.press('Space');
  await page.getByRole('button', { name: 'Confirm glass pickup' }).focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: "You're ready for pickup." })).toBeFocused();
  expect(requests.some(url => /\/api\/track|facebook|analytics|keyboard@/.test(url))).toBe(false);
});

test('capture form and confirmation at the shipped viewport', async ({ page }, testInfo) => {
  test.skip(!process.env.GLASS_SCREENSHOTS || testInfo.project.name === 'mobile-webkit');
  // Only the explicit visual round captures images; regular checks are assertions.
  const name = testInfo.project.name === 'desktop-chromium' ? 'desktop' : 'mobile';
  await mkdir('.impeccable/review', { recursive: true });
  await page.goto('/glass-pickup'); await expect(page.getByRole('button', { name: 'Confirm glass pickup' })).toBeEnabled();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `.impeccable/review/${name}.png`, fullPage: true });
  await page.getByLabel('Your email', { exact: true }).fill('preview@example.com');
  await page.getByRole('button', { name: 'Confirm glass pickup' }).click();
  await expect(page.getByRole('heading', { name: "You're ready for pickup." })).toBeVisible();
  await page.screenshot({ path: `.impeccable/review/${name}-confirmation.png`, fullPage: true });
});
