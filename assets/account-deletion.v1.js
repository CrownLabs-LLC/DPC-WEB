'use strict';
(() => {
  const $=id=>document.getElementById(id);
  let config,token=null,email='',requestId=null,busy=false,submittedChoice=null,uncertain=false,verifiedUserId=null,reauthenticating=false;
  const status=(message,error=false)=>{$('status').textContent=message;$('status').dataset.error=String(error);};
  const show=id=>{for(const name of ['identity-form','code-form','request-form','received'])$(name).hidden=name!==id;};
  const clear=()=>{token=null;email='';requestId=null;submittedChoice=null;verifiedUserId=null;reauthenticating=false;$('change-email').hidden=false;$('request-form').querySelector('fieldset').disabled=false;$('email').value='';$('code').value='';$('request-form').reset();};
  const json=async(url,init={})=>{const r=await fetch(url,{...init,cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(10000)});const data=await r.json();if(!r.ok)throw Error('request_failed');return data;};
  const authHeaders=()=>({'Content-Type':'application/json',apikey:config.anonKey,Authorization:`Bearer ${config.anonKey}`});
  const run=async(fn)=>{if(busy)return;busy=true;document.querySelectorAll('button').forEach(b=>b.disabled=true);try{await fn();}finally{busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=false);}};
  $('identity-form').addEventListener('submit',event=>{event.preventDefault();void run(async()=>{
    email=$('email').value.trim().toLowerCase();status('Sending a verification code…');
    try{const data=await json(config.supabaseUrl+'/auth/v1/otp',{method:'POST',headers:authHeaders(),body:JSON.stringify({email,create_user:false})});show('code-form');status('If this email can sign in to DPC, a code is on its way. Enter it below.');$('code').focus();}
    catch{status('Could not send a code. Try again shortly. If you cannot access your account, use the privacy contact below.',true);}
  });});
  $('code-form').addEventListener('submit',event=>{event.preventDefault();void run(async()=>{
    status('Verifying your email…');
    try{const data=await json(config.supabaseUrl+'/auth/v1/verify',{method:'POST',headers:authHeaders(),body:JSON.stringify({email,token:$('code').value.trim(),type:'email'})});if(!data.access_token||!data.user?.email||!data.user.id)throw Error();if(reauthenticating&&data.user.id!==verifiedUserId)throw Error();token=data.access_token;email=data.user.email;verifiedUserId=data.user.id;requestId??=crypto.randomUUID();reauthenticating=false;$('code').value='';$('verified-email').textContent=email;show('request-form');status('Email verified. Review your choice and submit the request.');$('request-form').querySelector('input').focus();}
    catch{status('The code could not be verified. Check the six digits or request a new code.',true);}
  });});
  $('request-form').addEventListener('submit',event=>{event.preventDefault();void run(async()=>{
    const timing=submittedChoice??new FormData($('request-form')).get('timing');if(!token||!timing||!$('confirm').checked)return;
    submittedChoice=timing;uncertain=true;$('request-form').querySelector('fieldset').disabled=true;status('Submitting your deletion request…');
    try{const result=await json('/api/account-deletion',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({requestId,timing,confirmed:true})});if(result.status!=='received'||result.requestId!==requestId)throw Error();$('receipt').textContent=`Reference: ${result.requestId}. Requested timing: ${timing==='now'?'delete now':'at the end of paid access'}.`;uncertain=false;clear();show('received');status('Your request is saved. Your account has not yet been deleted.');$('received').focus();}
    catch{status('We could not confirm receipt. Keep this page open and retry with the same choice; it will not create a second copy of this request. If your session expired, choose Verify this email again; your request reference and timing will be preserved.',true);}
  });});
  $('change-email').addEventListener('click',()=>{clear();show('identity-form');status('Enter your account email.');$('email').focus();});
  $('reverify').addEventListener('click',()=>{void run(async()=>{
    token=null;reauthenticating=true;$('change-email').hidden=true;status('Sending a fresh code to the same verified email…');
    try{await json(config.supabaseUrl+'/auth/v1/otp',{method:'POST',headers:authHeaders(),body:JSON.stringify({email,create_user:false})});show('code-form');$('code').focus();status('Enter the fresh code. Your request reference and timing are preserved.');}
    catch{status('Could not send a fresh code. Try Verify this email again shortly; your request reference is preserved.',true);}
  });});
  $('leave').addEventListener('click',()=>{
    if(uncertain){status(`A submission may have been received. Keep reference ${requestId} and contact the privacy team to confirm. You can verify this email again to retry the same request.`,true);return;}
    clear();show('identity-form');status('No deletion request was submitted.');
  });
  window.addEventListener('pagehide',clear);
  void json('/api/account-deletion').then(data=>{config=data;show('identity-form');status('Verify your email to continue.');}).catch(()=>status('The request form is temporarily unavailable. Please try again later or contact the privacy team below.',true));
})();
