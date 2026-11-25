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
  await page.getByLabel(/^(The email you use for DPC|Your email)$/).fill(email);
  await page.getByRole('button',{name:"Email me a code",exact:true}).click();
  await page.getByLabel("Six-digit code").fill('123456');
  await page.getByRole('button',{name:"Continue",exact:true}).click();
}
test('browser claim separates optional consent, survives lost receipt, and stores no session',async({page},info)=>{
  const calls=await setup(page,{lost:true});await page.goto(`/introduction#invite=${token}`);await verify(page);
  await expect(page.locator('#marketing')).not.toBeChecked();
  await page.getByLabel("First name (as it appears on your ID)").fill('Guest');await page.getByLabel("Last name (as it appears on your ID)").fill('Friend');
  await page.locator('#over-21').check();await page.locator('#terms').check();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath('claim.png'),fullPage:true});
  await page.getByRole('button',{name:"Claim my drink"}).click();await expect(page.locator('#status')).toContainText("couldn't confirm");
  await expect(page.locator('#marketing')).toBeDisabled();await page.getByRole('button',{name:"Claim my drink"}).click();
  await expect(page.locator('#guest-view')).toBeVisible();const claims=calls.filter(c=>c.url.endsWith('/claim_introduction'));
  expect(claims).toHaveLength(2);expect(claims[0].body).toEqual(claims[1].body);expect(claims[0].body.p_marketing_opt_in).toBe(false);
  expect(calls.some(c=>c.url.includes(token))).toBe(false);
  expect(await page.evaluate(()=>[localStorage.length,sessionStorage.length,document.cookie])).toEqual([0,0,'']);
});
test('member creates, copies and cancels an unclaimed link',async({page},info)=>{
  const calls=await setup(page,{member:true});await page.goto('/introduction?view=member');await verify(page,'member@example.test');
  await expect(page.locator('#member-heading')).toBeFocused();
  await page.getByRole('button',{name:"Create my link"}).click();
  await expect(page.locator('#invitation-link')).toBeFocused();
  await expect(page.locator('#invitations')).toContainText("Waiting for your friend to claim");
  await expect(page.locator('#invitations #share-link')).toBeVisible();
  await expect(page.locator('#invitation-link')).toHaveValue(new RegExp(`#invite=${token}$`));
  await page.screenshot({path:info.outputPath('member.png'),fullPage:true});
  await page.getByRole('button',{name:"Cancel this link"}).click();await expect(page.locator('#share-link')).toBeHidden();
  expect(calls.filter(c=>c.url.endsWith('/create_introduction_invitation'))).toHaveLength(1);
});
test('returning guest verifies email without needing the original bearer link',async({page})=>{
  const calls=await setup(page);await page.goto('/introduction?view=guest');await verify(page);await expect(page.locator('#guest-view')).toBeVisible();
  expect(calls.find(c=>c.url.endsWith('/otp')).body).toEqual({email:'guest@example.test',create_user:false});
  expect(calls.some(c=>c.url.endsWith('/claim_introduction'))).toBe(false);
});
test('unavailable invitation does not offer email collection',async({page})=>{
  await setup(page,{missing:true});await page.goto(`/introduction#invite=${token}`);await expect(page.locator('#status')).toContainText("isn't available");await expect(page.locator('#identity-form')).toBeHidden();
});

