import {test,expect} from '@playwright/test';
const host='https://hohbsqkmrlhkstojfdgx.supabase.co',token='a'.repeat(64);
async function setup(page,{member=false,lost=false,missing=false}={}) {
  const calls=[];let claimed=false,created=false;
  await page.route('**/api/introduction',route=>route.fulfill({json:{supabaseUrl:host,anonKey:'synthetic-public',isStaging:true}}));
  await page.route(`${host}/**`,async route=>{
    const url=route.request().url(),body=route.request().postDataJSON();calls.push({url,body});
    let data;
    if(url.endsWith('/get_introduction_preview'))data=missing?null:{inviterFirstName:'Nick',inviterLastName:'Host',termsRevision:'introduction-giving-2026-v1-draft',marketingRevision:'introduction-marketing-2026-v1-draft',privacyRevision:'privacy-fixture'};
    else if(url.endsWith('/request-introduction-code')||url.endsWith('/otp'))data={status:'accepted'};
    else if(url.endsWith('/verify-introduction-code'))data={accessToken:'synthetic-session',email:'guest@example.test',expiresAt:9999999999};
    else if(url.endsWith('/verify'))data={access_token:'synthetic-session',user:{email:member?'member@example.test':'guest@example.test'}};
    else if(url.endsWith('/claim_introduction')) {claimed=true;const count=calls.filter(c=>c.url.endsWith('/claim_introduction')).length;if(lost&&count===1)return route.abort('failed');data={ok:true,claim_id:'claim-1'};}
    else if(url.endsWith('/get_claimed_introduction'))data=claimed||!member?{id:'claim-1',state:'claimed',inviter_first_name:'Nick',inviter_last_name:'Host'}:null;
    else if(url.endsWith('/get_introduction_invitations'))data=created?[{id:'inv-1',slot:1,state:'open'}]:[];
    else if(url.endsWith('/create_introduction_invitation')){created=true;data={ok:true,id:'inv-1',token};}
    else if(url.endsWith('/cancel_introduction_invitation')){created=false;data={ok:true};}
    else throw Error(`Unexpected request ${url}`);
    return route.fulfill({json:data});
  });
  return calls;
}
async function verify(page,email='guest@example.test') {
  await page.getByLabel('Email address',{exact:true}).fill(email);
  await page.getByRole('button',{name:'Send verification code',exact:true}).click();
  await page.getByLabel('Six-digit email code').fill('123456');
  await page.getByRole('button',{name:'Verify email',exact:true}).click();
}
test('browser claim separates optional consent, survives lost receipt, and stores no session',async({page},info)=>{
  const calls=await setup(page,{lost:true});await page.goto(`/introduction#invite=${token}`);await verify(page);
  await expect(page.locator('#marketing')).not.toBeChecked();
  await page.getByLabel('First name as shown on your ID').fill('Guest');await page.getByLabel('Last name as shown on your ID').fill('Friend');
  await page.locator('#over-21').check();await page.locator('#terms').check();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath('claim.png'),fullPage:true});
  await page.getByRole('button',{name:'Claim my Introduction'}).click();await expect(page.locator('#status')).toContainText('could not confirm');
  await expect(page.locator('#marketing')).toBeDisabled();await page.getByRole('button',{name:'Claim my Introduction'}).click();
  await expect(page.locator('#guest-view')).toBeVisible();const claims=calls.filter(c=>c.url.endsWith('/claim_introduction'));
  expect(claims).toHaveLength(2);expect(claims[0].body).toEqual(claims[1].body);expect(claims[0].body.p_marketing_opt_in).toBe(false);
  expect(calls.some(c=>c.url.includes(token))).toBe(false);
  expect(await page.evaluate(()=>[localStorage.length,sessionStorage.length,document.cookie])).toEqual([0,0,'']);
});
test('member creates, copies and cancels an unclaimed link',async({page},info)=>{
  const calls=await setup(page,{member:true});await page.goto('/introduction?view=member');await verify(page,'member@example.test');
  await page.getByRole('button',{name:'Create invitation link'}).click();
  await expect(page.locator('#invitation-link')).toHaveValue(new RegExp(`#invite=${token}$`));
  await page.screenshot({path:info.outputPath('member.png'),fullPage:true});
  await page.getByRole('button',{name:'Cancel unclaimed invitation'}).click();await expect(page.locator('#share-link')).toBeHidden();
  expect(calls.filter(c=>c.url.endsWith('/create_introduction_invitation'))).toHaveLength(1);
});
test('returning guest verifies email without needing the original bearer link',async({page})=>{
  const calls=await setup(page);await page.goto('/introduction?view=guest');await verify(page);await expect(page.locator('#guest-view')).toBeVisible();
  expect(calls.find(c=>c.url.endsWith('/otp')).body).toEqual({email:'guest@example.test',create_user:false});
  expect(calls.some(c=>c.url.endsWith('/claim_introduction'))).toBe(false);
});
test('unavailable invitation does not offer email collection',async({page})=>{
  await setup(page,{missing:true});await page.goto(`/introduction#invite=${token}`);await expect(page.locator('#status')).toContainText('unavailable');await expect(page.locator('#identity-form')).toBeHidden();
});

test('leaving a private page clears its session and visible guest record',async({page})=>{
  await setup(page);await page.goto('/introduction?view=guest');await verify(page);
  await expect(page.locator('#guest-details')).toContainText('Nick Host');
  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));
  await expect(page.locator('#guest-view')).toBeHidden();
  await expect(page.locator('#guest-details')).toBeEmpty();
  await expect(page.locator('#identity-form')).toBeVisible();
});
