import { test, expect } from '@playwright/test';

const CHECKOUT_ENDPOINT = 'https://ebiuspbgzggrdiaswpcc.supabase.co/functions/v1/circle-checkout';
const CHECKOUT_URL = 'https://checkout.stripe.test/c/pay/cs_test_optional_kit_handoff';
const CIRCLES = [
  { key: 'tap', label: 'Beer drinkers', monthly: 59, annual: 590 },
  { key: 'cellar', label: 'Wine drinkers', monthly: 69, annual: 690 },
  { key: 'reserve', label: 'Cocktail & spirits', monthly: 79, annual: 790 },
];

async function setup(page, context, baseURL) {
  const submissions = [];
  // Exercise the website's actual navigation without contacting production or
  // pretending this fixture is Stripe payment/optional-item evidence.
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.origin === new URL(baseURL).origin ? route.continue() : route.abort();
  });
  await page.route('https://challenges.cloudflare.com/turnstile/**', route => route.fulfill({
    contentType: 'text/javascript',
    body: `window.turnstile={render:function(_,o){setTimeout(function(){o.callback('test-token')},0);return 'widget'},reset:function(){}};`,
  }));
  await page.route('**/api/legal-versions*', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ tos: '3.0', privacy: '4.2', memberTerms: '3.0', autoRenewalTerms: '3.0' }),
  }));
  await page.route('**/api/track', route => route.fulfill({ status: 202, body: '{"stored":true}' }));
  await page.route(CHECKOUT_ENDPOINT, route => {
    submissions.push(route.request().postDataJSON());
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({
      success: true, data: { checkout_url: CHECKOUT_URL, reused: false },
    }) });
  });
  await page.route(CHECKOUT_URL, route => route.fulfill({
    contentType: 'text/html',
    body: `<h1>Checkout handoff fixture</h1><a href="${baseURL}/subscription-cancelled">Cancel checkout</a>`,
  }));
  return submissions;
}

async function choose(page, circle, interval) {
  const circleInput = page.locator(`input[name="circle"][value="${circle.key}"]`);
  const intervalInput = page.locator(`input[name="billingInterval"][value="${interval}"]`);
  await page.locator('label.circle-opt').filter({ has: circleInput }).click();
  await expect(circleInput).toBeChecked();
  await page.locator('label.interval-opt').filter({ has: intervalInput }).click();
  await expect(intervalInput).toBeChecked();
}

async function fillDetails(page) {
  await page.locator('#firstName').fill('Optional');
  await page.locator('#lastName').fill('Kit');
  await page.locator('#email').fill('optional-kit@example.invalid');
  await page.locator('label.check').click();
}

for (const circle of CIRCLES) {
  for (const interval of ['monthly', 'annual']) {
    test(`${circle.key} ${interval} starts at membership only and hands off the selected plan`, async ({ page, context, baseURL }, testInfo) => {
      const submissions = await setup(page, context, baseURL);
      await page.goto('/join');
      await choose(page, circle, interval);
      const summary = page.locator('#order-summary');
      await expect(summary).toContainText(`Due today: $${circle[interval]}.`);
      await expect(summary).toContainText('optional Member Welcome Kit');
      await expect(summary).toContainText('one-time $49, with no added kit tax');
      await expect(summary).not.toContainText(`Due today: $${circle[interval] + 49}.`);
      await expect(page.locator('.deposit-explainer')).toContainText('You can remove it before paying');
      await fillDetails(page);
      if (circle.key === 'tap' && interval === 'monthly') {
        await page.locator('#order-summary').screenshot({ path: testInfo.outputPath('join-membership-only.png') });
      }
      await page.locator('#submit-btn').click();
      await expect(page).toHaveURL(CHECKOUT_URL);
      await expect(page.getByRole('heading', { name: 'Checkout handoff fixture' })).toBeVisible();
      expect(submissions).toHaveLength(1);
      expect(submissions[0]).toMatchObject({ circle: circle.key, billingInterval: interval, offerType: 'standard' });
      expect(Object.keys(submissions[0]).some(key => /kit|fee|amount|price/i.test(key))).toBe(false);
    });
  }
}