test('leaving a private page clears its session and visible guest record',async({page})=>{
  await setup(page);await page.goto('/introduction?view=guest');await verify(page);
  await expect(page.locator('#guest-details')).toContainText("Nick");
  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));
  await expect(page.locator('#guest-view')).toBeHidden();
  await expect(page.locator('#guest-details')).toBeEmpty();
  await expect(page.locator('#guest-redemption-guide')).not.toContainText("Nick");
  await expect(page.locator('#guest-outcome')).toBeEmpty();
  await expect(page.locator('#identity-form')).toBeVisible();
});
async function readyClaim(page) {
  await page.goto(`/introduction#invite=${token}`);await verify(page);
  await page.getByLabel("First name (as it appears on your ID)").fill('Guest');
  await page.getByLabel("Last name (as it appears on your ID)").fill('Friend');
  await page.locator('#over-21').check();await page.locator('#terms').check();
}
test('whitespace names stay editable without submitting a frozen claim',async({page})=>{
  const calls=await setup(page);await readyClaim(page);await page.locator('#first-name').fill('   ');
  await page.getByRole('button',{name:"Claim my drink"}).click();
  await expect(page.locator('#status')).toContainText('Enter your first and last name');
  await expect(page.locator('#first-name')).toBeEnabled();expect(calls.some(c=>c.url.endsWith('/claim_introduction'))).toBe(false);
});
test('expired claim session asks for verification rather than endless retries',async({page})=>{
  await setup(page);await page.route(`${host}/rest/v1/rpc/claim_introduction`,r=>r.fulfill({status:401,json:{error:'expired'}}));
  await readyClaim(page);await page.getByRole('button',{name:"Claim my drink"}).click();
  await expect(page.locator('#identity-form')).toBeVisible();await expect(page.locator('#status')).toContainText("session timed out");
  await expect(page.getByRole('link',{name:"Find my invitation"})).toHaveAttribute('href','/introduction?view=guest');
});
for(const [reason,message] of [['already_claimed',"You've already claimed"],['consent_changed','Reload the page']]) {
  test(`claim reason ${reason} gives the correct recovery`,async({page})=>{
    await setup(page);await page.route(`${host}/rest/v1/rpc/claim_introduction`,r=>r.fulfill({json:{ok:false,reason}}));
    await readyClaim(page);await page.getByRole('button',{name:"Claim my drink"}).click();
    await expect(page.locator('#status')).toContainText(message);await expect(page.locator('#first-name')).toBeEnabled();
  });
}
test('unknown returning email receives the same neutral code prompt',async({page})=>{
  await setup(page);await page.route(`${host}/auth/v1/otp`,r=>r.fulfill({status:400,json:{error:'unknown_user'}}));
  await page.goto('/introduction?view=guest');await page.getByLabel(/^(The email you use for DPC|Your email)$/).fill('unknown@example.test');
  await page.getByRole('button',{name:"Email me a code",exact:true}).click();
  await expect(page.locator('#code-form')).toBeVisible();await expect(page.locator('#status')).toContainText("Check your inbox for a six-digit code");
});
test('canceling another slot preserves the newly created share link',async({page})=>{
  await setup(page,{member:true});let other=true;
  await page.route(`${host}/rest/v1/rpc/get_introduction_invitations`,r=>r.fulfill({json:[...(other?[{id:'other',slot:1,state:'open'}]:[]),{id:'inv-1',slot:2,state:'open'}]}));
  await page.goto('/introduction?view=member');await verify(page,'member@example.test');
  // Start with the first slot only so the create control is available.
  await page.unroute(`${host}/rest/v1/rpc/get_introduction_invitations`);
  await page.getByRole('button',{name:"Refresh"}).click();
  await page.getByRole('button',{name:"Create my link"}).click();
  await page.route(`${host}/rest/v1/rpc/get_introduction_invitations`,r=>r.fulfill({json:[...(other?[{id:'other',slot:1,state:'open'}]:[]),{id:'inv-1',slot:2,state:'open'}]}));
  await page.getByRole('button',{name:"Refresh"}).click();
  await page.route(`${host}/rest/v1/rpc/cancel_introduction_invitation`,r=>{other=false;return r.fulfill({json:{ok:true}});});
  await page.getByRole('button',{name:"Cancel this link"}).first().click();
  await expect(page.locator('#share-link')).toBeVisible();await expect(page.locator('#invitation-link')).toHaveValue(new RegExp(`#invite=${token}$`));
});

