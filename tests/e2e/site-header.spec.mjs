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

for (const route of ['/', '/events']) {
  test(`compact navigation stays usable by touch and keyboard on ${route}`, async ({ page, browserName }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(route);
    const nav = page.getByRole('navigation', { name: 'Main navigation', exact: true });
    const membership = nav.getByRole('link', { name: 'Explore membership', exact: true });
    const toggle = nav.locator('.site-nav__more summary');
    const partners = nav.getByRole('link', { name: 'Our partners', exact: true });
    const menu = page.locator('.site-nav__more');

    await expect(membership).toBeVisible();
    await expect(partners).toBeHidden();
    await membership.focus();
    await membership.press('Tab');
    await expect(toggle).toBeFocused();
    await toggle.press('Enter');
    await expect(partners).toBeVisible();
    // WebKit's default keyboard policy uses Option+Tab to include links.
    await toggle.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
    await expect(partners).toBeFocused();
    await partners.press('Escape');
    await expect(menu).not.toHaveAttribute('open', '');
    await expect(toggle).toBeFocused();

    await toggle.click();
    await page.locator('h1').click({ position: { x: 5, y: 5 } });
    await expect(partners).toBeHidden();

    await toggle.click();
    const how = nav.getByRole('link', { name: 'How it works', exact: true });
    await how.focus();
    await how.press('Tab');
    await expect(partners).toBeHidden();

    await toggle.click();
    await page.setViewportSize({ width: 1000, height: 900 });
    // CSS can hide the toggle before the media-query change handler runs.
    // Observe the desktop close before resizing back, or WebKit can coalesce
    // the two viewport changes and never deliver the intermediate breakpoint.
    await expect(menu).not.toHaveAttribute('open', '');
    await expect(toggle).toBeHidden();
    await expect(partners).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(partners).toBeHidden();

    for (const width of [320, 390, 760, 860, 861, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(membership).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (width <= 860) {
        const actionBox = await membership.boundingBox();
        const toggleBox = await toggle.boundingBox();
        expect(toggleBox.x).toBeGreaterThanOrEqual(actionBox.x + actionBox.width);
        expect(toggleBox.width).toBeGreaterThanOrEqual(44);
        await toggle.click();
        await expect(partners).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await toggle.click();
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await toggle.click();
    await partners.click();
    await expect(page).toHaveURL(/\/#spots$/);
    await expect(page.locator('#spots')).toBeInViewport();
    await expect(page.locator('.site-nav__more')).not.toHaveAttribute('open', '');
  });
}

test('compact navigation works without JavaScript', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 320, height: 900 } });
  await context.route('**/*', route => new URL(route.request().url()).origin === new URL(baseURL).origin ? route.continue() : route.abort());
  const page = await context.newPage();
  await page.goto(baseURL);
  const nav = page.getByRole('navigation', { name: 'Main navigation', exact: true });
  await expect(nav.getByRole('link', { name: 'Explore membership', exact: true })).toBeVisible();
  await nav.locator('.site-nav__more summary').click();
  await nav.getByRole('link', { name: 'Events', exact: true }).click();
  await expect(page).toHaveURL(/\/events$/);
  await nav.locator('.site-nav__more summary').click();
  await expect(nav.getByRole('link', { name: 'Events', exact: true })).toHaveAttribute('aria-current', 'page');
  await nav.getByRole('link', { name: 'Our partners', exact: true }).click();
  await expect(page).toHaveURL(/\/#spots$/);
  await context.close();
});
