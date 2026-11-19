'use strict';
(() => {
  const $=id=>document.getElementById(id);
  const fragment=new URLSearchParams(location.hash.slice(1)), invite=fragment.get('invite');
  const mode=invite?'claim':new URLSearchParams(location.search).get('view')==='member'?'member':'guest';
  const TERMS='introduction-giving-2026-v1-draft', MARKETING='introduction-marketing-2026-v1-draft';
  let config,preview,session=null,email='',busy=false,createId=null,claimInput=null;
  const status=(message,error=false)=>{$('status').textContent=message;$('status').dataset.error=String(error);};
  const show=id=>{for(const name of ['identity-form','code-form','claim-form','guest-view','member-view'])$(name).hidden=name!==id;};
  const json=async(url,init={})=>{const r=await fetch(url,{...init,cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(10000)});const data=await r.json();if(!r.ok)throw Error(r.status===401?'verify_email':'request_failed');return data;};
  const headers=(authenticated=false)=>({'Content-Type':'application/json',apikey:config.anonKey,Authorization:`Bearer ${authenticated?session:config.anonKey}`});
  const rpc=(name,args={},authenticated=true)=>json(`${config.supabaseUrl}/rest/v1/rpc/${name}`,{method:'POST',headers:headers(authenticated),body:JSON.stringify(args)});
  const edge=(name,body)=>json(`${config.supabaseUrl}/functions/v1/${name}`,{method:'POST',headers:headers(),body:JSON.stringify(body)});
  const run=async(fn)=>{if(busy)return;busy=true;document.querySelectorAll('button').forEach(b=>b.disabled=true);try{await fn();}catch{status('Could not complete this request. Check your connection and try again.',true);}finally{busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=false);}};
  const claimFields=disabled=>$('claim-form').querySelectorAll('input').forEach(input=>input.disabled=disabled);
  const clear=()=>{claimFields(false);$('claim-form').reset();session=null;email='';createId=null;claimInput=null;$('email').value='';$('code').value='';$('invitation-link').value='';$('share-link').hidden=true;$('sign-out').hidden=true;};
  async function sendCode(){
    status('Sending a verification code…');
    if(mode==='claim')await edge('request-introduction-code',{email,token:invite});
    else await json(config.supabaseUrl+'/auth/v1/otp',{method:'POST',headers:headers(),body:JSON.stringify({email,create_user:false})});
    show('code-form');status('If this email can continue, a code is on its way. Enter it below.');$('code').focus();
  }
  async function guestStatus(){
    const result=await rpc('get_claimed_introduction');
    show('guest-view');$('guest-visit-instructions').hidden=result?.state!=='claimed';$('guest-title').textContent=result?'Your Introduction':'No Introduction found';
    if(!result){$('guest-details').textContent='No claimed Introduction is attached to this verified email. Open your friend’s invitation link to claim.';return;}
    const inviter=`${result.inviter_first_name??''} ${result.inviter_last_name??''}`.trim();
    const state=result.state;
    $('guest-details').textContent=state==='redeemed'?`Redeemed with ${inviter}.`:state==='expired'?`Your unused Introduction from ${inviter} has expired.`:`Claimed from ${inviter}. Redeem together by December 31, 2026, Pacific time.`;
    status(state==='claimed'?'Your Introduction is saved. No app download is needed.':'This is your saved Introduction record.');$('guest-view').focus();
  }
  async function invitations(){
    const rows=await rpc('get_introduction_invitations');if(!Array.isArray(rows))throw Error();
    const list=$('invitations');list.replaceChildren();
    for(const row of rows){
      const article=document.createElement('article'),title=document.createElement('h3'),detail=document.createElement('p');
      title.textContent=row.guest_first_name?`${row.guest_first_name} ${row.guest_last_name}`:`Invitation ${row.slot}`;
      detail.textContent=({open:'Not claimed yet',claimed:'Claimed — ready to visit together',redeemed:'Redeemed together',expired:'Expired'})[row.state]??'Unavailable';
      article.append(title,detail);
      if(row.state==='open'){
        const cancel=document.createElement('button');cancel.type='button';cancel.className='secondary';cancel.textContent='Cancel unclaimed invitation';
        cancel.addEventListener('click',()=>void run(async()=>{const r=await rpc('cancel_introduction_invitation',{p_invitation_id:row.id});if(!r.ok){status('This invitation could not be canceled. It may already be claimed. Refresh the list.',true);return;}createId=null;$('share-link').hidden=true;$('invitation-link').value='';await invitations();status('Unclaimed invitation canceled. You can create a replacement.');}));article.append(cancel);
      }
      list.append(article);
    }
    if(!rows.length){const p=document.createElement('p');p.textContent='No invitations yet. Create a personal link for your first friend.';list.append(p);}
    $('create-invitation').hidden=rows.length>=2;
    show('member-view');
  }
  $('identity-form').addEventListener('submit',event=>{event.preventDefault();void run(async()=>{email=$('email').value.trim().toLowerCase();await sendCode();});});
  $('resend').addEventListener('click',()=>void run(sendCode));
  $('change-email').addEventListener('click',()=>{clear();show('identity-form');status('Enter your email to continue.');$('email').focus();});
  $('code-form').addEventListener('submit',event=>{event.preventDefault();void run(async()=>{
    status('Verifying your email…');const code=$('code').value.trim();
    try {
      if(mode==='claim'){const r=await edge('verify-introduction-code',{email,code});if(!r.accessToken||r.email!==email)throw Error();session=r.accessToken;}
      else {const r=await json(config.supabaseUrl+'/auth/v1/verify',{method:'POST',headers:headers(),body:JSON.stringify({email,token:code,type:'email'})});if(!r.access_token||r.user?.email?.toLowerCase()!==email)throw Error();session=r.access_token;}
      $('code').value='';$('sign-out').hidden=false;
      if(mode==='claim'){$('verified-email').textContent=email;show('claim-form');status('Email verified. Confirm your name and choices to claim.');$('first-name').focus();}
      else if(mode==='member'){await invitations();status('Manage your two Giving invitations here.');}
      else await guestStatus();
    } catch {session=null;show('code-form');status('Could not verify this code or open your account. Check the code, request a new one, or contact support.',true);}
  });});
  $('claim-form').addEventListener('submit',event=>{event.preventDefault();void run(async()=>{
    if(!session||!$('over-21').checked||!$('terms').checked)return;
    claimInput??={p_token:invite,p_first_name:$('first-name').value.trim(),p_last_name:$('last-name').value.trim(),p_over_21:true,p_terms_revision:preview.termsRevision,p_privacy_revision:preview.privacyRevision,p_marketing_revision:preview.marketingRevision,p_marketing_opt_in:$('marketing').checked};
    claimFields(true);status('Claiming your Introduction…');
    try {const r=await rpc('claim_introduction',claimInput);
      if(!r.ok){if(r.reason==='verify_email'){session=null;await sendCode();status('Verify this email again, then retry your claim.');return;}claimInput=null;claimFields(false);status(({guest_ineligible:'This email is not eligible for a new Introduction. If you have already claimed one, open your confirmation email. Otherwise, this offering is for people who have never been DPC members.',already_claimed:'This invitation has already been claimed.',guest_already_claimed:'An Introduction is already attached to this email.',feature_unavailable:'The Introduction is temporarily unavailable.'})[r.reason]??'This Introduction cannot be claimed right now. Contact your inviter or support.',true);return;}
      await guestStatus();status('Your Introduction is claimed. Visit with your inviter before December 31.');
    } catch {status('We could not confirm the claim. Keep this page open and retry; the same claim will not use another invitation.',true);}
  });});
  $('create-invitation').addEventListener('click',()=>void run(async()=>{
    createId??=crypto.randomUUID();status('Creating your invitation…');
    try {const r=await rpc('create_introduction_invitation',{p_request_id:createId});if(!r.ok){createId=null;status('An invitation could not be created. Check your membership access and existing invitations.',true);return;}
      if(r.token){const link=new URL('/introduction',location.origin);link.hash='invite='+r.token;$('invitation-link').value=link.href;$('share-link').hidden=false;status('Your link is ready to share. Save it before leaving this page.');}
      else status('This invitation was already created, but its private link cannot be recovered. If you did not save it, cancel the unclaimed invitation and create a replacement.',true);
      createId=null;await invitations();
    } catch {status('We could not confirm creation. Retry here with the same request. If it was created, no extra slot will be used.',true);}
  }));
  $('copy-link').addEventListener('click',()=>void run(async()=>{try{await navigator.clipboard.writeText($('invitation-link').value);status('Invitation link copied.');}catch{$('invitation-link').select();status('Select and copy the link above.');}}));
  $('refresh-invitations').addEventListener('click',()=>void run(async()=>{await invitations();status('Invitations refreshed.');}));
  $('sign-out').addEventListener('click',()=>{clear();show('identity-form');status('Signed out of this page. Verify your email to return.');});
  window.addEventListener('pagehide',()=>{clear();$('guest-details').textContent='';$('verified-email').textContent='';$('invitations').replaceChildren();show('identity-form');status('Verify your email to return.');});
  void run(async()=>{
    config=await json('/api/introduction');
    if(config.isStaging){const draft=document.createElement('p');draft.className='note';draft.textContent='Staging test — campaign copy and Introduction terms are drafts awaiting review.';$('intro-heading').after(draft);}
    if(mode==='claim'){
      if(!/^[a-f0-9]{64}$/.test(invite??'')){status('This invitation link is invalid. Ask your friend for their original link.',true);return;}
      preview=await rpc('get_introduction_preview',{p_token:invite},false);
      if(!preview){status('This invitation is unavailable. It may be claimed, canceled, expired or temporarily paused. Contact your inviter, or open your claimed Introduction from its confirmation email.',true);return;}
      if(preview.termsRevision!==TERMS||preview.marketingRevision!==MARKETING||!preview.privacyRevision){status('This invitation is not ready to claim yet. Please try again later.',true);return;}
      $('intro-heading').textContent=`${preview.inviterFirstName} ${preview.inviterLastName} invited you for a Pour.`;
      $('introduction-terms').hidden=false;$('terms-revision').textContent='Giving offering — November 2026.';
    }else $('intro-heading').textContent=mode==='member'?'Give a friend a Pour. Manage your invitations.':'Verify your email to view your claimed Introduction.';
    show('identity-form');status('Verify your email to continue.');
  });
})();