test('guest can withdraw marketing without changing the saved Introduction',async({page})=>{
 await setup(page);
 await page.route(`${host}/rest/v1/rpc/withdraw_introduction_marketing`,r=>r.fulfill({json:{marketing_allowed:false}}));
 await page.goto('/introduction?view=guest');await verify(page,'guest@example.test');
 await page.getByText("Email settings",{exact:true}).click();
 await page.getByRole('button',{name:"Stop event and membership emails",exact:true}).click();
 await expect(page.locator('#marketing-status')).toContainText("You won't get event and membership emails");
 await expect(page.locator('#guest-details')).toContainText("Your drink with Nick is on us");
});

test('failed withdrawal does not claim marketing was stopped',async({page})=>{
 await setup(page);await page.route(`${host}/rest/v1/rpc/withdraw_introduction_marketing`,r=>r.fulfill({status:503,json:{error:"isn't available"}}));
 await page.goto('/introduction?view=guest');await verify(page,'guest@example.test');
 await page.getByText("Email settings",{exact:true}).click();
 await page.getByRole('button',{name:"Stop event and membership emails",exact:true}).click();
 await expect(page.locator('#status')).toContainText("Something didn't go through");
 await expect(page.locator('#status')).not.toContainText("You won't get event and membership emails");
 await expect(page.locator('#marketing-status')).toContainText("Tap Stop event and membership emails again");
 await expect(page.locator('#marketing-status')).toBeInViewport();
 await expect(page.locator('#withdraw-marketing')).toBeEnabled();
 await expect(page.locator('#guest-details')).toContainText("Your drink with Nick is on us");
});

// Returning visitors may retain the original immutable asset for a year.
test('returning guest bypasses the old cached script and sees withdrawal feedback',async({page},info)=>{
 await setup(page);
 await page.route('**/assets/introduction.v1.js',r=>r.fulfill({contentType:'application/javascript',body:'/* stale pre-withdrawal script */'}));
 let finish;
 const pending=new Promise(resolve=>{finish=resolve;});
 await page.route(`${host}/rest/v1/rpc/withdraw_introduction_marketing`,async r=>{await pending;await r.fulfill({json:{marketing_allowed:false}});});
 await page.goto('/introduction?view=guest');await verify(page);
 await page.getByText("Email settings",{exact:true}).click();
 await page.getByRole('button',{name:"Stop event and membership emails",exact:true}).click();
 await expect(page.locator('#marketing-status')).toHaveText("Updating your email settings…");
 await expect(page.locator('#marketing-status')).toBeInViewport();
 finish();
 await expect(page.locator('#marketing-status')).toContainText("You won't get event and membership emails");
 await expect(page.locator('#marketing-status')).toBeInViewport();
 await expect(page.locator('#withdraw-marketing')).toBeHidden();
 await expect(page.locator('#guest-details')).toContainText("Your drink with Nick is on us");
 await page.screenshot({path:info.outputPath('withdrawal-confirmation.png'),fullPage:true});
 await page.getByRole('button',{name:"Sign out",exact:true}).click();
 await expect(page.locator('#guest-redemption-guide')).not.toContainText("Nick");
 await expect(page.locator('#guest-outcome')).toBeEmpty();
 await verify(page);
 await expect(page.locator('#guest-marketing')).not.toHaveAttribute('open','');
 await page.getByText("Email settings",{exact:true}).click();
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
 await page.getByRole('link',{name:"Find my invitation",exact:true}).click();
 await expect(page.locator('#guest-details')).toContainText("Nick");
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
 await page.getByRole('link',{name:"Find my invitation",exact:true}).click();
 await expect(page.locator('#identity-form')).toBeVisible();
 await expect(page.locator('#status')).toContainText("Your session timed out");
 await expect(page.locator('#guest-view')).toBeHidden();
});

