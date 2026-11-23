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
    for(const name of ['identity-form','code-form','claim-form','guest-view','member-view','admin-view'])$(name).hidden=name!==id;
    $('view-claimed-navigation').hidden=id==='guest-view'||mode!=='claim';
    $('intro-heading').hidden=id==='guest-view'||id==='admin-view';
    $('invitation-eligibility').hidden=mode!=='claim'||id!=='identity-form'||!preview;
    $('introduction-terms').hidden=mode!=='claim'||!preview||id==='guest-view';
    if(id!=='guest-view')$('page-title').textContent=mode==='admin'?'Introduction exports':mode==='guest'?'View your Introduction':mode==='member'?'Manage your invitations':'The Introduction';
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
  const run=async(fn)=>{if(busy)return;const generation=lifecycle;busy=true;document.querySelectorAll('button').forEach(b=>b.disabled=true);try{await fn();}catch(error){if(error.stale)return;if(error.status===401){session=null;show('identity-form');status('Your session expired. Verify your email again to continue.',true);}else status('Could not complete this request. Check your connection and try again.',true);}finally{if(generation===lifecycle){busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=false);}}};
  const claimFields=disabled=>$('claim-form').querySelectorAll('input').forEach(input=>input.disabled=disabled);
  const clear=(invalidate=true)=>{if(invalidate){lifecycle++;busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=false);}clearDownload();$('member-view').append($('share-link'));$('marketing-status').textContent='';$('withdraw-marketing').hidden=false;$('guest-marketing').open=false;$('code-destination').textContent='';$('guest-redemption-guide').textContent='When the bartender is ready, your inviter uses the DPC app to redeem both Pours.';$('guest-outcome').textContent='';claimFields(false);$('claim-form').reset();session=null;email='';createId=null;claimInput=null;sharedInvitationId=null;$('email').value='';$('code').value='';$('invitation-link').value='';$('share-link').hidden=true;$('sign-out').hidden=true;};
  async function sendCode(){
    status('Sending a verification code…');
    if(mode==='claim')await edge('request-introduction-code',{email,token:invite});
    else {try{await json(config.supabaseUrl+'/auth/v1/otp',{method:'POST',headers:headers(),body:JSON.stringify({email,create_user:false})});}catch(error){if(!(error.status>=400&&error.status<500&&error.status!==429))throw error;}}
    show('code-form');$('code-destination').textContent=`Email: ${email}`;status('If this email can continue, a code is on its way. Enter it below.');$('code').focus();
  }
  async function guestStatus(){
    const result=await rpc('get_claimed_introduction');
    show('guest-view');status('');
    $('guest-marketing').hidden=!result;
    $('guest-visit-instructions').hidden=result?.state!=='claimed';
    $('guest-outcome').hidden=!result||result.state==='claimed';
    if(!result){
      $('page-title').textContent='No Introduction found';
      $('guest-details').textContent='No Introduction has been claimed with this email. Open your friend’s original invitation link to claim. If you claimed with a different email, sign out below and verify that email instead.';
      $('guest-view').focus();return;
    }
    const inviter=`${result.inviter_first_name??''} ${result.inviter_last_name??''}`.trim()||'your inviter';
    const state=result.state;
    $('page-title').textContent=state==='redeemed'?'Introduction redeemed':state==='expired'?'Your Introduction has expired':'Your Introduction is claimed';
    $('guest-details').textContent=state==='redeemed'?`Redeemed with ${inviter}.`:state==='expired'?`Your unused Introduction from ${inviter} expired on December 31, 2026, Pacific time.`:`${inviter} invited you for a free Pour. It’s claimed and ready for a visit together.`;
    $('guest-outcome').textContent=state==='redeemed'?'Your Introduction has been used. There’s nothing else you need to do.':'This Introduction can no longer be redeemed. If this doesn’t look right, contact support using the link below.';
    $('guest-redemption-guide').textContent=`When the bartender is ready, ${inviter} uses the DPC app to redeem both Pours.`;
    $('guest-view').focus();
  }
  async function invitations(){
    const rows=await rpc('get_introduction_invitations');if(!Array.isArray(rows))throw Error();
    const list=$('invitations');$('member-view').append($('share-link'));list.replaceChildren();
    for(const row of rows){
      const article=document.createElement('article'),title=document.createElement('h3'),detail=document.createElement('p');
      title.textContent=row.guest_first_name?`${row.guest_first_name} ${row.guest_last_name}`:`Invitation ${row.slot}`;
      detail.textContent=({open:'Not claimed yet',claimed:'Claimed — ready when you are',redeemed:'Redeemed together',expired:'Expired'})[row.state]??'Unavailable';
      article.append(title,detail);
      if(row.id===sharedInvitationId&&row.state==='open'){article.append($('share-link'));}
      else if(row.id===sharedInvitationId){sharedInvitationId=null;$('share-link').hidden=true;$('invitation-link').value='';}
      else if(row.state==='open'){const recovery=document.createElement('p');recovery.className='note';recovery.textContent='Already sent your link? Your friend can still claim it. If you did not save or send it, cancel this unclaimed invitation and create a replacement. The old link will stop working.';article.append(recovery);}
      if(row.state==='open'){
        const cancel=document.createElement('button');cancel.type='button';cancel.className='secondary';cancel.textContent='Cancel unclaimed invitation';
        cancel.addEventListener('click',()=>void run(async()=>{const r=await rpc('cancel_introduction_invitation',{p_invitation_id:row.id});if(!r.ok){status('This invitation could not be canceled. It may already be claimed. Refresh the list.',true);return;}createId=null;if(sharedInvitationId===row.id){sharedInvitationId=null;$('share-link').hidden=true;$('invitation-link').value='';}await invitations();$('member-heading').focus();status('Unclaimed invitation canceled. You can create a replacement.');}));article.append(cancel);
      }
      list.append(article);
    }
    if(!rows.length){const p=document.createElement('p');p.textContent='No invitations yet. Create a personal link for your first friend.';list.append(p);}
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
  $('change-email').addEventListener('click',()=>{clear();show('identity-form');status('Enter your email to continue.');$('email').focus();});
  $('code-form').addEventListener('submit',event=>{event.preventDefault();void run(async()=>{
    status('Verifying your email…');const code=$('code').value.trim();
    try {
      if(mode==='claim'){const r=await edge('verify-introduction-code',{email,code});if(!r.accessToken||r.email!==email)throw Error();session=r.accessToken;}
      else {const r=await json(config.supabaseUrl+'/auth/v1/verify',{method:'POST',headers:headers(),body:JSON.stringify({email,token:code,type:'email'})});if(!r.access_token||r.user?.email?.toLowerCase()!==email)throw Error();session=r.access_token;}
      $('code').value='';$('sign-out').hidden=false;
      if(mode==='claim'){$('verified-email').textContent=email;show('claim-form');status('Email verified. Confirm your name and choices to claim.');$('first-name').focus();}
      else if(mode==='member'){await invitations();$('member-heading').focus();status('Manage your two Giving invitations here.');}
      else if(mode==='admin'){await contactPage(false,null,1);show('admin-view');$('admin-heading').focus();status('Full admin access verified. Choose an export.');}
      else await guestStatus();
    } catch(error) {if(error.stale)return;session=null;if(mode==='admin'&&error.status===403){$('sign-out').hidden=true;show('identity-form');status('This email does not have full admin download access. Use your full admin email or contact support.',true);$('email').focus();}else{show('code-form');status('Could not verify this code or open your account. Check the code, request a new one, or contact support.',true);}}
  });});
  $('claim-form').addEventListener('submit',event=>{event.preventDefault();void run(async()=>{
    if(!session||!$('over-21').checked||!$('terms').checked)return;
    if(!claimInput&&(!$('first-name').value.trim()||!$('last-name').value.trim())){status('Enter your first and last name as shown on your ID.',true);return;}
    claimInput??={p_token:invite,p_first_name:$('first-name').value.trim(),p_last_name:$('last-name').value.trim(),p_over_21:true,p_terms_revision:preview.termsRevision,p_privacy_revision:preview.privacyRevision,p_marketing_revision:preview.marketingRevision,p_marketing_opt_in:$('marketing').checked};
    claimFields(true);status('Claiming your Introduction…');
    try {const r=await rpc('claim_introduction',claimInput);
      if(!r.ok){if(r.reason==='verify_email'){session=null;await sendCode();status('Verify this email again, then retry your claim.');return;}claimInput=null;claimFields(false);status(({guest_ineligible:'This email is connected to a DPC membership, so it can’t claim an Introduction. Introductions are for people new to the Collective.',already_claimed:'You have already claimed an Introduction. Use View my claimed Introduction below.',invitation_unavailable:'This invitation is no longer available. Ask your inviter for help or view your claimed Introduction below.',consent_changed:'The terms or privacy notice changed. Reload this page to read the current versions before claiming.',feature_unavailable:'The Introduction is temporarily unavailable.'})[r.reason]??'This Introduction cannot be claimed right now. Contact your inviter or support.',true);return;}
      await guestStatus();status('We’ll email your details and a link back to this page.');
    } catch(error) {if(error.stale)return;if(error.status===401){session=null;show('identity-form');status('Your session expired. Verify your email again, or view your claimed Introduction below if you already claimed.',true);}else if(error.status>=400&&error.status<500){claimInput=null;claimFields(false);status('The claim was not accepted. Check your details and try again.',true);}else status('We could not confirm the claim. Keep this page open and retry; the same claim will not use another invitation.',true);}
  });});
  $('create-invitation').addEventListener('click',()=>void run(async()=>{
    createId??=crypto.randomUUID();status('Creating your invitation…');
    try {const r=await rpc('create_introduction_invitation',{p_request_id:createId});if(!r.ok){createId=null;status('An invitation could not be created. Check your membership access and existing invitations.',true);return;}
      if(r.token){sharedInvitationId=r.id;const link=new URL('/introduction',location.origin);link.hash='invite='+r.token;$('invitation-link').value=link.href;$('share-link').hidden=false;status('Your link is ready to share. Save it before leaving this page.');}
      else status('This invitation was already created, but its private link cannot be recovered. If you did not save it, cancel the unclaimed invitation and create a replacement.',true);
      createId=null;await invitations();if(sharedInvitationId){$('invitation-link').focus();$('invitation-link').select();}
    } catch(error) {if(error.stale)return;if(error.status===401){session=null;show('identity-form');status('Your session expired. Verify your email again to continue.',true);}else if(error.status>=400&&error.status<500){createId=null;status('The invitation request was not accepted. Check your membership access and try again.',true);}else status('We could not confirm creation. Retry here with the same request. If it was created, no extra slot will be used.',true);}
  }));
  $('copy-link').addEventListener('click',()=>void run(async()=>{try{await navigator.clipboard.writeText($('invitation-link').value);status('Invitation link copied.');}catch{$('invitation-link').select();status('Select and copy the link above.');}}));
  $('withdraw-marketing').addEventListener('click',()=>void run(async()=>{
    const feedback=$('marketing-status');
    feedback.textContent='Stopping marketing emails…';feedback.dataset.error='false';
    try {
      const result=await rpc('withdraw_introduction_marketing');
      if(result?.marketing_allowed!==false)throw Error();
      feedback.textContent='Marketing emails are stopped. Your Introduction is unchanged.';
      $('withdraw-marketing').hidden=true;
      status('');
    } catch(error) {
      if(error.stale)throw error;
      feedback.textContent='We couldn’t confirm the change. Try Stop marketing emails again.';feedback.dataset.error='true';
      if(error.status===401){feedback.textContent='';throw error;}
      status('Could not complete this request. Check your connection and try again.',true);
    }
  }));
  $('export-all').addEventListener('click',()=>void run(()=>prepareExport(false)));
  $('export-marketing').addEventListener('click',()=>void run(()=>prepareExport(true)));
  $('refresh-invitations').addEventListener('click',()=>void run(async()=>{await invitations();status('Invitations refreshed.');}));
  $('sign-out').addEventListener('click',()=>{clear();show('identity-form');status('Signed out of this page. Verify your email to return.');});
  window.addEventListener('pagehide',()=>{clear();$('guest-details').textContent='';$('verified-email').textContent='';$('invitations').replaceChildren();show('identity-form');status('Verify your email to return.');});
  void run(async()=>{
    config=await json('/api/introduction');
    if(config.isStaging){const draft=document.createElement('p');draft.className='note';draft.textContent='Staging test — no real venue redemption.';$('intro-heading').after(draft);}
    if(mode==='claim'){
      if(!/^[a-f0-9]{64}$/.test(invite??'')){status('This invitation link is invalid. Ask your friend for their original link.',true);return;}
      preview=await rpc('get_introduction_preview',{p_token:invite},false);
      if(!preview){status('This invitation is unavailable. It may be claimed, canceled, expired or temporarily paused. Contact your inviter, or use View my claimed Introduction below.',true);return;}
      if(preview.termsRevision!==TERMS||preview.marketingRevision!==MARKETING||preview.privacyRevision!=='4.10'){status('This invitation is not ready to claim yet. Please try again later.',true);return;}
      $('intro-heading').textContent=`${preview.inviterFirstName} ${preview.inviterLastName} invited you for a free Pour. Claim here and visit together; your inviter redeems both Pours in the DPC app, so you don’t need to download it.`;
      $('introduction-terms').hidden=false;$('terms-revision').textContent='Giving offering — November 2026.';
    }else $('intro-heading').textContent=mode==='admin'?'Private guest contact downloads for full admins. Verify your DPC admin email to continue.':mode==='member'?'Give a friend a Pour. Verify your DPC member email to create and manage your two invitations.':'Already claimed your free Pour? Verify the same email you used to claim it to see your status and visit details. To claim a new invitation, open the link your friend sent you.';
    show('identity-form');$('email-label').textContent=mode==='member'?'DPC member email address':'Email address';$('email-help').textContent=mode==='member'?'Your app sign-in does not carry over to this browser. We’ll email you a six-digit code.':'We’ll send a six-digit verification code. Verifying your email does not subscribe you to marketing.';status(mode==='member'?'':'Verify your email to continue.');
  });
})();
