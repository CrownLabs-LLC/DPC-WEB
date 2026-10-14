import { test, expect } from '@playwright/test';

// Opaque-looking synthetic bytes only. Never use a real capability in traces.
const token = 'r1.fixture.AAAAAAAAAAAAAAAA.' + 'B'.repeat(80);
const apiUrl = 'https://hohbsqkmrlhkstojfdgx.supabase.co/functions/v1/pour-reminder-preferences';
const route = '/email-preferences';
const requests = new WeakMap();

test.beforeEach(async ({ page, context }) => {
  const captured = [];
  requests.set(page, captured);
  page.on('request', request => captured.push(request));
  // All external traffic is blocked unless a test installs its synthetic API.
  await context.route('**/*', request => new URL(request.request().url()).hostname === '127.0.0.1'
    ? request.continue() : request.abort());
});

async function config(page, value = { enabled: true, apiUrl }) {
  await page.route('**/api/email-preferences-config', request => request.fulfill({ json: value }));
}
async function backend(page, callback) {
  const calls = [];
  await page.route(apiUrl, async request => {
    if (request.request().method() === 'OPTIONS') {
      return request.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*',
        'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'POST, OPTIONS' } });
    }
    const body = request.request().postDataJSON();
    calls.push(body);
    const reply = await callback(body, calls.length);
    if (reply === 'abort') return request.abort();
    return request.fulfill({ status: reply.status || 200, json: reply.body,
      headers: { 'access-control-allow-origin': '*', 'cache-control': 'no-store' } });
  });
  return calls;
}
async function open(page, fragment = '#token=' + token) {
  await page.goto('about:blank');
  await page.goto(route + fragment);
  await expect(page).toHaveURL(/\/email-preferences$/);
}

test('unset page configuration is inert even with a token; both routes carry privacy headers', async ({ page, request }) => {
  await open(page);
  await expect(page.getByRole('alert')).toContainText('temporarily unavailable');
  await expect(page.getByRole('button', { name: 'Save preference' })).toBeHidden();
  expect(requests.get(page).filter(req => req.url().includes('.supabase.co'))).toEqual([]);
  for (const path of [route, route + '.html']) {
    const response = await request.get(path);
    expect(response.headers()['cache-control']).toBe('no-store');
    expect(response.headers()['referrer-policy']).toBe('no-referrer');
    expect(response.headers()['x-robots-tag']).toContain('noindex');
    expect(response.headers()['content-security-policy']).toContain("default-src 'none'");
  }
});

test('opening and selecting never mutate; only explicit saves disable and re-enable', async ({ page }) => {
  await config(page);
  let state = 'enabled'; let version = 3;
  const calls = await backend(page, body => {
    if (body.action !== 'read') { state = body.action === 'disable' ? 'disabled' : 'enabled'; version++; }
    return { body: { state, version } };
  });
  await open(page);
  await expect(page.locator('#current')).toHaveText('Pour reminders are on.');
  await expect(page.getByRole('button', { name: 'Save preference' })).toBeDisabled();
  expect(calls).toEqual([{ token, action: 'read' }]);
  await page.getByLabel('Off', { exact: false }).check();
  expect(calls).toHaveLength(1);
  await page.getByRole('button', { name: 'Save preference' }).click();
  await expect(page.getByRole('status')).toHaveText('Saved. Pour reminders are off.');
  expect(calls[1]).toMatchObject({ token, action: 'disable', version: 3 });
  expect(calls[1].requestId).toMatch(/^[0-9a-f-]{36}$/);
  await page.getByLabel('On', { exact: false }).check();
  await page.getByRole('button', { name: 'Save preference' }).click();
  await expect(page.getByRole('status')).toHaveText('Saved. Pour reminders are on.');
  expect(calls[2]).toMatchObject({ token, action: 'enable', version: 4 });
  expect(calls[2].requestId).not.toBe(calls[1].requestId);
  await expect(page.getByText('You will still receive sign-in codes')).toBeVisible();
});

