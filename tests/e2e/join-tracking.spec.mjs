import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const origin = 'https://www.downtownpourcollective.com';
const checkout = 'https://ebiuspbgzggrdiaswpcc.supabase.co/functions/v1/circle-checkout';
const checkoutUrl = 'https://checkout.stripe.test/tracking-fixture';
const read = path => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
const files = {
  '/join': ['join.html', 'text/html'],
  '/assets/privacy-controls.v2.js': ['assets/privacy-controls.v2.js', 'application/javascript'],
  '/assets/privacy-footer.v2.css': ['assets/privacy-footer.v2.css', 'text/css'],
  '/assets/meta-pixel.v3.js': ['assets/meta-pixel.v3.js', 'application/javascript'],
  '/assets/analytics.v2.js': ['assets/analytics.v2.js', 'application/javascript'],
  '/assets/join-diagnostics.js': ['assets/join-diagnostics.js', 'application/javascript'],
};

async function fixture(page, context, { failure = false, privacy = null } = {}) {
  const events = [], sdkRequests = [], checkoutRequests = [];
  // WebKit's request inspector omits Blob beacon bodies, so read the Blob here.
  // Never send it: this page runs on the production origin, and a beacon fired
  // while the page closes (checkout departure) escapes routing and would reach
  // the real /api/track.
  await page.exposeFunction('recordTrackingFixture', payload => events.push(payload));
  await page.addInitScript(() => {
    const send = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = (url, body) => {
      if (url !== '/api/track') return send(url, body);
      body.text().then(text => window.recordTrackingFixture(JSON.parse(text)));
      return true;
    };
  });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === origin && files[url.pathname]) {
      const [path, contentType] = files[url.pathname];
      return route.fulfill({ contentType, body: read(path) });
    }
    if (url.origin === origin && url.pathname === '/api/track') {
      return route.fulfill({ status: 202, contentType: 'application/json', body: '{"stored":true}' });
    }
    if (url.origin === origin && url.pathname === '/api/legal-versions') {
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ tos: '3.0', privacy: '4.9', memberTerms: '3.0', autoRenewalTerms: '3.0' }) });
    }
    if (url.hostname === 'challenges.cloudflare.com' && url.pathname.includes('/turnstile/')) {
      return route.fulfill({ contentType: 'application/javascript', body: 'window.turnstile={render:function(slot,opts){opts.callback("fixture-token");slot.dataset.solved="true";return "fixture-widget"},reset:function(){},remove:function(){}};' });
    }
    if (url.href === 'https://connect.facebook.net/en_US/fbevents.js') {
      sdkRequests.push(url.href);
      return route.fulfill({ contentType: 'application/javascript', body: '/* inert SDK: inspect the real loader queue */' });
    }
    if (url.href === checkout) {
      checkoutRequests.push(route.request().postDataJSON());
      return route.fulfill({ status: failure ? 503 : 200, contentType: 'application/json', body: JSON.stringify(failure
        ? { success: false, error: { code: 'CHECKOUT_NOT_ENABLED' } }
        : { success: true, data: { checkout_url: checkoutUrl } }) });
    }
    // Every other request is blocked, including real Meta collection endpoints.
    return route.abort();
  });
  if (privacy) await page.addInitScript(signal => {
    if (signal === 'GPC') Object.defineProperty(navigator, 'globalPrivacyControl', { value: true });
    else localStorage.setItem('dpc_advertising_opt_out', '1');
  }, privacy);
  await page.goto(origin + '/join');
  await expect(page.locator('#submit-btn')).toBeEnabled();
  await expect(page.locator('#turnstile-slot')).toHaveAttribute('data-solved', 'true');
  // Use the established navigation seam; the real handoff and events still run.
  await page.evaluate(() => { window.DPC_JOIN.navigateToCheckout = url => { window.fixtureCheckoutUrl = url; }; });
  return { events, sdkRequests, checkoutRequests };
}

