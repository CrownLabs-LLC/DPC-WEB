import {test, expect} from '@playwright/test';
const token = 'ab'.repeat(32);
test('hands a fragment invitation to DPC without sending the credential to the website', async ({page}) => {
  const requests = [];
  page.on('request', request => requests.push(request.url()));
  await page.goto(`/pour-partner#token=${token}`);
  const open = page.getByRole('link', {name:'Open in DPC', exact:true});
  await expect(open).toHaveAttribute('href', `dpc://pour-partner#token=${token}`);
  await expect(page.locator('#invalid')).toBeHidden();
  await expect(page.getByRole('link', {name:'Join first'})).toHaveAttribute('href','/join');
  await expect(page.locator('body')).not.toContainText(token);
  expect(requests.every(url => !url.includes(token))).toBe(true);
  expect(await page.evaluate(() => ({local:localStorage.length,session:sessionStorage.length}))).toEqual({local:0,session:0});
  await page.getByText('App didn’t open?', {exact:true}).click();
  await expect(page.getByText('Don’t have the app yet?', {exact:false})).toBeVisible();
  await page.screenshot({path:test.info().outputPath('pour-partner-invitation.png'),fullPage:true});
});
for (const suffix of ['', '#token=short', `?token=${token}`, `#token=${token}&next=https://evil.example`, `?next=evil#token=${token}`]) {
  test(`rejects malformed invitation ${suffix.slice(0,20)}`, async ({page}) => {
    await page.goto(`/pour-partner${suffix}`);
    await expect(page.locator('#invalid')).toBeVisible();
    await expect(page.getByRole('link',{name:'Open in DPC',exact:true})).toHaveCount(0);
    await expect(page.locator('#open-app')).not.toHaveAttribute('href');
  });
}
test('removes a previously valid destination when the fragment changes', async ({page}) => {
  await page.goto(`/pour-partner#token=${token}`);
  await page.evaluate(() => {location.hash='token=invalid';});
  await expect(page.locator('#open-app')).not.toHaveAttribute('href');
  await expect(page.locator('#invalid')).toBeVisible();
});