test('unknown preference requires a deliberate choice and saves the read version', async ({ page, browserName }) => {
  await config(page);
  const calls = await backend(page, body => ({ body: body.action === 'read'
    ? { state: 'unknown', version: 0 } : { state: 'enabled', version: 1 } }));
  await open(page);
  await expect(page.locator('#current')).toHaveText('No reminder preference is saved.');
  await expect(page.getByRole('radio', { checked: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save preference' })).toBeDisabled();
  await page.locator('#reminders-on').focus();
  await page.keyboard.press('Space');
  if (browserName === 'webkit') await page.getByRole('button', { name: 'Save preference' }).focus();
  else await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Save preference' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status')).toHaveText('Saved. Pour reminders are on.');
  expect(calls[1].version).toBe(0);
});

test('invalid, absent and query-string credentials are never submitted', async ({ page }) => {
  await config(page);
  const calls = await backend(page, () => ({ body: { state: 'enabled', version: 1 } }));
  for (const suffix of ['', '#token=invalid', '?token=' + token, '#token=' + token + '&email=person@example.com', '#token=' + 'x'.repeat(2100)]) {
    await open(page, suffix);
    await expect(page.getByRole('alert')).toContainText('unavailable or has expired');
  }
  expect(calls).toEqual([]);
});

test('expired and recipient-changed capabilities have the same neutral error', async ({ page }) => {
  await config(page);
  await backend(page, () => ({ status: 400, body: { error: 'invalid_link' } }));
  await open(page);
  await expect(page.getByRole('alert')).toHaveText('This link is unavailable or has expired. Open the link in your latest Pour reminder email, or contact support.');
  await expect(page.locator('#preference-form')).toBeHidden();
});

test('a second fragment is scrubbed and an older read cannot replace its state', async ({ page }) => {
  await config(page);
  const second = token.replace('fixture', 'second');
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const calls = await backend(page, async body => {
    if (body.token === token) { await pending; return { body: { state: 'enabled', version: 1 } }; }
    return { body: { state: 'disabled', version: 9 } };
  });
  await open(page);
  await expect.poll(() => calls.length).toBe(1);
  await page.evaluate(value => { location.hash = 'token=' + value; }, second);
  await expect(page).toHaveURL(/\/email-preferences$/);
  await expect(page.locator('#current')).toHaveText('Pour reminders are off.');
  const oldResponse = page.waitForResponse(response => response.url() === apiUrl && response.request().postDataJSON().token === token);
  release();
  await (await oldResponse).finished();
  await expect(page.locator('#current')).toHaveText('Pour reminders are off.');
  await page.locator('#reminders-on').check();
  await page.getByRole('button', { name: 'Save preference' }).click();
  await expect.poll(() => calls.length).toBe(3);
  expect(calls[2]).toMatchObject({ token: second, action: 'enable', version: 9 });
});

test('a stalled backend times out into a recoverable state', async ({ page }) => {
  await page.clock.install();
  await config(page);
  let started = false;
  await page.route(apiUrl, () => { started = true; return new Promise(() => {}); });
  await open(page);
  await expect.poll(() => started).toBe(true);
  await page.clock.fastForward(10001);
  await expect(page.getByRole('alert')).toContainText('could not connect');
  await expect(page.getByRole('button', { name: 'Check preference' })).toBeVisible();
});

test('missing, false, malformed and unavailable config never calls the preference API', async ({ page }) => {
  const calls = await backend(page, () => ({ body: { state: 'enabled', version: 1 } }));
  for (const value of [{}, { enabled: false }, { enabled: 'true', apiUrl },
    { enabled: true, apiUrl: 'https://example.com/collect' }]) {
    await config(page, value);
    await open(page);
    await expect(page.getByRole('alert')).toContainText('temporarily unavailable');
  }
  await page.route('**/api/email-preferences-config', request => request.abort());
  await open(page);
  await expect(page.getByRole('alert')).toContainText('temporarily unavailable');
  expect(calls).toEqual([]);
});

test('stale re-enable is never repeated without a fresh read and new explicit action', async ({ page }) => {
  await config(page);
  let reads = 0;
  const calls = await backend(page, body => body.action === 'read'
    ? { body: { state: 'disabled', version: ++reads } }
    : { status: 409, body: { error: 'preference_changed' } });
  await open(page);
  await page.locator('#reminders-on').check();
  await page.getByRole('button', { name: 'Save preference' }).click();
  await expect(page.getByRole('alert')).toContainText('changed since this page loaded');
  await expect(page.locator('#preference-form')).toBeHidden();
  expect(calls.map(call => call.action)).toEqual(['read', 'enable']);
  await page.getByRole('button', { name: 'Check preference' }).click();
  await expect(page.locator('#reminders-off')).toBeChecked();
  await expect(page.getByRole('button', { name: 'Save preference' })).toBeDisabled();
  expect(calls.map(call => call.action)).toEqual(['read', 'enable', 'read']);
});

test('lost save response re-reads the committed outcome instead of resubmitting', async ({ page }) => {
  await config(page);
  let state = 'enabled';
  const calls = await backend(page, body => {
    if (body.action === 'disable') { state = 'disabled'; return 'abort'; }
    return { body: { state, version: state === 'enabled' ? 1 : 2 } };
  });
  await open(page);
  await page.locator('#reminders-off').check();
  await page.getByRole('button', { name: 'Save preference' }).click();
  await expect(page.getByRole('alert')).toContainText('could not confirm your change');
  await page.getByRole('button', { name: 'Check preference' }).click();
  await expect(page.locator('#current')).toHaveText('Pour reminders are off.');
  expect(calls.map(call => call.action)).toEqual(['read', 'disable', 'read']);
});

test('backend independently refuses re-enable while issued-link read and disable still work', async ({ page }) => {
  await config(page);
  let state = 'enabled';
  await backend(page, body => {
    if (body.action === 'enable') return { status: 503, body: { error: 'unavailable' } };
    if (body.action === 'disable') state = 'disabled';
    return { body: { state, version: 2 } };
  });
  await open(page);
  await page.locator('#reminders-off').check();
  await page.getByRole('button', { name: 'Save preference' }).click();
  await expect(page.getByRole('status')).toHaveText('Saved. Pour reminders are off.');
  await page.locator('#reminders-on').check();
  await page.getByRole('button', { name: 'Save preference' }).click();
  await expect(page.getByRole('alert')).toContainText('could not confirm your change');
  await page.getByRole('button', { name: 'Check preference' }).click();
  await expect(page.locator('#reminders-off')).toBeChecked();
});

test('unavailable or malformed backend response is recoverable and discloses no response body', async ({ page }) => {
  await config(page);
  for (const reply of [{ status: 503, body: { error: 'private@example.com' } },
    { body: { state: 'enabled', version: -1 } }, { body: { state: 'enabled', version: '1' } }]) {
    await backend(page, () => reply);
    await open(page);
    await expect(page.getByRole('alert')).toContainText('could not load');
    await expect(page.locator('#preference-form')).toBeHidden();
    await expect(page.locator('body')).not.toContainText('private@example.com');
  }
});

test('fragment never appears in URLs, referrers, storage, DOM, console or unrelated requests', async ({ page }) => {
  const logs = [];
  page.on('console', message => logs.push(message.text()));
  await config(page);
  await backend(page, () => ({ body: { state: 'enabled', version: 1 } }));
  await open(page);
  await expect(page.locator('#current')).toHaveText('Pour reminders are on.');
  expect(await page.content()).not.toContain(token);
  expect(await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage }, cookie: document.cookie })))
    .toEqual({ local: {}, session: {}, cookie: '' });
  expect(logs.join('\n')).not.toContain(token);
  for (const request of requests.get(page)) {
    expect(request.url()).not.toContain(token);
    // Fonts may carry their same-origin stylesheet URL as referrer. Document
    // and API requests never carry the page URL, fragment or any capability.
    if (request.resourceType() !== 'font') expect(request.headers().referer).toBeUndefined();
    expect(request.headers().referer || '').not.toContain(token);
    expect(request.headers().cookie).toBeUndefined();
    if (new URL(request.url()).hostname !== '127.0.0.1') expect(request.url()).toBe(apiUrl);
    if (request.postData()?.includes(token)) expect(request.url()).toBe(apiUrl);
  }
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('unavailable or has expired');
});

test('disabled JavaScript leaves no active controls or API requests', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL: 'http://127.0.0.1:4173' });
  const page = await context.newPage();
  const urls = [];
  page.on('request', request => urls.push(request.url()));
  await page.goto(route + '#token=' + token);
  await expect(page.getByRole('status')).toContainText('Enable JavaScript and reopen your email link');
  await expect(page.locator('#preference-form')).toBeHidden();
  expect(urls.some(url => url.includes('/api/') || url.includes('.supabase.co'))).toBe(false);
  await context.close();
});

test('mobile layout and keyboard controls stay usable without horizontal scrolling', async ({ page }, testInfo) => {
  await config(page);
  await backend(page, () => ({ body: { state: 'enabled', version: 1 } }));
  await open(page);
  await expect(page.locator('#current')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Manage Pour reminders');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const selector of ['#save', '.choice']) {
    expect((await page.locator(selector).first().boundingBox()).height).toBeGreaterThanOrEqual(44);
  }
  await page.screenshot({ path: '.impeccable/review/' + testInfo.project.name + '.png', fullPage: true });
  await page.setViewportSize({ width: 320, height: 640 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