async function fillValidForm(page) {
  await page.getByText('Beer drinkers', { exact: true }).click();
  await page.getByText('Monthly', { exact: true }).click();
  await page.locator('#firstName').fill('Fixture');
  await page.locator('#lastName').fill('Visitor');
  await page.locator('#email').fill('fixture@example.invalid');
  await page.locator('label.check').click();
}

const metaEvents = page => page.evaluate(() => window.fbq
  ? window.fbq.queue.map(args => Array.from(args)).filter(call => /^track/.test(call[0])) : []);

test('button intent precedes validation; only successful checkout creates InitiateCheckout', async ({ page, context }) => {
  const f = await fixture(page, context);
  await page.locator('#submit-btn').click();
  await expect(page.locator('#form-error')).toHaveText('Choose a Circle to continue.');
  await expect.poll(() => f.events.filter(e => e.event === 'join_checkout_click').length).toBe(1);
  expect(f.checkoutRequests).toHaveLength(0);
  expect(f.events.some(e => e.event === 'join_submit')).toBe(false);
  await expect.poll(() => metaEvents(page)).toEqual([
    ['track', 'PageView'], ['trackCustom', 'JoinCheckoutClick']
  ]);
  await fillValidForm(page);
  await page.locator('#submit-btn').press('Enter');
  await expect(page.locator('#checkout-fallback')).toHaveAttribute('href', checkoutUrl);
  await expect.poll(() => f.events.filter(e => e.event.startsWith('join_checkout') || e.event === 'join_submit').map(e => e.event)).toEqual([
    'join_checkout_click', 'join_checkout_click', 'join_submit', 'join_checkout_ready'
  ]);
  await expect.poll(() => metaEvents(page)).toEqual([
    ['track', 'PageView'], ['trackCustom', 'JoinCheckoutClick'], ['track', 'InitiateCheckout']
  ]);
  expect(f.checkoutRequests).toHaveLength(1);
  expect(await page.evaluate(() => window.fixtureCheckoutUrl)).toBe(checkoutUrl);
  expect(JSON.stringify(f.events)).not.toMatch(/Fixture|Visitor|fixture@example|fixture-token|checkout\.stripe/);
});

test('a rejected checkout records button intent without a Meta checkout-start event', async ({ page, context }) => {
  const f = await fixture(page, context, { failure: true });
  await fillValidForm(page);
  await page.locator('#submit-btn').click();
  await expect(page.locator('#form-error')).toContainText('temporarily unavailable');
  await expect.poll(() => f.events.some(e => e.event === 'join_error')).toBe(true);
  expect(f.events.some(e => e.event === 'join_checkout_ready')).toBe(false);
  expect((await metaEvents(page)).some(call => call[1] === 'InitiateCheckout')).toBe(false);
});

for (const privacy of ['GPC', 'saved opt-out']) {
  test(`${privacy} blocks Meta while first-party click and checkout events continue`, async ({ page, context }) => {
    const f = await fixture(page, context, { privacy });
    await fillValidForm(page);
    await page.locator('#submit-btn').click();
    await expect(page.locator('#checkout-fallback')).toHaveAttribute('href', checkoutUrl);
    await expect.poll(() => f.events.filter(e => ['join_checkout_click', 'join_checkout_ready'].includes(e.event)).length).toBe(2);
    expect(f.sdkRequests).toEqual([]);
    expect(await metaEvents(page)).toEqual([]);
  });
}

test('analytics exceptions never block checkout', async ({ page, context }) => {
  const f = await fixture(page, context);
  await fillValidForm(page);
  await page.evaluate(() => {
    window.DPCAnalytics.track = () => { throw Error('fixture first-party failure'); };
    window.DPCMetaPixel = { track() { throw Error('fixture advertising failure'); } };
  });
  await page.locator('#submit-btn').click();
  await expect(page.locator('#checkout-fallback')).toHaveAttribute('href', checkoutUrl);
  expect(f.checkoutRequests).toHaveLength(1);
});
