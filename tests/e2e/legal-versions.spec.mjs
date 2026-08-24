// Client behaviour for the live legal-version tuple on /join.
//
// The tuple is consent evidence: circle-checkout writes whatever the page
// submits into member_legal_acceptances with IP and user agent. So the rules
// under test are not cosmetic — the page must never submit a version the
// member was not shown, and must never proceed on a tuple it could not
// confirm. Every case here is a way that could go wrong.
import { test, expect } from '@playwright/test';

const CHECKOUT_ENDPOINT = 'https://ebiuspbgzggrdiaswpcc.supabase.co/functions/v1/circle-checkout';
const CHECKOUT_URL = 'https://checkout.stripe.test/c/pay/cs_test_legal_versions';
const CURRENT = { tos: '3.0', privacy: '4.2', memberTerms: '3.0', autoRenewalTerms: '3.0' };
const BUMPED = { ...CURRENT, privacy: '4.3' };

// serveLegalVersions: (requestUrl, callIndex) => ({status, body}) | null
async function setup(page, { serveLegalVersions, checkout } = {}) {
  const state = { legalVersionUrls: [], checkoutPayloads: [] };

  await page.route('https://challenges.cloudflare.com/turnstile/**', async (route) => {
    await route.fulfill({
      contentType: 'text/javascript',
      // reset() re-issues a token, as the real non-interactive widget does.
      body: `window.turnstile=(function(){var o;return{render:function(_,opts){o=opts;setTimeout(function(){o.callback('test-token')},0);return 'test-widget'},reset:function(){setTimeout(function(){o&&o.callback('test-token')},0)}}})();`,
    });
  });
  await page.route('**/api/track', async (route) => {
    await route.fulfill({ status: 202, contentType: 'application/json', body: '{"stored":true}' });
  });
  await page.route('https://checkout.stripe.test/**', async (route) => {
    await route.fulfill({ contentType: 'text/html', body: '<h1>Stripe Checkout reached</h1>' });
  });

  await page.route('**/api/legal-versions*', async (route) => {
    const url = route.request().url();
    const index = state.legalVersionUrls.length;
    state.legalVersionUrls.push(url);
    const reply = serveLegalVersions
      ? serveLegalVersions(url, index)
      : { status: 200, body: CURRENT };
    if (!reply) {
      await route.abort('failed');
      return;
    }
    await route.fulfill({
      status: reply.status,
      contentType: 'application/json',
      body: JSON.stringify(reply.body ?? { error: 'legal versions unavailable' }),
    });
  });

  await page.route(CHECKOUT_ENDPOINT, async (route) => {
    state.checkoutPayloads.push(JSON.parse(route.request().postData() || '{}'));
    const reply = checkout ? checkout(state.checkoutPayloads.length - 1) : null;
    await route.fulfill({
      status: reply?.status ?? 200,
      contentType: 'application/json',
      body: JSON.stringify(reply?.body ?? { success: true, data: { checkout_url: CHECKOUT_URL, reused: false } }),
    });
  });

  return state;
}

async function fillForm(page) {
  await page.getByText('Beer drinkers', { exact: true }).click();
  await page.getByText('Monthly', { exact: true }).click();
  await page.locator('#firstName').fill('Legal');
  await page.locator('#lastName').fill('Versions');
  await page.locator('#email').fill('legal-versions@example.invalid');
  await page.locator('label.check').click();
}

test('submits the live tuple, reading cached on load and uncached at submit', async ({ page }) => {
  const state = await setup(page);
  await page.goto('/join');
  await expect(page.locator('#submit-btn')).toBeEnabled();
  await fillForm(page);

  await Promise.all([
    page.waitForURL('https://checkout.stripe.test/**'),
    page.locator('#submit-btn').click(),
  ]);

  expect(state.checkoutPayloads).toHaveLength(1);
  expect(state.checkoutPayloads[0].legalVersions).toEqual(CURRENT);
  // The on-load read may be served from the CDN; the submit-time read must not
  // be. Conflating the two would let a cached tuple reach the ledger.
  expect(state.legalVersionUrls).toHaveLength(2);
  expect(state.legalVersionUrls[0]).not.toContain('fresh=1');
  expect(state.legalVersionUrls[1]).toContain('fresh=1');
});