test('open guest record has no redundant view link or verification prompt',async({page},info)=>{
 await setup(page);
 await page.route(`${host}/rest/v1/rpc/get_claimed_introduction`,r=>r.fulfill({json:{id:'claim-1',state:'redeemed',inviter_first_name:'Nick',inviter_last_name:'Host'}}));
 await page.goto('/introduction?view=guest');await verify(page);
 await expect(page.locator('#guest-details')).toContainText("Enjoyed with Nick");
 await expect(page.locator('#view-claimed-navigation')).toBeHidden();
 await expect(page.locator('#intro-heading')).toBeHidden();
 await expect(page.locator('#page-title')).toHaveText("You've used your invitation");
 await page.screenshot({path:info.outputPath('redeemed-record.png'),fullPage:true});
 await page.getByRole('button',{name:"Sign out",exact:true}).click();
 await expect(page.locator('#view-claimed-navigation')).toBeHidden();
 await expect(page.locator('#intro-heading')).toContainText("Enter the email you used");
});

for(const state of ['claimed','redeemed','expired','missing'])test(`guest next steps match ${state} status`,async({page},info)=>{
 await setup(page);
 await page.route(`${host}/rest/v1/rpc/get_claimed_introduction`,r=>r.fulfill({json:state==='missing'?null:{id:'claim-1',state,inviter_first_name:'Nick',inviter_last_name:'Host'}}));
 await page.goto('/introduction?view=guest');
 await page.getByLabel(/^(The email you use for DPC|Your email)$/).fill('guest@example.test');
 await page.getByRole('button',{name:"Email me a code",exact:true}).click();
 await expect(page.locator('#code-destination')).toHaveText('Email: guest@example.test');
 await page.getByLabel("Six-digit code").fill('123456');
 await page.getByRole('button',{name:"Continue",exact:true}).click();
 await expect(page.locator('#guest-view')).toBeVisible();
 await expect(page.locator('#status')).toBeEmpty();
 await expect(page.locator('#view-claimed-navigation')).toBeHidden();
 if(state==='claimed'){
   await expect(page.locator('#page-title')).toHaveText("You're all set");
   await expect(page.locator('#guest-redemption-guide')).toContainText("Nick takes care of it at the bar");
   await expect(page.locator('#guest-visit-instructions')).toContainText("December 31");
   await expect(page.locator('#guest-visit-instructions')).toContainText("Friday and Saturday before 4pm");
   expect(await page.locator('#guest-visit-instructions').evaluate(el=>Boolean(el.compareDocumentPosition(document.getElementById('guest-marketing'))&Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
 }else{
   await expect(page.locator('#guest-visit-instructions')).toBeHidden();
   if(state==='missing'){
     await expect(page.locator('#page-title')).toHaveText("We couldn't find an invitation");
     await expect(page.locator('#guest-details')).toContainText("If a friend sent you a link");
     await expect(page.locator('#guest-marketing')).toBeHidden();
   }else await expect(page.locator('#guest-outcome')).toContainText(state==='redeemed'?"We hope to see you downtown again soon":"can't be used anymore");
 }
 await expect(page.locator('#withdraw-marketing')).toBeHidden();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:info.outputPath(`${state}-guest.png`),fullPage:true});
});

const contact=(id,overrides={})=>({id,first_name:'Guest',last_name:'Friend',email:'guest@example.test',state:'claimed',created_at:'2026-11-19T00:00:00Z',expires_at:'2027-01-01T08:00:00Z',marketing_opt_in:true,marketing_eligible:true,marketing_revision:'v1',terms_revision:'v1',privacy_revision:'4.10',inviter_name:'Host',...overrides});
test('admin downloads a named, escaped CSV across pages and clears it on signout',async({page})=>{
 await setup(page,{member:true});const scopes=[];
 await page.route(`${host}/rest/v1/rpc/admin_introduction_contacts`,r=>{const b=r.request().postDataJSON();scopes.push(b);return r.fulfill({json:{rows:b.p_limit===1?[]:b.p_after_id?[contact('b')]:[contact('a',{first_name:'=SUM(1,2)'})],next_id:b.p_limit===1||b.p_after_id?null:'a',marketing_only:b.p_marketing_only}});});
 await page.goto('/introduction?view=admin');await verify(page,'member@example.test');
 await expect(page.locator('#admin-heading')).toBeFocused();
 await expect(page.locator('#intro-heading')).toBeHidden();
 await page.getByRole('button',{name:'Prepare marketing opt-ins CSV',exact:true}).click();
 await expect(page.locator('#export-result')).toContainText('2 guests');
 await expect(page.locator('#download-contacts')).toBeFocused();
 const downloadPromise=page.waitForEvent('download');await page.getByRole('link',{name:'Download CSV file'}).click();const download=await downloadPromise;
 expect(download.suggestedFilename()).toMatch(/^dpc-introduction-marketing-opt-ins-.*\.csv$/);
 const stream=await download.createReadStream();let csv='';for await(const chunk of stream)csv+=chunk.toString();
 expect(csv).toContain('"\'=SUM(1,2)"');expect(csv).toContain('guest@example.test');
 expect(scopes.slice(1).every(b=>b.p_marketing_only===true)).toBe(true);
 await page.getByRole('button',{name:"Sign out"}).click();await expect(page.locator('#download-contacts')).not.toHaveAttribute('href');await expect(page.locator('#export-result')).toBeEmpty();
 expect(await page.evaluate(()=>[localStorage.length,sessionStorage.length])).toEqual([0,0]);
});
test('non-admin cannot open export controls',async({page})=>{
 await setup(page,{member:true});await page.route(`${host}/rest/v1/rpc/admin_introduction_contacts`,r=>r.fulfill({status:403,json:{error:'forbidden'}}));
 await page.goto('/introduction?view=admin');await verify(page,'member@example.test');await expect(page.locator('#admin-view')).toBeHidden();await expect(page.locator('#status')).toContainText('full admin download access');await expect(page.locator('#download-contacts')).not.toHaveAttribute('href');
});
test('marketing export refuses ineligible rows and exposes no file',async({page})=>{
 await setup(page,{member:true});await page.route(`${host}/rest/v1/rpc/admin_introduction_contacts`,r=>{const b=r.request().postDataJSON();return r.fulfill({json:{rows:b.p_limit===1?[]:[contact('a',{marketing_eligible:false})],next_id:null,marketing_only:b.p_marketing_only}});});
 await page.goto('/introduction?view=admin');await verify(page,'member@example.test');await page.getByRole('button',{name:'Prepare marketing opt-ins CSV'}).click();
 await expect(page.locator('#status')).toContainText('Could not prepare');await expect(page.locator('#download-contacts')).not.toHaveAttribute('href');
});
test('leaving during export cannot recreate a private download',async({page})=>{
 await setup(page,{member:true});let finish;const gate=new Promise(r=>finish=r);
 await page.route(`${host}/rest/v1/rpc/admin_introduction_contacts`,async r=>{const b=r.request().postDataJSON();if(b.p_limit!==1)await gate;await r.fulfill({json:{rows:[],next_id:null,marketing_only:b.p_marketing_only}});});
 await page.goto('/introduction?view=admin');await verify(page,'member@example.test');await page.getByRole('button',{name:'Prepare all contacts CSV'}).click();
 await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));finish();
 await expect(page.getByRole('button',{name:"Email me a code",exact:true})).toBeEnabled();await expect(page.locator('#download-contacts')).not.toHaveAttribute('href');
});

