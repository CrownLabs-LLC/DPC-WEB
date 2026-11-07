import assert from 'node:assert/strict';
import {createHandler} from '../api/account-deletion.js';
const user='11111111-1111-4111-8111-111111111111',member='22222222-2222-4222-8222-222222222222',request='33333333-3333-4333-8333-333333333333';
const env={SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_ANON_KEY:'public-test',SUPABASE_SERVICE_ROLE_KEY:'private-test',DPC_ACCOUNT_DELETION_ENABLED:'true'};
function fixture({verified=true,orphan=false,existing=null,failInsert=false,conflict=false}={}){
 const calls=[],rows=existing?[existing]:[];
 const fetchImpl=async(url,init)=>{
  calls.push({url,init});let status=200,data;
  if(url.endsWith('/auth/v1/user')){assert.equal(init.headers.Authorization,'Bearer test.jwt');data=verified?{id:user,email:'member@example.test',email_confirmed_at:'2026-11-06T00:00:00Z'}:{id:user,email:'member@example.test'};}
  else {assert.equal(init.headers.Authorization,'Bearer private-test');
   if(url.includes('/members?'))data=orphan?[]:[{id:member}];
   else if(init.method==='POST'){const row=JSON.parse(init.body);rows.push(row);data=[row];if(failInsert)status=503;if(conflict)status=409;}
   else data=rows;
  }
  return {ok:status<300,status,json:async()=>data};
 };
 return {calls,rows,handler:createHandler({env,fetchImpl})};
}
async function invoke(handler,body={requestId:request,timing:'now',confirmed:true},headers={authorization:'Bearer test.jwt'},method='POST'){
 const result={headers:{}};const res={setHeader:(k,v)=>result.headers[k]=v,status:n=>{result.status=n;return res;},json:x=>{result.body=x;return result;}};
 await handler({method,headers,body},res);return result;
}
let checks=0;
for(const timing of ['now','paid_period_end']){
 const f=fixture();const body={requestId:request,timing,confirmed:true};let r=await invoke(f.handler,body);assert.equal(r.status,200);assert.equal(f.rows.length,1);const row=f.rows[0];assert.equal(row.member_id,member);assert.equal(row.severity,'high');assert.equal(row.owner,'brandi');assert.equal(JSON.parse(row.description).stop_future_renewals,true);assert.equal(JSON.parse(row.description).timing,timing);assert(!row.description.includes('test.jwt'));
 r=await invoke(f.handler,body);assert.equal(r.status,200);assert.equal(f.rows.length,1);assert.equal(r.headers['Cache-Control'],'no-store');checks++;
}
for(const body of [{requestId:request,timing:'now',confirmed:false},{requestId:request,timing:'later',confirmed:true},{requestId:request,timing:'now',confirmed:true,memberId:member},{requestId:'bad',timing:'now',confirmed:true}]){const f=fixture();assert.equal((await invoke(f.handler,body)).status,400);assert.equal(f.calls.length,0);checks++;}
{const f=fixture();assert.equal((await invoke(f.handler,undefined,{})).status,401);assert.equal(f.calls.length,0);checks++;}
{const f=fixture({verified:false});assert.equal((await invoke(f.handler)).status,401);assert.equal(f.rows.length,0);checks++;}
{const f=fixture({orphan:true});assert.equal((await invoke(f.handler)).status,200);assert.equal(f.rows[0].member_id,null);assert.equal(JSON.parse(f.rows[0].description).auth_user_id,user);checks++;}
{const f=fixture({existing:{id:request,member_id:'someone-else',subject:'other',description:'private'}});const r=await invoke(f.handler);assert.equal(r.status,409);assert(!JSON.stringify(r.body).includes('private'));assert(!f.calls.some(c=>c.init.method==='POST'));checks++;}
{const f=fixture({failInsert:true});assert.equal((await invoke(f.handler)).status,200);assert.equal(f.rows.length,1);checks++;}
{const f=fixture({conflict:true});assert.equal((await invoke(f.handler)).status,200);checks++;}
{const f=fixture();const r=await invoke(f.handler,undefined,{},'GET');assert.equal(r.status,200);assert.equal(r.body.anonKey,'public-test');assert(!JSON.stringify(r.body).includes('private-test'));checks++;}
{let fetched=false;const h=createHandler({env:{...env,DPC_ACCOUNT_DELETION_ENABLED:'false'},fetchImpl:async()=>{fetched=true;}});assert.equal((await invoke(h)).status,503);assert.equal(fetched,false);checks++;}
for(const overrides of [
 {SUPABASE_ANON_KEY:'sb_secret_example'},
 {SUPABASE_ANON_KEY:'header.'+Buffer.from(JSON.stringify({role:'service_role'})).toString('base64url')+'.signature'},
 {SUPABASE_ANON_KEY:'private-test'},
 {VERCEL_ENV:'preview',SUPABASE_URL:'https://ebiuspbgzggrdiaswpcc.supabase.co'},
 {VERCEL_ENV:'production',SUPABASE_URL:'https://hohbsqkmrlhkstojfdgx.supabase.co'},
]) { let fetched=false;const h=createHandler({env:{...env,...overrides},fetchImpl:async()=>{fetched=true;}});const r=await invoke(h,undefined,{},'GET');assert.equal(r.status,503);assert.equal(fetched,false);assert.deepEqual(r.body,{error:'unavailable'});checks++; }
console.log(`PASS: ${checks} deletion intake cases; synthetic transport only`);
