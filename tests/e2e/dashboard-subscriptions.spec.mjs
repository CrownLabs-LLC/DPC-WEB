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
        { date: '2048-08-21', visits: 12, home_views: 10, join_views: 2, checkout_attempts: 3, checkout_departed: 2, join_errors: 0, confirmations: 2 },
        { date: '2048-08-22', visits: 18, home_views: 15, join_views: 3, checkout_attempts: 5, checkout_departed: 4, join_errors: 1, confirmations: 3 },
      ],
      steps: [
        { key: 'home', label: 'Homepage', short: 'homepage views', count: 25, of: null },
        { key: 'join', label: 'Reached the Join page', short: 'join-page views', count: 5, of: 'home', bound: 'upper', overflow: 'entrances' },
        { key: 'submit', label: 'Form submitted', short: 'submissions', count: 8, of: 'join', overflow: 'attempts' },
        { key: 'stripe', label: 'Reached Stripe', short: 'Stripe handoffs', count: 6, of: 'submit' },
        { key: 'complete', label: 'Completed', short: 'completions', count: 5, of: 'stripe' },
      ],
      join_entries: { from_site: 4, direct: 1, meta: 0, search: 0, other: 0, return: 0 },
      cold_join_entries: 1,
      sources: { meta: 20, direct: 6, search: 2, other: 1, internal: 1 },
      blocked_windows: [],
      totals: {
        visits: 30,
        home_views: 25,
        join_views: 5,
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
        home_views: 17,
        join_views: 3,
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
  await expect(page.locator('#subscription-actions')).toContainText('No collection attempt recorded');
  await expect(page.locator('#subscription-actions')).toContainText('Other dunning timing');
  await expect(page.locator('#subscription-actions')).toContainText('first attempt not scheduled');

  await expect(page.getByRole('heading', { name: 'Membership mix' })).toBeVisible();
  await expect(page.locator('#membership-mix')).toContainText('Tap');
  await expect(page.locator('#membership-mix')).toContainText('Founding');
  await expect(page.locator('#membership-mix')).toContainText('Unknown');

  await expect(page.getByRole('heading', { name: 'Acquisition signals' })).toBeVisible();
  await expect(page.locator('#acquisition-kpis')).toContainText('Checkout completions');
  await expect(page.getByText('Recent deposits')).toHaveCount(0);
  await expect(page.getByText('Collected', { exact: true })).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('buyer@example.com');
});

test('acquisition shows where visitors are lost and how they reached Join', async ({ page }) => {
  await page.goto('/dashboard');

  await expect(page.getByRole('heading', { name: 'Where visitors are lost' })).toBeVisible();
  const steps = page.locator('#funnel-steps');
  // 4 of 25 homepage visitors clicked through: the drop-off the old blended
  // "Visits" tile could not show.
  // 5 of 25 reached /join, but some arrived cold, so the rate is an upper
  // bound on click-through and the loss a lower bound.
  await expect(steps).toContainText('at most 20% of homepage views');
  await expect(steps).toContainText('20 lost here, at least');
  await expect(steps).toContainText('1 arrived without a link from our own pages');
  // A hostname-only referrer cannot isolate the homepage, so no step claims to.
  await expect(steps).not.toContainText('Clicked through to Join');
  // 8 submissions across 5 join-page views: attempts, not a 160% rate.
  await expect(steps).toContainText('8 attempts across 5 join-page views');
  await expect(steps).not.toContainText('160%');

  const entrances = page.locator('#join-entrances');
  await expect(entrances).toContainText('From elsewhere on this site');
  await expect(entrances).toContainText('Direct / unknown');
  await expect(page.locator('#traffic-sources')).toContainText('Meta');

  await expect(page.locator('#daily-table').locator('..')).toBeVisible();
  await expect(page.locator('#acquisition-kpis')).toContainText('Homepage 25 · Join 5');
});

test('join views exceeding homepage views are entrances, never retries', async ({ page }) => {
  await page.unroute('**/api/dashboard-data?**');
  await page.route('**/api/dashboard-data?**', async (route) => {
    const payload = dashboardPayload();
    // A market day: flyer QR scans drive more /join views than the homepage saw.
    payload.funnel.steps.find((s) => s.key === 'home').count = 4;
    payload.funnel.cold_join_entries = 3;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(payload),
    });
  });
  await page.goto('/dashboard');

  const steps = page.locator('#funnel-steps');
  await expect(steps).toContainText('more join-page views than homepage views');
  await expect(steps).toContainText('arrivals that skipped the homepage outnumber it');
  // Page views are people, not attempts: the retry wording belongs to the
  // submissions step alone.
  await expect(steps).not.toContainText('5 attempts across 4 homepage views');
  await expect(steps).toContainText('3 arrived without a link from our own pages');
});

test('a later stage exceeding its parent gets a neutral explanation', async ({ page }) => {
  await page.unroute('**/api/dashboard-data?**');
  await page.route('**/api/dashboard-data?**', async (route) => {
    const payload = dashboardPayload();
    // Real shape: completions reached through the depositor confirmation link
    // never pass /join, so they can outnumber the Stripe handoffs recorded there.
    payload.funnel.steps.find((s) => s.key === 'stripe').count = 3;
    payload.funnel.steps.find((s) => s.key === 'complete').count = 5;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(payload),
    });
  });
  await page.goto('/dashboard');

  const steps = page.locator('#funnel-steps');
  await expect(steps).toContainText('more completions than Stripe handoffs');
  await expect(steps).toContainText('some did not pass through the previous step');
  // Neither the retry nor the entrance explanation belongs to this stage.
  await expect(steps).not.toContainText('skipped the homepage outnumber it');
  await expect(steps).not.toContainText('5 attempts across 3 Stripe handoffs');
});

