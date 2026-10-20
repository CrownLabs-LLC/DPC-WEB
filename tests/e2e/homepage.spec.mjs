import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

test.beforeEach(async ({ context, page, baseURL }) => {
  const origin = new URL(baseURL).origin;
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/track') return route.fulfill({ status: 202, body: '{}' });
    return url.origin === origin ? route.continue() : route.abort();
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test('mobile Join follows the hero without covering consent or footer links', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const bar = page.locator('#mobile-join');
  await expect(bar).toBeHidden();
  await page.locator('#spots').scrollIntoViewIfNeeded();
  await expect(page.locator('#cookie-banner')).toBeVisible();
  await expect(bar).toBeHidden();
  await page.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect(bar).toBeVisible();
  await expect(bar.getByRole('link')).toHaveAttribute('href', '/join');
  await page.locator('footer').scrollIntoViewIfNeeded();
  await expect(bar).toBeHidden();
  await page.locator('#hero').scrollIntoViewIfNeeded();
  await expect(bar).toBeHidden();
});

test('FAQ answers open from the keyboard and the old pricing anchor still works', async ({ page }) => {
  await page.goto('/#membership');
  await expect(page.locator('#membership')).toBeInViewport();
  const question = page.locator('#faq summary').filter({ hasText: 'Do unused Pours carry over?' });
  await question.focus();
  await question.press('Enter');
  await expect(page.getByText('No. Standard Pours expire at the end of your membership month.', { exact: false })).toBeVisible();
  await question.press('Enter');
  await expect(page.getByText('No. Standard Pours expire at the end of your membership month.', { exact: false })).toBeHidden();
});

test('homepage fits narrow screens, loads its photos and keeps navigation destinations real', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Accept', exact: true }).click();
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const selector of ['#spots', '#how-it-works', '.people', '#circles', '.kit', '#faq']) {
      await page.locator(selector).scrollIntoViewIfNeeded();
    }
  }
  await expect.poll(() => page.locator('main img:visible').evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0))).toBe(true);
  expect(await page.locator('a[href^="#"]').evaluateAll(links => links.every(link => document.getElementById(link.hash.slice(1))))).toBe(true);
  await expect(page.getByRole('link', { name: 'Partner with us', exact: true })).toHaveAttribute('href', 'partners.html');
  expect(errors).toEqual([]);
  if (process.env.HOMEPAGE_CAPTURE === '1' && testInfo.project.name === 'desktop-chromium') {
    await mkdir('.impeccable/review', { recursive: true });
    for (const [name, width, height] of [['desktop', 1440, 900], ['mobile', 390, 844]]) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ path: `.impeccable/review/${name}.png` });
      await page.screenshot({ path: `.impeccable/review/${name}-full.png`, fullPage: true });
      for (const [part, selector] of [['steps', '.how'], ['pricing', '#circles'], ['kit', '.kit'], ['close', '.closing']]) {
        await page.locator(selector).screenshot({ path: `.impeccable/review/${name}-${part}.png` });
      }
      for (const [part, selector] of [['header', '.site-header nav a:visible'], ['faq', '#faq summary']]) {
        const control = page.locator(selector).first();
        await control.focus();
        await page.keyboard.press('Shift+Tab');
        await page.keyboard.press('Tab');
        await expect(control).toBeFocused();
        expect(await control.evaluate(element => element.matches(':focus-visible'))).toBe(true);
        await page.screenshot({ path: `.impeccable/review/${name}-focus-${part}.png` });
      }
    }
  }
});

test('without JavaScript the pricing links and all FAQ answers remain usable', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  await context.route('**/*', route => new URL(route.request().url()).origin === new URL(baseURL).origin ? route.continue() : route.abort());
  const page = await context.newPage();
  await page.goto(baseURL);
  await expect(page.locator('#circles a[data-join-cta]')).toHaveCount(6);
  await page.locator('#faq summary').filter({ hasText: 'Can I pause my membership?' }).click();
  await expect(page.getByText('Membership pause is not currently available.', { exact: false })).toBeVisible();
  await page.getByRole('link', { name: 'Join annual: Cellar Circle', exact: true }).click();
  await expect(page).toHaveURL(/\/join\?circle=cellar&billing=annual$/);
  await context.close();
});