test('Introduction terms anchor remains below the sticky header',async({page},info)=>{
 await page.goto('/terms#sec-11-1');
 const target=page.locator('#sec-11-1');await expect(target).toBeVisible();
 await expect.poll(async()=>target.evaluate(el=>el.getBoundingClientRect().top)).toBeLessThan(200);
 await expect.poll(async()=>target.evaluate(el=>el.getBoundingClientRect().top)).toBeGreaterThanOrEqual(66);
 await page.screenshot({path:info.outputPath('introduction-terms-anchor.png')});
});

test('member controls survive leaving, re-verifying and creating a replacement link',async({page})=>{
 await setup(page,{member:true});await page.goto('/introduction?view=member');await verify(page,'member@example.test');
 await page.getByRole('button',{name:"Create my link"}).click();
 await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));
 await verify(page,'member@example.test');await expect(page.locator('#invitations')).toContainText('Already sent your link?');
 await page.getByRole('button',{name:"Cancel this link"}).click();await page.getByRole('button',{name:"Create my link"}).click();
 await expect(page.locator('#invitation-link')).toHaveValue(new RegExp(`#invite=${token}$`));
 await page.getByRole('button',{name:"Sign out"}).click();await expect(page.locator('#identity-form')).toBeVisible();await expect(page.locator('#member-view')).toBeHidden();
});
test('claimed invitations stop displaying their old share controls',async({page})=>{
 await setup(page,{member:true});await page.goto('/introduction?view=member');await verify(page,'member@example.test');await page.getByRole('button',{name:"Create my link"}).click();
 await page.route(`${host}/rest/v1/rpc/get_introduction_invitations`,r=>r.fulfill({json:[{id:'inv-1',slot:1,state:'claimed',guest_first_name:'Guest',guest_last_name:'Friend'}]}));
 await page.getByRole('button',{name:"Refresh"}).click();await expect(page.locator('#share-link')).toBeHidden();await expect(page.locator('#invitation-link')).toHaveValue('');
});

