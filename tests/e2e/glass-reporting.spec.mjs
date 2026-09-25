import { test, expect } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
import { summary, emptySummary } from '../reporting-fixtures.mjs';
const authOrigin = 'https://hohbsqkmrlhkstojfdgx.supabase.co';
const authSession = () => ({ access_token:'test-access', refresh_token:'test-refresh', expires_at:Math.floor(Date.now()/1000)+3600, user:{id:'admin-id',email:'nick@example.com'},projectRef:'hohbsqkmrlhkstojfdgx' });
const csv = '\uFEFF"email","marketing_opt_in"\r\n"guest@example.com","true"\r\n';
async function setup(page, options={}) {
  const control = { config:true, status:200, report:summary(), csvStatus:200, signedIn:true, tokenStatus:200, gate:null, requests:[], refreshes:0, ...options };
  await page.addInitScript(({signedIn,expires}) => {
    if(signedIn)localStorage.setItem('dpc_admin_session',JSON.stringify({access_token:'test-access',refresh_token:'test-refresh',expires_at:expires,user:{id:'admin-id',email:'nick@example.com'},projectRef:'hohbsqkmrlhkstojfdgx'}));
  },{signedIn:control.signedIn,expires:control.expiresAt||authSession().expires_at});
  await page.route('**/api/glass-reporting?*',async route=>{
    const request=route.request(),kind=new URL(request.url()).searchParams.get('kind');control.requests.push({kind,authorization:request.headers().authorization});
    if(kind==='config')return route.fulfill({json:{configured:control.config,supabaseUrl:authOrigin,supabaseAnonKey:'sb_publishable_fixture',projectRef:'hohbsqkmrlhkstojfdgx'}});
    if(control.gate)await control.gate;
    if(kind==='summary')return route.fulfill({status:control.status,json:control.status===200?control.report:{message:'private error never shown'}});
    if(control.csvStatus!==200)return route.fulfill({status:control.csvStatus,json:{message:'unavailable'}});
    return route.fulfill({body:csv,headers:{'Content-Type':'text/csv; charset=utf-8','X-Report-Rows':'1','X-Report-As-Of':'2026-09-30T21:45:00Z'}});
  });
  await page.route(authOrigin+'/**',async route=>{
    if(route.request().url().includes('refresh_token'))control.refreshes++;
    return route.fulfill({status:control.tokenStatus,json:control.tokenStatus===200?authSession():{error:'invalid_credentials'}});
  });
  return control;
}
test('signed-out guests see login only; successful existing-account sign-in loads private results',async({page})=>{
  const c=await setup(page,{signedIn:false});await page.goto('/admin/glass-comes-back');
  await expect(page.locator('#sign-in')).toBeVisible();await expect(page.locator('#results')).toBeHidden();
  expect(c.requests.map(r=>r.kind)).toEqual(['config']);
  await page.getByLabel('Email',{exact:true}).fill('nick@example.com');await page.getByLabel('Password',{exact:true}).fill('test-only-password');
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.locator('#count-pickups')).toHaveText('12');await expect(page.locator('#count-tastings')).toHaveText('3');
  await expect(page.locator('#results-title')).toBeFocused();
  expect(c.requests.at(-1).authorization).toBe('Bearer test-access');
  expect(await page.locator('#password').inputValue()).toBe('');
});
test('results show distinct counts and all restaurant/date cells, and both CSVs download',async({page})=>{
  await setup(page);await page.goto('/admin/glass-comes-back');await expect(page.locator('#report')).toBeVisible();
  await expect(page.locator('#count-emails')).toHaveText('14');await expect(page.locator('#count-repeatTasters')).toHaveText('1');await expect(page.locator('#count-marketingContacts')).toHaveText('9');
  await expect(page.locator('#tasting-rows tr')).toHaveCount(5);await expect(page.locator('#tasting-rows td')).toHaveCount(25);
  await expect(page.locator('#tasting-totals td').last()).toHaveText('3');
  for(const kind of ['participation','marketing']) {
    const download=page.waitForEvent('download');await page.locator('[data-download="'+kind+'"]').click();const file=await download;
    expect(file.suggestedFilename()).toBe('glass-'+kind+'.csv');expect(await readFile(await file.path(),'utf8')).toBe(csv);
  }
  await expect(page.locator('#download-status')).toContainText('Downloaded 1 row');
  expect(await page.evaluate(()=>({w:innerWidth,content:document.documentElement.scrollWidth}))).toEqual({w:await page.evaluate(()=>innerWidth),content:await page.evaluate(()=>innerWidth)});
});
test('real empty results are shown; unavailable results never invent zeros or retain stale totals',async({page})=>{
  const c=await setup(page,{report:emptySummary()});await page.goto('/admin/glass-comes-back');await expect(page.locator('#empty')).toBeVisible();await expect(page.locator('#count-pickups')).toHaveText('0');
  c.status=503;await page.locator('#refresh').click();await expect(page.locator('#load-error')).toContainText('Refresh results');await expect(page.locator('#report')).toBeHidden();await expect(page.locator('#count-pickups')).toHaveText('');
  c.status=200;c.report=summary();await page.locator('#refresh').click();await expect(page.locator('#count-pickups')).toHaveText('12');await expect(page.locator('#empty')).toBeHidden();
});
for(const status of [401,403])test('server '+status+' removes private results and gives the right recovery',async({page})=>{
  const c=await setup(page);await page.goto('/admin/glass-comes-back');await expect(page.locator('#report')).toBeVisible();c.status=status;await page.locator('#refresh').click();
  await expect(page.locator('#results')).toBeHidden();await expect(page.locator(status===401?'#sign-in':'#denied')).toBeVisible();
  await expect(page.locator(status===401?'#sign-in-title':'#denied-title')).toBeFocused();
  await expect(page.locator('#count-pickups')).toHaveText('');
  if(status===401)expect(await page.evaluate(()=>localStorage.getItem('dpc_admin_session'))).toBeNull();
});
test('expired session refreshes once before loading, and failed renewal asks for sign-in',async({page})=>{
  const c=await setup(page,{expiresAt:1});await page.goto('/admin/glass-comes-back');await expect(page.locator('#report')).toBeVisible();expect(c.refreshes).toBe(1);
  c.tokenStatus=401;await page.reload();await expect(page.locator('#sign-in')).toBeVisible();await expect(page.locator('#sign-in-message')).toContainText('expired');
});
test('failed download is not saved and existing results stay visible',async({page})=>{
  const c=await setup(page,{csvStatus:503});let downloads=0;page.on('download',()=>downloads++);await page.goto('/admin/glass-comes-back');await expect(page.locator('#report')).toBeVisible();
  await page.locator('[data-download="marketing"]').click();await expect(page.locator('#download-error')).toBeVisible();await expect(page.locator('#report')).toBeVisible();expect(downloads).toBe(0);
  c.csvStatus=200;const download=page.waitForEvent('download');await page.locator('[data-download="marketing"]').click();await download;await expect(page.locator('#download-error')).toBeHidden();
});
test('returning to the tab preserves results and a CSV that is still downloading',async({page})=>{
  const c=await setup(page);await page.goto('/admin/glass-comes-back');await expect(page.locator('#report')).toBeVisible();
  let release;c.gate=new Promise(r=>release=r);
  const download=page.waitForEvent('download');await page.locator('[data-download="participation"]').click();
  await expect.poll(()=>c.requests.some(r=>r.kind==='participation')).toBe(true);
  const before=c.requests.filter(r=>r.kind==='summary').length;
  const visible=await page.evaluate(()=>{
    Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));
    return !document.getElementById('report').hidden;
  });
  release();
  expect(visible).toBe(true);await expect(page.locator('#count-pickups')).toHaveText('12');
  const file=await download;expect(await readFile(await file.path(),'utf8')).toBe(csv);
  expect(c.requests.filter(r=>r.kind==='summary')).toHaveLength(before);
});
test('refresh leaves a handed-off CSV readable; sign-out still releases it',async({page})=>{
  await setup(page);await page.goto('/admin/glass-comes-back');await expect(page.locator('#report')).toBeVisible();
  await page.clock.install();await page.clock.pauseAt(new Date());
  await page.evaluate(()=>{
    const create=URL.createObjectURL.bind(URL);URL.createObjectURL=blob=>{window.lastDownloadUrl=create(blob);return window.lastDownloadUrl;};
  });
  const download=page.waitForEvent('download');await page.locator('[data-download="marketing"]').click();await download;
  await page.locator('#refresh').click();await expect(page.locator('#report')).toBeVisible();
  expect(await page.evaluate(async()=>{try{return await(await fetch(window.lastDownloadUrl)).text();}catch{return null;}})).toBe(csv.replace(/^\uFEFF/,''));
  await page.locator('#sign-out').click();
  expect(await page.evaluate(async()=>{try{await fetch(window.lastDownloadUrl);return true;}catch{return false;}})).toBe(false);
});
test('sign-out prevents a delayed export or response from restoring private data',async({page})=>{
  const c=await setup(page);let downloads=0;page.on('download',()=>downloads++);await page.goto('/admin/glass-comes-back');await expect(page.locator('#report')).toBeVisible();
  let release;c.gate=new Promise(r=>release=r);await page.locator('[data-download="participation"]').click();await expect.poll(()=>c.requests.some(r=>r.kind==='participation')).toBe(true);
  await page.locator('#sign-out').click();release();await expect(page.locator('#sign-in')).toBeVisible();await expect(page.locator('#report')).toBeHidden();expect(downloads).toBe(0);
  await expect(page.locator('#sign-in-title')).toBeFocused();
  expect(await page.evaluate(()=>localStorage.getItem('dpc_admin_session'))).toBeNull();
});
test('configuration failure gives recovery and never offers downloads',async({page})=>{
  const c=await setup(page,{config:false});await page.goto('/admin/glass-comes-back');await expect(page.locator('#boot-message')).toContainText('unavailable');await expect(page.locator('#results')).toBeHidden();
  c.config=true;await page.locator('#boot-retry').click();await expect(page.locator('#report')).toBeVisible();
});
test('blocked storage still permits an in-memory sign-in and keyboard operation',async({page})=>{
  await setup(page,{signedIn:false});await page.addInitScript(()=>{Storage.prototype.getItem=()=>{throw Error('blocked')};Storage.prototype.setItem=()=>{throw Error('blocked')};Storage.prototype.removeItem=()=>{throw Error('blocked')};});
  await page.goto('/admin/glass-comes-back');await page.getByLabel('Email',{exact:true}).fill('nick@example.com');await page.getByLabel('Password',{exact:true}).fill('test-password');await page.getByLabel('Password',{exact:true}).press('Enter');await expect(page.locator('#report')).toBeVisible();
  await page.locator('#refresh').focus();await expect(page.locator('#refresh')).toBeFocused();await page.locator('#refresh').press('Enter');await expect(page.locator('#report')).toBeVisible();
  await expect(page.locator('#refresh')).toBeFocused();
});
test('capture reporting desktop and mobile evidence',async({page},testInfo)=>{
  test.skip(!process.env.CAPTURE_GLASS_REPORTING || testInfo.project.name==='mobile-webkit','Capture-only check');
  await setup(page);await page.goto('/admin/glass-comes-back');await expect(page.locator('#report')).toBeVisible();
  await mkdir('.impeccable/review',{recursive:true});await page.screenshot({path:'.impeccable/review/'+(testInfo.project.name==='desktop-chromium'?'desktop':'mobile')+'.png',fullPage:true});
});
