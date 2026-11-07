import { looksLikeSecretKey } from './admin-config.js';
// Verified request intake only. Billing cancellation and deletion are manual.
// Never trusts a client-supplied member ID or email; never deletes business data.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SUBJECT = 'Account deletion request';
export function createHandler({env=process.env,fetchImpl=fetch}={}) {
  return async function handler(req,res) {
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    const send=(status,data)=>res.status(status).json(data);
    if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');return send(405,{error:'method_not_allowed'});}
    const url=env.SUPABASE_URL?.replace(/\/$/,'');
    const anon=env.SUPABASE_ANON_KEY;
    const service=env.SUPABASE_SERVICE_ROLE_KEY;
    if(env.DPC_ACCOUNT_DELETION_ENABLED!=='true'||!url||!anon||!service)return send(503,{error:'unavailable'});
    try{const u=new URL(url);if(u.protocol!=='https:'||!u.hostname.endsWith('.supabase.co')||u.pathname!=='/'||u.username||u.password)throw Error();}catch{return send(503,{error:'unavailable'});}
    if(looksLikeSecretKey(anon)||anon===service)return send(503,{error:'unavailable'});
    if(env.VERCEL_ENV==='preview'&&url!=='https://hohbsqkmrlhkstojfdgx.supabase.co')return send(503,{error:'unavailable'});
    if(env.VERCEL_ENV==='production'&&url!=='https://ebiuspbgzggrdiaswpcc.supabase.co')return send(503,{error:'unavailable'});
    if(req.method==='GET')return send(200,{supabaseUrl:url,anonKey:anon});
    const auth=req.headers?.authorization;
    if(typeof auth!=='string'||!/^Bearer [A-Za-z0-9_.-]+$/.test(auth)||auth.length>8192)return send(401,{error:'verify_identity'});
    let input=req.body;
    try{if(typeof input==='string')input=JSON.parse(input);}catch{return send(400,{error:'invalid_request'});}
    if(!input||Array.isArray(input)||Object.keys(input).sort().join(',')!=='confirmed,requestId,timing'||input.confirmed!==true||!UUID.test(input.requestId)||!['now','paid_period_end'].includes(input.timing))return send(400,{error:'invalid_request'});
    const call=async(path,init={},key=service)=>{
      const r=await fetchImpl(url+path,{...init,headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json',...init.headers},signal:AbortSignal.timeout(5000)});
      let data=null;try{data=await r.json();}catch{}
      return {ok:r.ok,status:r.status,data};
    };
    try {
      const user=await call('/auth/v1/user',{headers:{Authorization:auth}},anon);
      if(!user.ok||!UUID.test(user.data?.id)||!user.data?.email_confirmed_at||typeof user.data?.email!=='string')return send(401,{error:'verify_identity'});
      const id=user.data.id;
      const member=await call('/rest/v1/members?select=id&auth_user_id=eq.'+encodeURIComponent(id)+'&limit=2');
      if(!member.ok||!Array.isArray(member.data)||member.data.length>1)return send(503,{error:'try_again'});
      const memberId=member.data[0]?.id??null;
      // Canonical description is the durable, authenticated consent record. No
      // password, OTP, JWT or refresh token is stored in the support queue.
      const description=JSON.stringify({type:'account_deletion',version:1,auth_user_id:id,verified_email:user.data.email,timing:input.timing,stop_future_renewals:true,confirmed:true});
      const row={id:input.requestId,member_id:memberId,category:'app_account',subject:SUBJECT,description,severity:'high',owner:'brandi'};
      const read=()=>call('/rest/v1/support_tickets?select=id,member_id,category,subject,description&id=eq.'+encodeURIComponent(input.requestId));
      const same=r=>r?.member_id===memberId&&r.category==='app_account'&&r.subject===SUBJECT&&r.description===description;
      const previous=await read();
      if(!previous.ok||!Array.isArray(previous.data))return send(503,{error:'try_again'});
      if(previous.data.length){if(!same(previous.data[0]))return send(409,{error:'request_conflict'});return send(200,{requestId:input.requestId,timing:input.timing,status:'received'});}
      const insert=await call('/rest/v1/support_tickets',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify(row)});
      if(!insert.ok){
        // Read after conflict or lost acknowledgment; never overwrite an existing request.
        const recovered=await read();
        if(!recovered.ok||!Array.isArray(recovered.data)||recovered.data.length!==1||!same(recovered.data[0]))return send(insert.status===409?409:503,{error:'try_again'});
      }else if(!Array.isArray(insert.data)||insert.data.length!==1||insert.data[0].id!==input.requestId)return send(503,{error:'try_again'});
      return send(200,{requestId:input.requestId,timing:input.timing,status:'received'});
    }catch{return send(503,{error:'try_again'});}
  };
}
export default createHandler();