test('a late verification failure cannot reopen a page after leaving',async({page})=>{
 await setup(page,{member:true});let finish;const gate=new Promise(r=>finish=r);
 await page.route(`${host}/auth/v1/verify`,async r=>{await gate;await r.abort('failed');});
 await page.goto('/introduction?view=member');await page.getByLabel(/^(The email you use for DPC|Your email)$/).fill('member@example.test');await page.getByRole('button',{name:"Email me a code",exact:true}).click();await page.getByLabel("Six-digit code").fill('123456');await page.getByRole('button',{name:"Continue",exact:true}).click();
 await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));finish();
 await expect(page.locator('#identity-form')).toBeVisible();await expect(page.locator('#status')).toHaveText("Confirm your email to continue.");
 await expect(page.locator('#code-form')).toBeHidden();
});

test('a late withdrawal cannot leave feedback for the next guest session',async({page})=>{
 await setup(page);let finish;const gate=new Promise(r=>finish=r);
 await page.route(`${host}/rest/v1/rpc/withdraw_introduction_marketing`,async r=>{await gate;await r.fulfill({json:{marketing_allowed:false}});});
 await page.goto('/introduction?view=guest');await verify(page);await page.getByText("Email settings",{exact:true}).click();await page.getByRole('button',{name:"Stop event and membership emails",exact:true}).click();
 await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));finish();
 await verify(page);await page.getByText("Email settings",{exact:true}).click();await expect(page.locator('#marketing-status')).toBeEmpty();await expect(page.locator('#status')).toBeEmpty();
});
test('late invitation creation cannot reopen a cleared member view',async({page})=>{
 await setup(page,{member:true});let finish;const gate=new Promise(r=>finish=r);
 await page.route(`${host}/rest/v1/rpc/create_introduction_invitation`,async r=>{await gate;await r.fulfill({json:{ok:true,id:'late',token}});});
 await page.goto('/introduction?view=member');await verify(page,'member@example.test');await page.getByRole('button',{name:"Create my link"}).click();
 await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));finish();
 await verify(page,'member@example.test');await expect(page.locator('#invitation-link')).toHaveValue('');await expect(page.locator('#share-link')).toBeHidden();
});

 test('member entry explains browser sign-in and never offers guest navigation', async ({page}, info) => {
   await setup(page,{member:true}); await page.goto('/introduction?view=member');
   await expect(page.locator('#page-title')).toHaveText('Manage your invitations');
   await expect(page.getByLabel("The email you use for DPC")).toBeVisible();
   await expect(page.locator('#email-help')).toContainText("This page opens in your browser");
   await expect(page.locator('#view-claimed-navigation')).toBeHidden();
   await page.screenshot({path: info.outputPath('member-entry.png'), fullPage:true});
   await verify(page,'member@example.test');
   await expect(page.getByRole('button',{name:"Create my link"})).toBeVisible();
   await expect(page.locator('#view-claimed-navigation')).toBeHidden();
 });

