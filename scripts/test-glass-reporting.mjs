import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import handler from '../api/glass-reporting.js';
import { csvCell, isAdmin, reportingConfiguration, reportingPublicConfig } from '../api/lib/glass-reporting.js';
import { summary, emptySummary, participation, marketing } from '../tests/reporting-fixtures.mjs';
const saved = { ...process.env }, realFetch = global.fetch;
const key = 'server-secret-test-only';
const env = () => {
  for (const k of ['ADMIN_SUPABASE_URL','ADMIN_SUPABASE_ANON_KEY']) delete process.env[k];
  Object.assign(process.env, { VERCEL_ENV:'preview', SUPABASE_URL:'https://hohbsqkmrlhkstojfdgx.supabase.co', SUPABASE_SERVICE_ROLE_KEY:key, SUPABASE_ANON_KEY:'sb_publishable_fixture' });
};
let calls = [], authStatus = 200, user, rpcStatus = 200, report;
function reset(data = summary()) {
  env(); calls = []; authStatus = 200; user = { id:'admin-id', app_metadata:{role:'admin'} }; rpcStatus = 200; report = data;
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/auth/v1/user')) return { status:authStatus, ok:authStatus===200, json:async()=>user };
    assert(url.endsWith('/rest/v1/rpc/read_glass_campaign_report'));
    return { status:rpcStatus, ok:rpcStatus===200, json:async()=>report };
  };
}
async function invoke(kind='summary', authorization='Bearer signed-user-token', method='GET', query) {
  const out = { headers:{} };
  await handler({ method, query:query||{kind}, headers: authorization == null ? {} : {authorization} }, {
    setHeader:(k,v)=>out.headers[k]=v,
    status(code) { out.status=code;return this; }, json(body) { out.body=body;return this; }, send(body) { out.body=body;return this; },
  });
  assert.equal(out.headers['Cache-Control'],'private, no-store'); assert.equal(out.headers.Vary,'Authorization');
  assert(!JSON.stringify(out.body).includes(key)); return out;
}
const csvReport = (kind, rows) => ({ kind, asOf:'2026-09-30T21:45:00Z', total:rows.length, rows });
try {
  reset(); assert.equal((await invoke('summary',null)).status,401); assert.equal(calls.length,0);
  for (const token of ['', 'Basic hi', ['Bearer hi'], 'Bearer token with spaces']) assert.equal((await invoke('summary',token)).status,401);
  assert.equal((await invoke('summary',null,'POST')).status,405);
  assert.equal((await invoke('bad')).status,400);
  assert.equal((await invoke('summary',undefined,'GET',{kind:'summary',email:'person@example.com'})).status,400);
  assert.equal(calls.length,0);
  assert.equal((await invoke('config',null)).body.supabaseAnonKey,'sb_publishable_fixture');
  process.env.ADMIN_SUPABASE_URL='https://ebiuspbgzggrdiaswpcc.supabase.co';
  assert.equal((await invoke('config',null)).body.configured,false);
  reset(); process.env.ADMIN_SUPABASE_ANON_KEY='sb_secret_never-public'; assert.equal(reportingPublicConfig(reportingConfiguration()).configured,false);
  reset(); process.env.SUPABASE_URL='https://ebiuspbgzggrdiaswpcc.supabase.co'; assert.equal(reportingConfiguration(),null);
  process.env.VERCEL_ENV='production'; assert(reportingConfiguration());
  process.env.SUPABASE_URL='https://hohbsqkmrlhkstojfdgx.supabase.co'; assert.equal(reportingConfiguration(),null);
  reset(); delete process.env.SUPABASE_SERVICE_ROLE_KEY; assert.equal((await invoke()).status,503); assert.equal(calls.length,0);
  for (const status of [401,403]) { reset();authStatus=status;assert.equal((await invoke()).status,401);assert.equal(calls.length,1); }
  for (const value of [{id:'member',user_metadata:{role:'admin'}},{id:'member',app_metadata:{role:'member'}},{id:'member',app_metadata:{roles:'admin'}},{}]) {
    reset();user=value;assert.equal((await invoke()).status,403);assert.equal(calls.length,1);
  }
  assert(isAdmin({id:'admin',app_metadata:{roles:['support','admin']}}));
  reset(); const ok=await invoke(); assert.equal(ok.status,200);assert.deepEqual(ok.body,summary());
  assert.equal(calls[0].options.headers.Authorization,'Bearer signed-user-token');
  assert.equal(calls[1].options.headers.Authorization,'Bearer '+key);
  assert.deepEqual(JSON.parse(calls[1].options.body),{p_kind:'summary'});
  reset(); authStatus=500; assert.equal((await invoke()).status,503);
  reset();rpcStatus=404;assert.equal((await invoke()).status,503);
  reset();global.fetch=async()=>{throw Error('private-guest@example.com internal detail');};
  assert(!JSON.stringify(await invoke()).includes('private-guest'));
  for(const bad of [null,{}, {...summary(),pickups:null}, {...summary(),tastings:5}, {...summary(),byRestaurantDate:[]}, {...summary(),byRestaurantDate:Array(20).fill(summary().byRestaurantDate[0])}]) {
    reset(bad);assert.equal((await invoke()).status,503);
  }
  reset(emptySummary());assert.equal((await invoke()).body.pickups,0);
  const rows=Array.from({length:1205},(_,i)=>participation('guest-'+i+'@example.com'));
  reset(csvReport('participation',rows));let out=await invoke('participation');
  assert.equal(out.status,200);assert.equal(out.headers['X-Report-Rows'],'1205');
  assert.equal(out.body.split('\r\n').length,1207);assert(out.body.includes('guest-1204@example.com'));
  assert.equal(out.headers['Content-Type'],'text/csv; charset=utf-8');
  assert(out.headers['Content-Disposition'].includes('glass-participation-2026-09-30.csv'));
  reset(csvReport('marketing',[marketing()]));out=await invoke('marketing');assert.equal(out.status,200);assert(out.body.includes('explicit_change'));
  for(const bad of [csvReport('marketing',[{...marketing(),choice_basis:null}]),csvReport('marketing',[{...marketing(),marketing_opt_in:false}]),{...csvReport('participation',rows),total:1}]) {
    reset(bad);assert.equal((await invoke(bad.kind)).status,503);
  }
  reset(csvReport('participation',[]));assert.equal((await invoke('participation')).headers['X-Report-Rows'],'0');
  for(const value of ['=1+1','+test@example.com','-test@example.com','@test@example.com',' \t=1+1','\n=1+1']) assert(csvCell(value).startsWith('"\''));
  assert.equal(csvCell('guest,"tag"@example.com'),'"guest,""tag""@example.com"');
  assert.equal(csvCell(null),'""');assert.equal(csvCell('normal@example.com'),'"normal@example.com"');
  reset(csvReport('marketing',Array.from({length:18000},()=>marketing('a'.repeat(240)+'@example.com'))));
  out=await invoke('marketing');assert.equal(out.status,413);assert.equal(out.body.code,'export_too_large');assert(!out.headers['Content-Disposition']);
  const page=readFileSync(new URL('../admin/glass-comes-back.html',import.meta.url),'utf8');
  assert(!/analytics|googletag|facebook|pixel|posthog|SUPABASE_SERVICE_ROLE_KEY/.test(page));
  console.log('PASS: reporting admin authorization, expiry/non-admin denial, environment binding, safe public config, complete >1000-row exports, CSV quoting/formula safety, provenance, no-cache and fail-closed empty/error/oversize states.');
} finally { global.fetch=realFetch;for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved); }
