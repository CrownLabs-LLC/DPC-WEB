import { test, expect } from '@playwright/test';

const identity = '11111111-1111-4111-8111-111111111111';
async function setup(page, mode = 'success') {
  const submissions = [];
  let verifies = 0;
  await page.route('https://deletion-fixture.supabase.co/auth/v1/**', async route => {
    const data = route.request().postDataJSON();
    if (route.request().url().endsWith('/otp')) {
      expect(data).toEqual({ email: 'member@example.test', create_user: false });
      return route.fulfill({ json: {} });
    }
    verifies++;
    return route.fulfill({ json: { access_token: `synthetic-session-${verifies}`, user: {
      id: mode === 'wrong-user' && verifies > 1 ? '22222222-2222-4222-8222-222222222222' : identity,
      email: 'member@example.test',
    } } });
  });
  await page.route('**/api/account-deletion', async route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { supabaseUrl: 'https://deletion-fixture.supabase.co', anonKey: 'synthetic-public-key' } });
    const data = route.request().postDataJSON();
    submissions.push(data);
    if (mode !== 'success' && submissions.length === 1) return route.abort('failed'); // Saved server-side, receipt lost.
    if (mode !== 'success' && submissions.length === 2) return route.fulfill({ status: 401, json: { error: 'verify_identity' } });
    return route.fulfill({ json: { requestId: data.requestId, timing: data.timing, status: 'received' } });
  });
  await page.goto('/delete-account');
  await page.getByLabel('Account email', { exact: true }).fill('member@example.test');
  await page.getByRole('button', { name: 'Send verification code' }).click();
  await page.getByLabel('Six-digit email code').fill('123456');
  await page.getByRole('button', { name: 'Verify email', exact: true }).click();
  await expect(page.locator('#request-form')).toBeVisible();
  return submissions;
}
for (const timing of ['now', 'paid_period_end']) {
  test(`verified request: ${timing}`, async ({ page }, testInfo) => {
    const submissions = await setup(page);
    await expect(page.locator('input[name="timing"]:checked')).toHaveCount(0);
    await page.locator(`input[value="${timing}"]`).check();
    await page.locator('#confirm').check();
    await expect(page.locator('body')).not.toHaveJSProperty('scrollWidth', 0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('verified-form.png'), fullPage: true });
    await page.getByRole('button', { name: 'Submit deletion request' }).click();
    await expect(page.locator('#received')).toBeVisible();
    expect(submissions).toHaveLength(1);
    expect(submissions[0]).toEqual({ requestId: expect.any(String), timing, confirmed: true });
    expect(await page.evaluate(() => [localStorage.length, sessionStorage.length, document.cookie])).toEqual([0, 0, '']);
    await expect(page.locator('#status')).toContainText('not yet been deleted');
  });
}
test('lost receipt, expired session and same-identity verification preserve the request', async ({ page }) => {
  const submissions = await setup(page, 'lost-receipt');
  await page.locator('input[value="paid_period_end"]').check();
  await page.locator('#confirm').check();
  const submit = page.getByRole('button', { name: 'Submit deletion request' });
  await submit.click();
  await expect(page.locator('#status')).toContainText('could not confirm receipt');
  await expect(page.locator('input[value="now"]')).toBeDisabled();
  await page.getByRole('button', { name: 'Leave without submitting' }).click();
  await expect(page.locator('#status')).toContainText(submissions[0].requestId);
  await submit.click();
  await expect(page.locator('#status')).toContainText('could not confirm receipt');
  await page.getByRole('button', { name: 'Verify this email again' }).click();
  await expect(page.locator('#change-email')).toBeHidden();
  await page.getByLabel('Six-digit email code').fill('654321');
  await page.getByRole('button', { name: 'Verify email', exact: true }).click();
  await submit.click();
  await expect(page.locator('#received')).toBeVisible();
  expect(submissions).toHaveLength(3);
  expect(submissions[1]).toEqual(submissions[0]);
  expect(submissions[2]).toEqual(submissions[0]);
});
test('retry verification refuses a different identity', async ({ page }) => {
  const submissions = await setup(page, 'wrong-user');
  await page.locator('input[value="now"]').check();
  await page.locator('#confirm').check();
  await page.getByRole('button', { name: 'Submit deletion request' }).click();
  await expect(page.locator('#status')).toContainText('could not confirm receipt');
  await page.getByRole('button', { name: 'Verify this email again' }).click();
  await page.getByLabel('Six-digit email code').fill('654321');
  await page.getByRole('button', { name: 'Verify email', exact: true }).click();
  await expect(page.locator('#status')).toContainText('could not be verified');
  await expect(page.locator('#request-form')).toBeHidden();
  expect(submissions).toHaveLength(1);
});