test('verified members start at their invitations with clear paired guidance', async ({page}, info) => {
 await setup(page,{member:true});await page.goto('/introduction?view=member');
 await page.getByLabel("The email you use for DPC").fill('member@example.test');
 await page.getByRole('button',{name:"Email me a code",exact:true}).click();
 await expect(page.locator('#status')).toContainText("It only goes to the email on your DPC membership");
 await page.getByLabel("Six-digit code").fill('123456');
 await page.getByRole('button',{name:"Continue",exact:true}).click();
 await expect(page.getByRole('heading',{name:'Your Introductions',level:1})).toBeVisible();
 for(const id of ['site-header','page-title','intro-heading'])await expect(page.locator('#'+id)).toBeHidden();
 await expect(page.locator('#member-redemption-guide')).toContainText("instead of Redeem Pour");
 await expect(page.locator('#member-redemption-guide')).toContainText("doesn't come out of your Pours");
 await expect(page.locator('#status')).toBeEmpty();
 await page.getByRole('button',{name:"Create my link"}).click();
 const gap=await page.locator('#copy-link').evaluate(el=>el.nextElementSibling.getBoundingClientRect().top-el.getBoundingClientRect().bottom);
 expect(gap).toBeGreaterThanOrEqual(20);
 await page.screenshot({path:info.outputPath('member-simplified.png'),fullPage:true});
 await page.getByRole('button',{name:"Sign out"}).click();
 await expect(page.locator('#page-title')).toBeVisible();await expect(page.locator('#site-header')).toBeVisible();
 await expect(page.locator('#status')).toContainText("You're signed out");
});

