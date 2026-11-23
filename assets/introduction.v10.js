'use strict';
(() => {
  const $=id=>document.getElementById(id);
  const fragment=new URLSearchParams(location.hash.slice(1)), invite=fragment.get('invite');
  const view=new URLSearchParams(location.search).get('view');
  const mode=invite?'claim':['member','admin'].includes(view)?view:'guest';
  const TERMS='introduction-giving-2026-v1', MARKETING='introduction-marketing-2026-v1';
  let lifecycle=0;
  let config,preview,session=null,email='',busy=false,createId=null,claimInput=null,sharedInvitationId=null;
  const status=(message,error=false)=>{$('status').textContent=message;$('status').dataset.error=String(error);};
  const show=id=>{
    const memberOpen=id==='member-view';
    $('site-header').hidden=memberOpen;$('page-title').hidden=memberOpen;
    if(memberOpen)$('member-redemption-guide').after($('status'));else $('status-anchor').after($('status'));
    for(const name of ['identity-form','code-form','claim-form','guest-view','member-view','admin-view'])$(name).hidden=name!==id;
    $('view-claimed-navigation').hidden=id==='guest-view'||mode!=='claim';
    $('intro-heading').hidden=id==='guest-view'||id==='admin-view'||memberOpen;
    $('invitation-eligibility').hidden=mode!=='claim'||id!=='identity-form'||!preview;
    $('introduction-terms').hidden=mode!=='claim'||!preview||id==='guest-view';
    if(id!=='guest-view')$('page-title').textContent=mode==='admin'?'Introduction exports':mode==='guest'?"Find your invitation":mode==='member'?'Manage your invitations':preview?`${preview.inviterFirstName || 'Your friend'} invited you out for a drink`:'The Introduction';
  };
  const json=async(url,init={})=>{
    const generation=lifecycle;
    try{
      const r=await fetch(url,{...init,cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(10000)});
      const data=await r.json();
      if(generation!==lifecycle)throw Error('page_left');
      if(!r.ok){const error=Error(r.status===401?'verify_email':'request_failed');error.status=r.status;throw error;}
      return data;
    }catch(error){if(generation!==lifecycle){const stale=Error('page_left');stale.stale=true;throw stale;}throw error;}
  };
  const headers=(authenticated=false)=>({'Content-Type':'application/json',apikey:config.anonKey,Authorization:`Bearer ${authenticated?session:config.anonKey}`});
  const rpc=(name,args={},authenticated=true)=>json(`${config.supabaseUrl}/rest/v1/rpc/${name}`,{method:'POST',headers:headers(authenticated),body:JSON.stringify(args)});
  let downloadUrl=null,exportGeneration=0;
  const clearDownload=()=>{exportGeneration++;if(downloadUrl)URL.revokeObjectURL(downloadUrl);downloadUrl=null;$('download-contacts').hidden=true;$('download-contacts').removeAttribute('href');$('export-result').textContent='';};
  const contactColumns=['first_name','last_name','email','state','created_at','marketing_opt_in','marketing_eligible','marketing_revision','terms_revision','privacy_revision','expires_at','inviter_name'];
  async function contactPage(marketingOnly,afterId,limit=100){
    const page=await rpc('admin_introduction_contacts',{p_marketing_only:marketingOnly,p_limit:limit,p_after_id:afterId});
    if(!page||!Array.isArray(page.rows)||page.marketing_only!==marketingOnly||!(page.next_id===null||typeof page.next_id==='string'))throw Error('Invalid export');
    for(const row of page.rows){
      if(!row||typeof row.id!=='string'||contactColumns.filter(k=>!['state','marketing_opt_in','marketing_eligible'].includes(k)).some(k=>typeof row[k]!=='string')||typeof row.marketing_opt_in!=='boolean'||typeof row.marketing_eligible!=='boolean'||![null,'claimed','redeemed','expired'].includes(row.state)||marketingOnly&&(!row.marketing_opt_in||!row.marketing_eligible))throw Error('Invalid export');
    }
    return page;
  }
  function csvCell(value){let text=String(value??'').replace(/\0/g,'');if(/^[\s]*[=+\-@]/.test(text)||/^[\t\r\n]/.test(text))text="'"+text;return '"'+text.replace(/"/g,'""')+'"';}
  async function prepareExport(marketingOnly){
    clearDownload();const generation=exportGeneration;status('Preparing your CSV…');
    try{
      const rows=[],seen=new Set();let cursor=null;
      do{const page=await contactPage(marketingOnly,cursor);if(generation!==exportGeneration)return;rows.push(...page.rows);cursor=page.next_id;if(cursor){if(seen.has(cursor))throw Error('Invalid pagination');seen.add(cursor);}}while(cursor);
      const csv=[contactColumns.map(csvCell).join(','),...rows.map(row=>contactColumns.map(key=>csvCell(row[key])).join(','))].join('\r\n')+'\r\n';
      downloadUrl=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
      const link=$('download-contacts');link.href=downloadUrl;link.download=`dpc-introduction-${marketingOnly?'marketing-opt-ins':'all-contacts'}-${new Date().toISOString().slice(0,10)}.csv`;link.hidden=false;
      $('export-result').textContent=`${rows.length} ${rows.length===1?'guest':'guests'} in this ${marketingOnly?'marketing opt-in':'all-contact'} export. Download the CSV, then save it securely. Preparing the file does not send any emails.`;
      status('Your CSV is ready to download.');link.focus();
    }catch(error){if(generation!==exportGeneration)return;clearDownload();if(error.status===401)throw error;status('Could not prepare the export. Check your connection and full admin access, then try again.',true);}
  }
  const edge=(name,body)=>json(`${config.supabaseUrl}/functions/v1/${name}`,{method:'POST',headers:headers(),body:JSON.stringify(body)});
  const run=async(fn)=>{if(busy)return;const generation=lifecycle;busy=true;document.querySelectorAll('button').forEach(b=>b.disabled=true);try{await fn();}catch(error){if(error.stale)return;if(error.status===401){session=null;show('identity-form');status("Your session timed out. Confirm your email again to pick up where you left off.",true);}else status("Something didn't go through. Check your connection and try again.",true);}finally{if(generation===lifecycle){busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=false);}}};
  const claimFields=disabled=>$('claim-form').querySelectorAll('input').forEach(input=>input.disabled=disabled);
  const clear=(invalidate=true)=>{if(invalidate){lifecycle++;busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=false);}clearDownload();$('member-view').append($('share-link'));$('marketing-status').textContent='';$('withdraw-marketing').hidden=false;$('guest-marketing').open=false;$('code-destination').textContent='';$('guest-redemption-guide').textContent="When you order, your friend pulls up both drinks in their app for the bartender.";$('guest-outcome').textContent='';$('guest-venue-guide').textContent='Pick one of our partner venues with your friend and go together.';$('guest-covered-guide').textContent='Your drink is covered by us, not by your friend.';claimFields(false);$('claim-form').reset();session=null;email='';createId=null;claimInput=null;sharedInvitationId=null;$('email').value='';$('code').value='';$('invitation-link').value='';$('share-link').hidden=true;$('sign-out').hidden=true;};
  async function sendCode(){
    status("Emailing your code…");
    if(mode==='claim')await edge('request-introduction-code',{email,token:invite});
    else {try{await json(config.supabaseUrl+'/auth/v1/otp',{method:'POST',headers:headers(),body:JSON.stringify({email,create_user:false})});}catch(error){if(!(error.status>=400&&error.status<500&&error.status!==429))throw error;}}
    show('code-form');$('code-destination').textContent=`Email: ${email}`;status(mode==='member'?"Check your inbox for a six-digit code. It only goes to the email on your DPC membership, so if nothing shows up in a couple of minutes, check spam or try the email you joined with.":"Check your inbox for a six-digit code. If it isn't there in a couple of minutes, check spam or send a new one.");$('code').focus();
  }
  async function guestStatus(){
    const result=await rpc('get_claimed_introduction');
    show('guest-view');status('');
    $('guest-marketing').hidden=!result;
    $('guest-membership').hidden=result?.state!=='redeemed';
    $('guest-visit-instructions').hidden=result?.state!=='claimed';
    $('guest-outcome').hidden=!result||result.state==='claimed';
    if(!result){
      $('page-title').textContent="We couldn't find an invitation";
      $('guest-details').textContent="We don't see a claimed invitation for this email. If a friend sent you a link, open it to claim. If you claimed with a different email, sign out below and use that one.";
      $('guest-view').focus();return;
    }
    const inviter=result.inviter_first_name?.trim()||'your friend';
    const state=result.state;
    $('page-title').textContent=state==='redeemed'?"You've used your invitation":state==='expired'?"This invitation has expired":"You're all set";
    $('guest-details').textContent=state==='redeemed'?`Enjoyed with ${inviter}${result.venue_name ? ` at ${result.venue_name}` : ''}.`:state==='expired'?`Your invitation from ${inviter} wasn't used by December 31, so it has expired.`:`Your drink with ${inviter} is on us. Now pick a day to go together.`;
    $('guest-outcome').textContent=state==='redeemed'?`Thanks for coming out with ${inviter}. We hope to see you downtown again soon.`:"This invitation can't be used anymore. If that doesn't look right, contact us using the link below.";
    $('guest-redemption-guide').textContent=`${inviter} takes care of it at the bar. When you order, they pull up both drinks in their app for the bartender. You don't need to download anything or do anything on this page.`;
    $('guest-venue-guide').textContent=`Pick one of our partner venues with ${inviter} and go together. ${inviter}'s app shows which venues are available that day.`;
    $('guest-covered-guide').textContent=`Your drink is covered by us, not by ${inviter}.`;
    $('guest-view').focus();
  }
  async function invitations(){
    const rows=await rpc('get_introduction_invitations');if(!Array.isArray(rows))throw Error();
    const list=$('invitations');$('member-view').append($('share-link'));list.replaceChildren();
    for(const row of rows){
      const article=document.createElement('article'),title=document.createElement('h3'),detail=document.createElement('p');
      title.textContent=row.guest_first_name?`${row.guest_first_name} ${row.guest_last_name}`:`Invitation ${row.slot}`;
      detail.textContent=({open:"Waiting for your friend to claim",claimed:"Claimed. Ready when you are",redeemed:"Enjoyed together",expired:'Expired'})[row.state]??'Unavailable';
      article.append(title,detail);
      if(row.id===sharedInvitationId&&row.state==='open'){article.append($('share-link'));}
      else if(row.id===sharedInvitationId){sharedInvitationId=null;$('share-link').hidden=true;$('invitation-link').value='';}
      else if(row.state==='open'){const recovery=document.createElement('p');recovery.className='note';recovery.textContent="Already sent your link? You're set. Your friend can still claim it.\nDidn't save it? Cancel this invitation and create a new link. The old one will stop working.";article.append(recovery);}
      if(row.state==='open'){
        const cancel=document.createElement('button');cancel.type='button';cancel.className='secondary';cancel.textContent="Cancel this link";
        cancel.addEventListener('click',()=>void run(async()=>{const r=await rpc('cancel_introduction_invitation',{p_invitation_id:row.id});if(!r.ok){status("We couldn't cancel this link. Your friend may have just claimed it. Refresh to check.",true);return;}createId=null;if(sharedInvitationId===row.id){sharedInvitationId=null;$('share-link').hidden=true;$('invitation-link').value='';}await invitations();$('member-heading').focus();status("Link canceled. Create a new one whenever you're ready.");}));article.append(cancel);
      }
      list.append(article);
    }
    if(!rows.length){const p=document.createElement('p');p.textContent="No invitations yet. Create a link for your first friend.";list.append(p);}
    $('create-invitation').hidden=rows.length>=2;
    show('member-view');
  }
  $('view-claimed-introduction').addEventListener('click',event=>{
    if(!session)return;
    event.preventDefault();
    void run(guestStatus);
  });
  $('identity-form').addEventListener('submit',event=>{event.preventDefault();void run(async()=>{const nextEmail=$('email').value.trim().toLowerCase();if(email&&email!==nextEmail){clear(false);$('email').value=nextEmail;}email=nextEmail;await sendCode();});});
  $('resend').addEventListener('click',()=>void run(sendCode));
  $('change-email').addEventListener('click',()=>{clear();show('identity-form');status("Confirm your email to continue.");$('email').focus();});
  $('code-form').addEventListener('submit',event=>{event.preventDefault();void run(async()=>{
    status("Checking your code…");const code=$('code').value.trim();
    try {
      if(mode==='claim'){const r=await edge('verify-introduction-code',{email,code});if(!r.accessToken||r.email!==email)throw Error();session=r.accessToken;}
      else {const r=await json(config.supabaseUrl+'/auth/v1/verify',{method:'POST',headers:headers(),body:JSON.stringify({email,token:code,type:'email'})});if(!r.access_token||r.user?.email?.toLowerCase()!==email)throw Error();session=r.access_token;}
      $('code').value='';$('sign-out').hidden=false;
      if(mode==='claim'){$('verified-email').textContent=email;show('claim-form');status("You're confirmed. Add your name to claim your drink.");$('first-name').focus();}
      else if(mode==='member'){await invitations();$('member-heading').focus();status('');}
      else if(mode==='admin'){await contactPage(false,null,1);show('admin-view');$('admin-heading').focus();status('Full admin access verified. Choose an export.');}
      else await guestStatus();
    } catch(error) {if(error.stale)return;session=null;if(mode==='admin'&&error.status===403){$('sign-out').hidden=true;show('identity-form');status('This email does not have full admin download access. Use your full admin email or contact support.',true);$('email').focus();}else{show('code-form');status("We couldn't confirm that code or open your page. Try it again, send a new one, or contact us.",true);}}
  });});
  $('claim-form').addEventListener('submit',event=>{event.preventDefault();void run(async()=>{
    if(!session||!$('over-21').checked||!$('terms').checked)return;
    if(!claimInput&&(!$('first-name').value.trim()||!$('last-name').value.trim())){status("Enter your first and last name as they appear on your ID.",true);return;}
    claimInput??={p_token:invite,p_first_name:$('first-name').value.trim(),p_last_name:$('last-name').value.trim(),p_over_21:true,p_terms_revision:preview.termsRevision,p_privacy_revision:preview.privacyRevision,p_marketing_revision:preview.marketingRevision,p_marketing_opt_in:$('marketing').checked};
    claimFields(true);status("Claiming your drink…");
    try {const r=await rpc('claim_introduction',claimInput);
      if(!r.ok){if(r.reason==='verify_email'){session=null;await sendCode();status("Please confirm your email again, then try claiming once more.");return;}claimInput=null;claimFields(false);status(({guest_ineligible:"This email belongs to a Downtown Pour Collective member, so it can't claim an invitation. These are for people who are new to us.",already_claimed:"You've already claimed an invitation with this email. Tap Find my invitation below to see it.",invitation_unavailable:"This invitation isn't available anymore. Check with the friend who sent it, or find an invitation you already claimed below.",consent_changed:"Our terms or privacy policy just changed. Reload the page to read the latest before you claim.",feature_unavailable:"The Introduction is paused for a moment. Please try again shortly."})[r.reason]??"This invitation can't be claimed right now. Check with the friend who sent it, or contact us.",true);return;}
      await guestStatus();status("We'll email you these details with a link back to this page.");
    } catch(error) {if(error.stale)return;if(error.status===401){session=null;show('identity-form');status("Your session timed out. Confirm your email again, or find your invitation below if you already claimed it.",true);}else if(error.status>=400&&error.status<500){claimInput=null;claimFields(false);status("That didn't go through. Check your details and try again.",true);}else status("We couldn't confirm your claim yet. Keep this page open and tap Claim my drink again. It's safe to retry.",true);}
  });});
  $('create-invitation').addEventListener('click',()=>void run(async()=>{
    createId??=crypto.randomUUID();status("Creating your link…");
    try {const r=await rpc('create_introduction_invitation',{p_request_id:createId});if(!r.ok){createId=null;status("We couldn't create a link. Make sure your membership is active and you still have an invitation left.",true);return;}
      if(r.token){sharedInvitationId=r.id;const link=new URL('/introduction',location.origin);link.hash='invite='+r.token;$('invitation-link').value=link.href;$('share-link').hidden=false;status("Your link is ready. Copy it before you leave this page.");}
      else status("This link was already created, but we can't show it again. If you didn't save it, cancel this invitation and create a new link.",true);
      createId=null;await invitations();if(sharedInvitationId){$('invitation-link').focus();$('invitation-link').select();}
    } catch(error) {if(error.stale)return;if(error.status===401){session=null;show('identity-form');status("Your session timed out. Confirm your email again to pick up where you left off.",true);}else if(error.status>=400&&error.status<500){createId=null;status("We couldn't create that link. Make sure your membership is active and try again.",true);}else status("We couldn't confirm your link was created. Tap Create my link again. If the first one went through, you won't lose an invitation.",true);}
  }));
  $('copy-link').addEventListener('click',()=>void run(async()=>{try{await navigator.clipboard.writeText($('invitation-link').value);status("Link copied.");}catch{$('invitation-link').select();status('Select and copy the link above.');}}));
  $('withdraw-marketing').addEventListener('click',()=>void run(async()=>{
    const feedback=$('marketing-status');
    feedback.textContent="Updating your email settings…";feedback.dataset.error='false';
    try {
      const result=await rpc('withdraw_introduction_marketing');
      if(result?.marketing_allowed!==false)throw Error();
      feedback.textContent="Done. You won't get event and membership emails. Your invitation isn't affected.";
      $('withdraw-marketing').hidden=true;
      status('');
    } catch(error) {
      if(error.stale)throw error;
      feedback.textContent="That didn't save. Tap Stop event and membership emails again.";feedback.dataset.error='true';
      if(error.status===401){feedback.textContent='';throw error;}
      status("Something didn't go through. Check your connection and try again.",true);
    }
  }));
  $('export-all').addEventListener('click',()=>void run(()=>prepareExport(false)));
  $('export-marketing').addEventListener('click',()=>void run(()=>prepareExport(true)));
  $('refresh-invitations').addEventListener('click',()=>void run(async()=>{await invitations();status("Up to date.");}));
  $('sign-out').addEventListener('click',()=>{clear();show('identity-form');status("You're signed out. Confirm your email to come back.");});
  window.addEventListener('pagehide',()=>{clear();$('guest-details').textContent='';$('verified-email').textContent='';$('invitations').replaceChildren();show('identity-form');status("Confirm your email to continue.");});
  void run(async()=>{
    config=await json('/api/introduction');
    if(config.isStaging){const draft=document.createElement('p');draft.className='note';draft.textContent='Staging test — no real venue redemption.';$('sign-out').after(draft);}
    if(mode==='claim'){
      if(!/^[a-f0-9]{64}$/.test(invite??'')){status("This link doesn't work. Ask your friend to send their link again.",true);return;}
      preview=await rpc('get_introduction_preview',{p_token:invite},false);
      if(!preview){status("This invitation isn't available. It may have already been claimed or may have expired. Check with the friend who sent it, or find an invitation you already claimed below.",true);return;}
      if(preview.termsRevision!==TERMS||preview.marketingRevision!==MARKETING||preview.privacyRevision!=='4.10'){status("This invitation isn't ready yet. Please try again a little later.",true);return;}
      $('intro-heading').textContent=`Your first drink is on us. ${preview.inviterFirstName || 'Your friend'} is a member of Downtown Pour Collective, a Livermore membership that gets members drinks at local restaurants and bars every month. Claim your invitation here, then go out together. ${preview.inviterFirstName || 'Your friend'} takes care of everything at the bar, so there's nothing to download.`;
      $('claim-privacy').textContent=`${preview.inviterFirstName || 'Your friend'} will see your name and whether your invitation has been used. Your email and email choices stay private.`;
      $('introduction-terms').hidden=false;$('terms-revision').textContent="";
    }else $('intro-heading').textContent=mode==='admin'?'Private guest contact downloads for full admins. Verify your DPC admin email to continue.':mode==='member'?"Give a friend a Pour. Confirm your member email and we'll take you to your two invitations.":"Already claimed your drink? Enter the email you used and we'll send a code to pull it up. Got a new invitation from a friend? Open the link they sent you instead.";
    show('identity-form');$('email-label').textContent=mode==='member'?"The email you use for DPC":"Your email";$('email-help').textContent=mode==='member'?"This page opens in your browser, so we'll email you a quick six-digit code to confirm it's you.":"We'll email you a six-digit code to confirm it's you. This doesn't sign you up for marketing.";status(mode==='member'?'':"Confirm your email to continue.");
  });
})();