test('an hour where no attempt reached Stripe raises the banner', async ({ page }) => {
  await page.unroute('**/api/dashboard-data?**');
  await page.route('**/api/dashboard-data?**', async (route) => {
    const payload = dashboardPayload();
    payload.funnel.blocked_windows = [
      { hour: '2048-08-22T18', submits: 21, errors: 21, top_error_code: 'RATE_LIMITED', recent: true },
    ];
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(payload),
    });
  });
  await page.goto('/dashboard');

  await expect(page.locator('#banner')).toContainText('Checkout blocked in 1 hour(s)');
  await expect(page.locator('#banner')).toContainText('21 attempt(s) and none reached Stripe');
  await expect(page.locator('#banner')).toContainText('RATE_LIMITED');
});

test('a resolved outage is kept as record without lighting the banner', async ({ page }) => {
  await page.unroute('**/api/dashboard-data?**');
  await page.route('**/api/dashboard-data?**', async (route) => {
    const payload = dashboardPayload();
    // Two weeks old and long since fixed. An alert that stays lit for this is
    // one people stop reading, which hides the next real one.
    payload.funnel.blocked_windows = [
      { hour: '2048-08-08T18', submits: 21, errors: 21, top_error_code: 'RATE_LIMITED', recent: false },
      { hour: '2048-08-08T19', submits: 19, errors: 19, top_error_code: null, recent: false },
    ];
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(payload),
    });
  });
  await page.goto('/dashboard');

  await expect(page.locator('#banner')).not.toContainText('Checkout blocked');
  const history = page.locator('#blocked-history-card');
  await expect(history).toContainText('None in the last 24 hours');
  await expect(history).toContainText('2048-08-08 18:00');
  await expect(history).toContainText('RATE_LIMITED');
  await expect(history).toContainText('no error recorded');
});

test('a recent outage appears in both the banner and the record', async ({ page }) => {
  await page.unroute('**/api/dashboard-data?**');
  await page.route('**/api/dashboard-data?**', async (route) => {
    const payload = dashboardPayload();
    payload.funnel.blocked_windows = [
      { hour: '2048-08-22T18', submits: 4, errors: 4, top_error_code: 'CHALLENGE_FAILED', recent: true },
      { hour: '2048-08-08T18', submits: 21, errors: 21, top_error_code: 'RATE_LIMITED', recent: false },
    ];
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(payload),
    });
  });
  await page.goto('/dashboard');

  // The banner counts only the live one, not the fortnight-old one beneath it.
  await expect(page.locator('#banner')).toContainText('Checkout blocked in 1 hour(s): 4 attempt(s)');
  await expect(page.locator('#banner')).toContainText('CHALLENGE_FAILED');
  await expect(page.locator('#banner')).not.toContainText('25 attempt(s)');
  await expect(page.locator('#blocked-history-card')).toContainText('1 in the last 24 hours');
  await expect(page.locator('#blocked-history-card')).toContainText('2048-08-08 18:00');
});

test('a capped history says how much it left out', async ({ page }) => {
  await page.unroute('**/api/dashboard-data?**');
  await page.route('**/api/dashboard-data?**', async (route) => {
    const payload = dashboardPayload();
    payload.funnel.blocked_windows = [
      { hour: '2048-08-22T18', submits: 4, errors: 4, top_error_code: 'CHALLENGE_FAILED', recent: true },
      { hour: '2048-08-08T18', submits: 21, errors: 21, top_error_code: 'RATE_LIMITED', recent: false },
    ];
    payload.funnel.blocked_omitted = 5;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(payload),
    });
  });
  await page.goto('/dashboard');

  const card = page.locator('#blocked-history-card');
  // A truncated list must never read as the complete record.
  await expect(card).toContainText('Latest blocked hours');
  await expect(card).toContainText('Showing the latest 2; 5 older not listed');
  // The banner still counts only what is live, regardless of what was trimmed.
  await expect(page.locator('#banner')).toContainText('Checkout blocked in 1 hour(s): 4 attempt(s)');
});

test('partial subscription payload uses placeholders while independent sections keep rendering', async ({ page }) => {
  await page.unroute('**/api/dashboard-data?**');
  await page.route('**/api/dashboard-data?**', async (route) => {
    const payload = dashboardPayload();
    payload.subscription_overview = { totals: OVERVIEW.totals };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(payload),
    });
  });
  await page.goto('/dashboard');

  const paid24h = page.locator('#subscriber-kpis .label').filter({ hasText: /^New paid · last 24 hours$/ }).locator('..');
  await expect(paid24h).toContainText('—');
  const retries = page.locator('#subscription-actions .ops-row').filter({ hasText: 'Retries exhausted' });
  await expect(retries.locator('.ops-count')).toHaveText('—');
  await expect(retries.locator('.ops-count')).not.toHaveClass(/good|warning|critical/);
  await expect(page.getByRole('heading', { name: 'Acquisition signals' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'System health' })).toBeVisible();
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

test('an intentionally unconfigured preview does not raise an RPC failure banner', async ({ page }) => {
  await page.unroute('**/api/dashboard-data?**');
  await page.route('**/api/dashboard-data?**', async (route) => {
    const payload = dashboardPayload();
    payload.funnel.totals.checkout_stalled = 0;
    payload.subscription_overview = { configured: false };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(payload),
    });
  });
  await page.goto('/dashboard');

  await expect(page.locator('#subscriber-kpis')).toContainText('Subscription report unavailable');
  await expect(page.locator('#banner')).not.toContainText('Subscription report unavailable');
});