const overviewRow=(id,state,overrides={})=>({id,state,slot:1,inviter_member_id:'member-1',inviter_name:'Alex Member',inviter_email:'alex@example.test',guest_first_name:['claimed','redeemed','expired'].includes(state)?'Jamie':null,guest_last_name:['claimed','redeemed','expired'].includes(state)?'Guest':null,created_at:'2026-11-24T18:00:00Z',claimed_at:['claimed','redeemed','expired'].includes(state)?'2026-11-24T19:00:00Z':null,expires_at:'2027-01-01T08:00:00Z',...overrides});
async function adminSetup(page){
 await setup(page,{member:true});
 await page.route(`${host}/rest/v1/rpc/admin_introduction_contacts`,r=>{const b=r.request().postDataJSON();return r.fulfill({json:{rows:[],next_id:null,marketing_only:b.p_marketing_only}});});
 await page.goto('/introduction?view=admin');await verify(page,'member@example.test');
}
test('invitation overview shows all statuses, separate audiences and pagination',async({page},info)=>{
 await adminSetup(page);
 await page.route(`${host}/rest/v1/rpc/admin_introduction_invitations`,r=>{const b=r.request().postDataJSON();return r.fulfill({json:b.p_after_id?{rows:[overviewRow('f','open',{inviter_name:'<script>alert(1)</script>'})],next_id:null}:{rows:['open','claimed','redeemed','cancelled','expired'].map((s,i)=>overviewRow(String(i),s,{inviter_member_id:`member-${i}`,inviter_name:['Alex Member','Morgan Member','Sam Member','Alex Member','Taylor Member'][i],inviter_email:['alex','morgan','sam','alex','taylor'][i]+'@example.test'})),next_id:'4'}});});
 await page.getByRole('button',{name:'Load invitations',exact:true}).click();
 await expect(page.locator('#admin-invitations article')).toHaveCount(5);
 for(const label of ['Open · awaiting claim','Claimed','Redeemed','Canceled','Expired'])await expect(page.locator('#admin-invitations dd').filter({hasText:new RegExp(`^${label}$`)}).first()).toBeVisible();
 await expect(page.locator('#admin-invitations')).toContainText('alex@example.test');
 await expect(page.locator('#admin-invitations')).toContainText('Jan 1, 2027');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:info.outputPath('invitation-overview.png'),fullPage:true});
 await page.getByRole('button',{name:'Load more invitations',exact:true}).click();
 await expect(page.locator('#admin-invitations article')).toHaveCount(6);
 await expect(page.locator('#more-admin-invitations')).toBeHidden();
 await expect(page.locator('#admin-invitations h3').last()).toContainText('<script>');
 await expect(page.locator('#admin-invitations script')).toHaveCount(0);
 await page.getByRole('button',{name:'Sign out',exact:true}).click();
 await expect(page.locator('#admin-invitations')).toBeEmpty();await expect(page.locator('#admin-invitation-status')).toBeEmpty();
});
test('overview handles empty, failed, and revoked access without stale private records',async({page})=>{
 await adminSetup(page);
 await page.route(`${host}/rest/v1/rpc/admin_introduction_invitations`,r=>r.fulfill({json:{rows:[],next_id:null}}));
 await page.getByRole('button',{name:'Load invitations',exact:true}).click();await expect(page.locator('#admin-invitation-status')).toContainText('No invitation links');
 await page.route(`${host}/rest/v1/rpc/admin_introduction_invitations`,r=>r.fulfill({status:500,json:{error:'offline'}}));
 await page.getByRole('button',{name:'Load invitations',exact:true}).click();await expect(page.locator('#admin-invitation-status')).toContainText('Could not load');
 await page.route(`${host}/rest/v1/rpc/admin_introduction_invitations`,r=>r.fulfill({json:{rows:[overviewRow('a','open')],next_id:null}}));
 await page.getByRole('button',{name:'Load invitations',exact:true}).click();await expect(page.locator('#admin-invitations article')).toHaveCount(1);
 await page.route(`${host}/rest/v1/rpc/admin_introduction_invitations`,r=>r.fulfill({status:403,json:{error:'forbidden'}}));
 await page.getByRole('button',{name:'Load invitations',exact:true}).click();await expect(page.locator('#admin-view')).toBeHidden();await expect(page.locator('#admin-invitations')).toBeEmpty();
});
test('leaving during invitation load cannot restore private records',async({page})=>{
 await adminSetup(page);let finish;const gate=new Promise(resolve=>finish=resolve);
 await page.route(`${host}/rest/v1/rpc/admin_introduction_invitations`,async r=>{await gate;await r.fulfill({json:{rows:[overviewRow('a','open')],next_id:null}});});
 const request=page.waitForRequest(r=>r.url().endsWith('admin_introduction_invitations'));
 await page.getByRole('button',{name:'Load invitations',exact:true}).click();await request;
 await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));finish();
 await expect(page.locator('#admin-invitations')).toBeEmpty();await expect(page.locator('#admin-view')).toBeHidden();
});

for(const status of [401,403])test(`CSV access loss ${status} clears loaded invitation identity`,async({page})=>{
 await adminSetup(page);
 await page.route(`${host}/rest/v1/rpc/admin_introduction_invitations`,r=>r.fulfill({json:{rows:[overviewRow('a','open')],next_id:'a'}}));
 await page.getByRole('button',{name:'Load invitations',exact:true}).click();
 await expect(page.locator('#admin-invitations')).toContainText('alex@example.test');
 await page.route(`${host}/rest/v1/rpc/admin_introduction_contacts`,r=>r.fulfill({status,json:{error:'access_lost'}}));
 await page.getByRole('button',{name:'Prepare all contacts CSV',exact:true}).click();
 await expect(page.locator('#admin-invitations')).toBeEmpty();
 await expect(page.locator('#admin-view')).toBeHidden();
 await expect(page.locator('#more-admin-invitations')).toBeHidden();
 await expect(page.locator('#download-contacts')).not.toHaveAttribute('href');
 await expect(page.locator('#identity-form')).toBeVisible();
});