test('changing Circle and billing interval updates only the membership total', async ({ page, context, baseURL }) => {
  await setup(page, context, baseURL);
  await page.goto('/join');
  for (const circle of CIRCLES) {
    for (const interval of ['annual', 'monthly']) {
      await choose(page, circle, interval);
      await expect(page.locator('#order-summary')).toContainText(`Due today: $${circle[interval]}.`);
    }
  }
});

test('browser back and cancel return to membership-only signup without another submission', async ({ page, context, baseURL }) => {
  const submissions = await setup(page, context, baseURL);
  await page.goto('/join');
  await choose(page, CIRCLES[0], 'monthly');
  await fillDetails(page);
  await page.locator('#submit-btn').click();
  await expect(page).toHaveURL(CHECKOUT_URL);
  await page.goBack();
  await expect(page).toHaveURL(/\/join$/);
  await choose(page, CIRCLES[0], 'monthly');
  await expect(page.locator('#order-summary')).toContainText('Due today: $59.');
  expect(submissions).toHaveLength(1);
  await page.goForward();
  await expect(page).toHaveURL(CHECKOUT_URL);
  await page.getByRole('link', { name: 'Cancel checkout' }).click();
  await expect(page).toHaveURL(/\/subscription-cancelled$/);
  await page.getByRole('link', { name: 'Return to Join', exact: true }).click();
  await expect(page).toHaveURL(/\/join$/);
  await choose(page, CIRCLES[1], 'annual');
  await expect(page.locator('#order-summary')).toContainText('Due today: $690.');
  expect(submissions).toHaveLength(1);
});

test('home copy and FAQ describe an optional one-time kit; success makes no kit promise', async ({ page, context, baseURL }, testInfo) => {
  await setup(page, context, baseURL);
  await page.goto('/');
  await expect(page.locator('.kit__body')).toContainText('optional Member Welcome Kit');
  await expect(page.locator('.kit__body')).toContainText('The Kit costs $49 once, with no added kit tax.');
  await page.locator('.kit__body').screenshot({ path: testInfo.outputPath('home-optional-kit.png') });
  const faq = await page.locator('script[type="application/ld+json"]').evaluateAll(scripts =>
    scripts.map(script => JSON.parse(script.textContent)).find(data => data['@type'] === 'FAQPage'));
  for (const question of faq.mainEntity.filter(item => /cost|included/.test(item.name))) {
    expect(question.acceptedAnswer.text).toContain('optional Member Welcome Kit');
  }
  await page.goto('/subscription-success');
  await expect(page.locator('.confirm__body')).not.toContainText(/kit|setup fee/i);
  await expect(page.locator('.confirm__body')).toContainText('confirming your membership');
});

for (const { width, fallbackFonts = false } of [
  { width: 320 },
  { width: 1280 },
  { width: 320, fallbackFonts: true },
]) {
  test(`optional kit disclosure and total fit at ${width}px${fallbackFonts ? ' with wider fallback text' : ''} without accepting cookies`, async ({ page, context, baseURL }) => {
    await setup(page, context, baseURL);
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/join');
    if (fallbackFonts) {
      // Font fallback and larger text must not let the renewal note widen the
      // mobile layout. The cookie notice and all click actionability remain on.
      await page.addStyleTag({ content: `
        :root { --support: Verdana, sans-serif; --body: Verdana, sans-serif; }
        .interval-opt__note { font-size: 14px; }
      ` });
    }
    await expect(page.locator('#cookie-banner')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await choose(page, CIRCLES[2], 'monthly');
    await expect(page.locator('#order-summary')).toContainText('Due today: $79.');
    await choose(page, CIRCLES[2], 'annual');
    await expect(page.locator('#order-summary')).toContainText('Due today: $790.');
    for (const selector of ['.interval-opt', '.interval-opt__card', '#order-summary', '.deposit-explainer', '#offer-fineprint']) {
      const boxes = await page.locator(selector).evaluateAll(elements => elements.map(el => {
        const rect = el.getBoundingClientRect();
        return { left: rect.left, right: rect.right, scroll: el.scrollWidth, width: el.clientWidth };
      }));
      for (const bounds of boxes) {
        expect(bounds.left).toBeGreaterThanOrEqual(0);
        expect(bounds.right).toBeLessThanOrEqual(width);
        expect(bounds.scroll).toBeLessThanOrEqual(bounds.width + 1);
      }
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await expect(page.locator('#cookie-banner')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('dpc_cookie_consent'))).toBeNull();
  });
}