test('submit stays disabled until the initial read resolves', async ({ page }) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  await setup(page, {
    serveLegalVersions: () => ({ status: 200, body: CURRENT }),
  });
  await page.route('**/api/legal-versions*', async (route) => {
    await gate;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CURRENT) });
  });

  await page.goto('/join');
  await expect(page.locator('#submit-btn')).toBeDisabled();
  await expect(page.locator('#submit-btn')).toHaveText('Loading…');
  release();
  await expect(page.locator('#submit-btn')).toBeEnabled();
  await expect(page.locator('#submit-btn')).toHaveText('Continue to Checkout');
});

test('a failed initial read fails closed — no submit path, no fallback tuple', async ({ page }) => {
  const state = await setup(page, { serveLegalVersions: () => ({ status: 503 }) });
  await page.goto('/join');

  await expect(page.locator('#submit-btn')).toBeDisabled();
  await expect(page.locator('#form-error')).toContainText('could not confirm the current terms');
  await fillForm(page);
  await expect(page.locator('#submit-btn')).toBeDisabled();
  expect(state.checkoutPayloads).toHaveLength(0);
});

test('a tuple that changes between load and submit clears consent and blocks the post', async ({ page }) => {
  const state = await setup(page, {
    serveLegalVersions: (_url, index) => ({ status: 200, body: index === 0 ? CURRENT : BUMPED }),
  });
  await page.goto('/join');
  await fillForm(page);
  await expect(page.locator('#legal')).toBeChecked();

  await page.locator('#submit-btn').click();

  await expect(page.locator('#form-error')).toContainText('Our terms were updated');
  await expect(page.locator('#legal')).not.toBeChecked();
  expect(state.checkoutPayloads).toHaveLength(0);

  // A fresh, explicit accept submits the NEW tuple — never the one the member
  // originally ticked, and never without a new tick.
  await page.locator('label.check').click();
  await Promise.all([
    page.waitForURL('https://checkout.stripe.test/**'),
    page.locator('#submit-btn').click(),
  ]);
  expect(state.checkoutPayloads).toHaveLength(1);
  expect(state.checkoutPayloads[0].legalVersions).toEqual(BUMPED);
});

test('a failed submit-time read never falls back to the load-time tuple', async ({ page }) => {
  const state = await setup(page, {
    serveLegalVersions: (_url, index) => (index === 0 ? { status: 200, body: CURRENT } : null),
  });
  await page.goto('/join');
  await fillForm(page);
  await page.locator('#submit-btn').click();

  await expect(page.locator('#form-error')).toContainText('could not confirm the current terms');
  await expect(page.locator('#submit-btn')).toBeDisabled();
  expect(state.checkoutPayloads).toHaveLength(0);
});

test('LEGAL_VERSIONS_NOT_CURRENT re-prompts and never auto-resubmits', async ({ page }) => {
  // The genuine race: our submit-time read saw the old tuple, then the bump
  // landed before the server validated. No client re-read can close this.
  const state = await setup(page, {
    serveLegalVersions: (_url, index) => ({ status: 200, body: index < 2 ? CURRENT : BUMPED }),
    checkout: (index) => (index === 0
      ? { status: 409, body: { success: false, error: { code: 'LEGAL_VERSIONS_NOT_CURRENT' } } }
      : null),
  });
  await page.goto('/join');
  await fillForm(page);
  await page.locator('#submit-btn').click();

  await expect(page.locator('#form-error')).toContainText('Our terms were updated');
  await expect(page.locator('#legal')).not.toBeChecked();
  await expect(page.locator('#submit-btn')).toBeEnabled();

  // Give an auto-resubmit a chance to happen before asserting it did not.
  await page.waitForTimeout(500);
  expect(state.checkoutPayloads).toHaveLength(1);

  await page.locator('label.check').click();
  await Promise.all([
    page.waitForURL('https://checkout.stripe.test/**'),
    page.locator('#submit-btn').click(),
  ]);
  expect(state.checkoutPayloads).toHaveLength(2);
  expect(state.checkoutPayloads[1].legalVersions).toEqual(BUMPED);
});

test('a rejection whose re-read also fails ends in the fail-closed state', async ({ page }) => {
  const state = await setup(page, {
    serveLegalVersions: (_url, index) => (index < 2 ? { status: 200, body: CURRENT } : { status: 503 }),
    checkout: () => ({ status: 409, body: { success: false, error: { code: 'LEGAL_VERSIONS_NOT_CURRENT' } } }),
  });
  await page.goto('/join');
  await fillForm(page);
  await page.locator('#submit-btn').click();

  await expect(page.locator('#form-error')).toContainText('could not confirm the current terms');
  await expect(page.locator('#submit-btn')).toBeDisabled();
  expect(state.checkoutPayloads).toHaveLength(1);
});
