import { test, expect } from '@playwright/test';

const CHECKOUT_ENDPOINT = 'https://ebiuspbgzggrdiaswpcc.supabase.co/functions/v1/circle-checkout';
const CHECKOUT_URL = 'https://checkout.stripe.test/c/pay/cs_test_navigation_gate';

test('a successful checkout handoff reaches Stripe and records browser departure', async ({ page, context }) => {

  await page.route('https://challenges.cloudflare.com/turnstile/**', async (route) => {
    await route.fulfill({
      contentType: 'text/javascript',
      body: `window.turnstile={render:function(_,opts){setTimeout(function(){opts.callback('test-token')},0);return 'test-widget'},reset:function(){}};`,
    });
  });
  await page.route(CHECKOUT_ENDPOINT, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { checkout_url: CHECKOUT_URL, reused: false } }),
    });
  });
  await page.route('**/api/track', async (route) => {
    await route.fulfill({ status: 202, contentType: 'application/json', body: '{"stored":true}' });
  });
  await page.route('https://checkout.stripe.test/**', async (route) => {
    await route.fulfill({ contentType: 'text/html', body: '<h1>Stripe Checkout reached</h1>' });
  });

  await page.goto('/join');
  await page.evaluate(() => {
    const original = window.DPCAnalytics.track;
    window.DPCAnalytics.track = function (event, params) {
      const events = JSON.parse(localStorage.getItem('__dpc_e2e_events') || '[]');
      events.push({ event, ...(params || {}) });
      localStorage.setItem('__dpc_e2e_events', JSON.stringify(events));
      return original.call(window.DPCAnalytics, event, params);
    };
  });
  await page.getByText('Beer drinkers', { exact: true }).click();
  await page.getByText('Monthly', { exact: true }).click();
  await page.locator('#firstName').fill('Checkout');
  await page.locator('#lastName').fill('Smoke');
  await page.locator('#email').fill('checkout-smoke@example.invalid');
  await page.locator('label.check').click();

  await Promise.all([
    page.waitForURL('https://checkout.stripe.test/**'),
    page.locator('#submit-btn').click(),
  ]);
  await expect(page.getByRole('heading', { name: 'Stripe Checkout reached' })).toBeVisible();
  const lifecycleEvents = async () => {
    const state = await context.storageState();
    const origin = state.origins.find((item) => item.origin === 'http://127.0.0.1:4173');
    const stored = origin?.localStorage.find((item) => item.name === '__dpc_e2e_events')?.value || '[]';
    return JSON.parse(stored);
  };
  await expect.poll(async () => (await lifecycleEvents()).map((event) => event.event))
    .toContain('join_checkout_departed');

  const lifecycle = (await lifecycleEvents()).filter((event) => [
    'join_submit',
    'join_checkout_ready',
    'join_checkout_departed',
  ].includes(event.event));
  expect(lifecycle.map((event) => event.event)).toEqual([
    'join_submit',
    'join_checkout_ready',
    'join_checkout_departed',
  ]);
  expect(new Set(lifecycle.map((event) => event.flow_id)).size).toBe(1);
  expect(lifecycle[0].flow_id).toMatch(/^[0-9a-f-]{36}$/);
});

test('a blocked checkout navigation leaves a visible native recovery link and records the stall', async ({ page }) => {
  await page.route('https://challenges.cloudflare.com/turnstile/**', async (route) => {
    await route.fulfill({
      contentType: 'text/javascript',
      body: `window.turnstile={render:function(_,opts){setTimeout(function(){opts.callback('test-token')},0);return 'test-widget'},reset:function(){}};`,
    });
  });
  await page.route(CHECKOUT_ENDPOINT, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { checkout_url: CHECKOUT_URL, reused: false } }),
    });
  });
  await page.route('**/api/track', async (route) => {
    await route.fulfill({ status: 202, contentType: 'application/json', body: '{"stored":true}' });
  });
  await page.goto('/join');
  await page.evaluate(() => {
    window.DPC_JOIN.checkoutStallMs = 50;
    window.DPC_JOIN.navigateToCheckout = function () {};
    const original = window.DPCAnalytics.track;
    window.__dpcEvents = [];
    window.DPCAnalytics.track = function (event, params) {
      window.__dpcEvents.push({ event, ...(params || {}) });
      return original.call(window.DPCAnalytics, event, params);
    };
  });
  await page.getByText('Beer drinkers', { exact: true }).click();
  await page.getByText('Monthly', { exact: true }).click();
  await page.locator('#firstName').fill('Checkout');
  await page.locator('#lastName').fill('Recovery');
  await page.locator('#email').fill('checkout-recovery@example.invalid');
  await page.locator('label.check').click();
  await page.locator('#submit-btn').click();

  const fallback = page.locator('#checkout-fallback');
  await expect(fallback).toBeVisible();
  await expect(fallback).toHaveAttribute('href', CHECKOUT_URL);
  await expect(page.locator('#submit-btn')).toBeHidden();
  await expect(page.locator('#form-error')).toContainText('did not open automatically');
  const events = await page.evaluate(() => window.__dpcEvents || []);
  expect(events.map((event) => event.event)).toContain('join_checkout_stalled');
});
