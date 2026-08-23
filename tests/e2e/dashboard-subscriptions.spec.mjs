import { test, expect } from '@playwright/test';

const OVERVIEW = {
  totals: {
    active: 9,
    past_due: 4,
    cancelled: 2,
    paused: 1,
    terminated: 3,
    unique_active_members: 7,
  },
  new_paid: { h24: 1, d7: 3, d30: 8 },
  by_circle: [
    { circle: 'tap', interval: 'monthly', offer_type: 'standard', count: 4 },
    { circle: 'cellar', interval: 'annual', offer_type: 'founding', count: 3 },
    { circle: 'reserve', interval: 'monthly', offer_type: 'unknown', count: 2 },
  ],
  payment_verification: { verified: 11, missing: 2 },
  dunning: {
    in_dunning: 4,
    attempts: { zero: 2, one: 0, two: 1, three: 0, four_plus: 1 },
    next_retry_24h: 1,
    retry_overdue: 1,
    retries_exhausted: 1,
    grace_expiring_7d: 1,
  },
  access: { cancelled_with_access: 1, ending_7d: 1 },
  renewals: { due_7d: 2 },
};

function dashboardPayload() {
  return {
    generated_at: '2048-08-22T19:00:00.000Z',
    days: 30,
    subscription_overview: OVERVIEW,
    funnel: {
      configured: true,
      daily: [
        { date: '2048-08-21', visits: 12, checkout_attempts: 3, confirmations: 2 },
        { date: '2048-08-22', visits: 18, checkout_attempts: 5, confirmations: 3 },
      ],
      totals: {
        visits: 30,
        confirmations: 5,
        join_errors: 1,
        join_error_codes: { network: 1 },
        join_submits: 8,
        checkout_ready: 7,
        checkout_departed: 6,
        checkout_fallback_clicks: 1,
        checkout_stalled: 1,
      },
      prev: {
        visits: 20,
        confirmations: 3,
        join_errors: 2,
        join_submits: 5,
        checkout_ready: 5,
        checkout_departed: 4,
        checkout_fallback_clicks: 1,
        checkout_stalled: 2,
      },
      truncated: false,
    },
    alerts: { undelivered_events: [], webhook_errors: [] },
    health: [
      { name: 'Supabase reachable', ok: true, detail: '' },
      { name: 'Stripe key can read subscriptions', ok: true, detail: '' },
    ],
  };
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('dpc_dashboard_token', 'e2e-dashboard-token');
  });
  await page.route('**/api/dashboard-data?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(dashboardPayload()),
    });
  });
});

test('subscription operations lead the dashboard without deposit or member PII views', async ({ page }) => {
  await page.goto('/dashboard');

  await expect(page.getByRole('heading', { name: 'Subscriber health' })).toBeVisible();
  const active = page.locator('#subscriber-kpis .label').filter({ hasText: /^Active memberships$/ }).locator('..');
  await expect(active).toContainText('9');
  await expect(active).toContainText('7 unique subscribers');

  await expect(page.locator('#subscription-actions')).toContainText('Retries exhausted');
  await expect(page.locator('#subscription-actions')).toContainText('Other dunning states');
  await expect(page.locator('#subscription-actions')).toContainText('first attempt not scheduled');

  await expect(page.getByRole('heading', { name: 'Membership mix' })).toBeVisible();
  await expect(page.locator('#membership-mix')).toContainText('Tap');
  await expect(page.locator('#membership-mix')).toContainText('Founding');
  await expect(page.locator('#membership-mix')).toContainText('Unknown');

  await expect(page.getByRole('heading', { name: 'Acquisition signals' })).toBeVisible();
  await expect(page.getByText('Recent deposits')).toHaveCount(0);
  await expect(page.getByText('Collected', { exact: true })).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('buyer@example.com');
});

test('subscription report failure stays visible without hiding acquisition and health', async ({ page }) => {
  await page.unroute('**/api/dashboard-data?**');
  await page.route('**/api/dashboard-data?**', async (route) => {
    const payload = dashboardPayload();
    payload.subscription_overview = { error: 'subscription overview: supabase rpc returned 503' };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(payload),
    });
  });
  await page.goto('/dashboard');

  await expect(page.locator('#subscriber-kpis')).toContainText('Subscription report unavailable');
  await expect(page.getByRole('heading', { name: 'Acquisition signals' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'System health' })).toBeVisible();
});
