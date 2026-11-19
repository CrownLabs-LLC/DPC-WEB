import {test,expect} from '@playwright/test';
const host='https://hohbsqkmrlhkstojfdgx.supabase.co',token='a'.repeat(64);
async function setup(page,{member=false,lost=false,missing=false}={}) {
  const calls=[];let claimed=false,created=false;
  await page.route('**/api/introduction',route=>route.fulfill({json:{supabaseUrl:host,anonKey:'synthetic-public',isStaging:true}}));
  await page.route(`${host}/**`,async route=>{
    const url=route.request().url(),body=route.request().postDataJSON();calls.push({url,body});
    let data;
    if(url.endsWith('/get_introduction_preview'))data=missing?null:{inviterFirstName:'Nick',inviterLastName:'Host',termsRevision:'introduction-giving-2026-v1',marketingRevision:'introduction-marketing-2026-v1',privacyRevision:'4.10'};
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
  await expect(page.locator('#guest-redemption-guide')).not.toContainText('Nick Host');
  await expect(page.locator('#guest-outcome')).toBeEmpty();
  await expect(page.locator('#identity-form')).toBeVisible();
});
async function readyClaim(page) {
  await page.goto(`/introduction#invite=${token}`);await verify(page);
  await page.getByLabel('First name as shown on your ID').fill('Guest');
  await page.getByLabel('Last name as shown on your ID').fill('Friend');
  await page.locator('#over-21').check();await page.locator('#terms').check();
}
test('whitespace names stay editable without submitting a frozen claim',async({page})=>{
  const calls=await setup(page);await readyClaim(page);await page.locator('#first-name').fill('   ');
  await page.getByRole('button',{name:'Claim my Introduction'}).click();
  await expect(page.locator('#status')).toContainText('Enter your first and last name');
  await expect(page.locator('#first-name')).toBeEnabled();expect(calls.some(c=>c.url.endsWith('/claim_introduction'))).toBe(false);
});
test('expired claim session asks for verification rather than endless retries',async({page})=>{
  await setup(page);await page.route(`${host}/rest/v1/rpc/claim_introduction`,r=>r.fulfill({status:401,json:{error:'expired'}}));
  await readyClaim(page);await page.getByRole('button',{name:'Claim my Introduction'}).click();
  await expect(page.locator('#identity-form')).toBeVisible();await expect(page.locator('#status')).toContainText('session expired');
  await expect(page.getByRole('link',{name:'View my claimed Introduction'})).toHaveAttribute('href','/introduction?view=guest');
});
for(const [reason,message] of [['already_claimed','You have already claimed'],['consent_changed','Reload this page']]) {
  test(`claim reason ${reason} gives the correct recovery`,async({page})=>{
    await setup(page);await page.route(`${host}/rest/v1/rpc/claim_introduction`,r=>r.fulfill({json:{ok:false,reason}}));
    await readyClaim(page);await page.getByRole('button',{name:'Claim my Introduction'}).click();
    await expect(page.locator('#status')).toContainText(message);await expect(page.locator('#first-name')).toBeEnabled();
  });
}
test('unknown returning email receives the same neutral code prompt',async({page})=>{
  await setup(page);await page.route(`${host}/auth/v1/otp`,r=>r.fulfill({status:400,json:{error:'unknown_user'}}));
  await page.goto('/introduction?view=guest');await page.getByLabel('Email address',{exact:true}).fill('unknown@example.test');
  await page.getByRole('button',{name:'Send verification code',exact:true}).click();
  await expect(page.locator('#code-form')).toBeVisible();await expect(page.locator('#status')).toContainText('If this email can continue');
});
test('canceling another slot preserves the newly created share link',async({page})=>{
  await setup(page,{member:true});let other=true;
  await page.route(`${host}/rest/v1/rpc/get_introduction_invitations`,r=>r.fulfill({json:[...(other?[{id:'other',slot:1,state:'open'}]:[]),{id:'inv-1',slot:2,state:'open'}]}));
  await page.goto('/introduction?view=member');await verify(page,'member@example.test');
  // Start with the first slot only so the create control is available.
  await page.unroute(`${host}/rest/v1/rpc/get_introduction_invitations`);
  await page.getByRole('button',{name:'Refresh invitations'}).click();
  await page.getByRole('button',{name:'Create invitation link'}).click();
  await page.route(`${host}/rest/v1/rpc/get_introduction_invitations`,r=>r.fulfill({json:[...(other?[{id:'other',slot:1,state:'open'}]:[]),{id:'inv-1',slot:2,state:'open'}]}));
  await page.getByRole('button',{name:'Refresh invitations'}).click();
  await page.route(`${host}/rest/v1/rpc/cancel_introduction_invitation`,r=>{other=false;return r.fulfill({json:{ok:true}});});
  await page.getByRole('button',{name:'Cancel unclaimed invitation'}).first().click();
  await expect(page.locator('#share-link')).toBeVisible();await expect(page.locator('#invitation-link')).toHaveValue(new RegExp(`#invite=${token}$`));
});

test('guest can withdraw marketing without changing the saved Introduction',async({page})=>{
 await setup(page);
 await page.route(`${host}/rest/v1/rpc/withdraw_introduction_marketing`,r=>r.fulfill({json:{marketing_allowed:false}}));
 await page.goto('/introduction?view=guest');await verify(page,'guest@example.test');
 await page.getByText('Email preferences',{exact:true}).click();
 await page.getByRole('button',{name:'Stop marketing emails',exact:true}).click();
 await expect(page.locator('#marketing-status')).toContainText('Marketing emails are stopped');
 await expect(page.locator('#guest-details')).toContainText('invited you for a free Pour');
});

test('failed withdrawal does not claim marketing was stopped',async({page})=>{
 await setup(page);await page.route(`${host}/rest/v1/rpc/withdraw_introduction_marketing`,r=>r.fulfill({status:503,json:{error:'unavailable'}}));
 await page.goto('/introduction?view=guest');await verify(page,'guest@example.test');
 await page.getByText('Email preferences',{exact:true}).click();
 await page.getByRole('button',{name:'Stop marketing emails',exact:true}).click();
 await expect(page.locator('#status')).toContainText('Could not complete');
 await expect(page.locator('#status')).not.toContainText('Marketing emails are stopped');
 await expect(page.locator('#marketing-status')).toContainText('Try Stop marketing emails again');
 await expect(page.locator('#marketing-status')).toBeInViewport();
 await expect(page.locator('#withdraw-marketing')).toBeEnabled();
 await expect(page.locator('#guest-details')).toContainText('invited you for a free Pour');
});

// Returning visitors may retain the original immutable asset for a year.
test('returning guest bypasses the old cached script and sees withdrawal feedback',async({page},info)=>{
 await setup(page);
 await page.route('**/assets/introduction.v1.js',r=>r.fulfill({contentType:'application/javascript',body:'/* stale pre-withdrawal script */'}));
 let finish;
 const pending=new Promise(resolve=>{finish=resolve;});
 await page.route(`${host}/rest/v1/rpc/withdraw_introduction_marketing`,async r=>{await pending;await r.fulfill({json:{marketing_allowed:false}});});
 await page.goto('/introduction?view=guest');await verify(page);
 await page.getByText('Email preferences',{exact:true}).click();
 await page.getByRole('button',{name:'Stop marketing emails',exact:true}).click();
 await expect(page.locator('#marketing-status')).toHaveText('Stopping marketing emails…');
 await expect(page.locator('#marketing-status')).toBeInViewport();
 finish();
 await expect(page.locator('#marketing-status')).toContainText('Marketing emails are stopped');
 await expect(page.locator('#marketing-status')).toBeInViewport();
 await expect(page.locator('#withdraw-marketing')).toBeHidden();
 await expect(page.locator('#guest-details')).toContainText('invited you for a free Pour');
 await page.screenshot({path:info.outputPath('withdrawal-confirmation.png'),fullPage:true});
 await page.getByRole('button',{name:'Sign out of this page',exact:true}).click();
 await expect(page.locator('#guest-redemption-guide')).not.toContainText('Nick Host');
 await expect(page.locator('#guest-outcome')).toBeEmpty();
 await verify(page);
 await expect(page.locator('#guest-marketing')).not.toHaveAttribute('open','');
 await page.getByText('Email preferences',{exact:true}).click();
 await expect(page.locator('#withdraw-marketing')).toBeVisible();
 await expect(page.locator('#marketing-status')).toBeEmpty();
});

test('view claimed Introduction opens the record from the verified claim page',async({page})=>{
 const fromClaim=true;
 const calls=await setup(page);
 await page.goto(fromClaim?`/introduction#invite=${token}`:'/introduction?view=guest');
 await verify(page);
 await expect(page.locator(fromClaim?'#claim-form':'#guest-view')).toBeVisible();
 const url=page.url();
 const requestsBefore=calls.filter(c=>c.url.endsWith('/get_claimed_introduction')).length;
 await page.getByRole('link',{name:'View my claimed Introduction',exact:true}).click();
 await expect(page.locator('#guest-details')).toContainText('Nick Host');
 await expect.poll(()=>calls.filter(c=>c.url.endsWith('/get_claimed_introduction')).length).toBe(requestsBefore+1);
 await expect(page.locator('#identity-form')).toBeHidden();
 await expect(page.locator('#view-claimed-navigation')).toBeHidden();
 expect(page.url()).toBe(url);
 expect(calls.filter(c=>c.url.endsWith('/verify')||c.url.endsWith('/verify-introduction-code'))).toHaveLength(1);
});

test('view claimed Introduction requests verification when its session expires',async({page})=>{
 await setup(page);await page.goto(`/introduction#invite=${token}`);await verify(page);
 await expect(page.locator('#claim-form')).toBeVisible();
 await page.route(`${host}/rest/v1/rpc/get_claimed_introduction`,r=>r.fulfill({status:401,json:{error:'expired'}}));
 await page.getByRole('link',{name:'View my claimed Introduction',exact:true}).click();
 await expect(page.locator('#identity-form')).toBeVisible();
 await expect(page.locator('#status')).toContainText('Your session expired');
 await expect(page.locator('#guest-view')).toBeHidden();
});

test('open guest record has no redundant view link or verification prompt',async({page},info)=>{
 await setup(page);
 await page.route(`${host}/rest/v1/rpc/get_claimed_introduction`,r=>r.fulfill({json:{id:'claim-1',state:'redeemed',inviter_first_name:'Nick',inviter_last_name:'Host'}}));
 await page.goto('/introduction?view=guest');await verify(page);
 await expect(page.locator('#guest-details')).toContainText('Redeemed with Nick Host');
 await expect(page.locator('#view-claimed-navigation')).toBeHidden();
 await expect(page.locator('#intro-heading')).toBeHidden();
 await expect(page.locator('#page-title')).toHaveText('Introduction redeemed');
 await page.screenshot({path:info.outputPath('redeemed-record.png'),fullPage:true});
 await page.getByRole('button',{name:'Sign out of this page',exact:true}).click();
 await expect(page.locator('#view-claimed-navigation')).toBeHidden();
 await expect(page.locator('#intro-heading')).toContainText('Verify the same email');
});

for(const state of ['claimed','redeemed','expired','missing'])test(`guest next steps match ${state} status`,async({page},info)=>{
 await setup(page);
 await page.route(`${host}/rest/v1/rpc/get_claimed_introduction`,r=>r.fulfill({json:state==='missing'?null:{id:'claim-1',state,inviter_first_name:'Nick',inviter_last_name:'Host'}}));
 await page.goto('/introduction?view=guest');
 await page.getByLabel('Email address',{exact:true}).fill('guest@example.test');
 await page.getByRole('button',{name:'Send verification code',exact:true}).click();
 await expect(page.locator('#code-destination')).toHaveText('Email: guest@example.test');
 await page.getByLabel('Six-digit email code').fill('123456');
 await page.getByRole('button',{name:'Verify email',exact:true}).click();
 await expect(page.locator('#guest-view')).toBeVisible();
 await expect(page.locator('#status')).toBeEmpty();
 await expect(page.locator('#view-claimed-navigation')).toBeHidden();
 if(state==='claimed'){
   await expect(page.locator('#page-title')).toHaveText('Your Introduction is claimed');
   await expect(page.locator('#guest-redemption-guide')).toContainText('Nick Host uses the DPC app');
   await expect(page.locator('#guest-visit-instructions')).toContainText('December 31, 2026');
   await expect(page.locator('#guest-visit-instructions')).toContainText('Friday and Saturday before 4 PM');
   expect(await page.locator('#guest-visit-instructions').evaluate(el=>Boolean(el.compareDocumentPosition(document.getElementById('guest-marketing'))&Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
 }else{
   await expect(page.locator('#guest-visit-instructions')).toBeHidden();
   if(state==='missing'){
     await expect(page.locator('#page-title')).toHaveText('No Introduction found');
     await expect(page.locator('#guest-details')).toContainText('original invitation link');
     await expect(page.locator('#guest-marketing')).toBeHidden();
   }else await expect(page.locator('#guest-outcome')).toContainText(state==='redeemed'?'nothing else you need to do':'can no longer be redeemed');
 }
 await expect(page.locator('#withdraw-marketing')).toBeHidden();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:info.outputPath(`${state}-guest.png`),fullPage:true});
});
