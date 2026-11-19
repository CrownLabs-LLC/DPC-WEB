import assert from 'node:assert/strict';
import {createHandler} from '../api/introduction.js';
const base={VERCEL_ENV:'preview',DPC_INTRODUCTION_ENABLED:'true',SUPABASE_URL:'https://hohbsqkmrlhkstojfdgx.supabase.co',SUPABASE_ANON_KEY:'public-test',SUPABASE_SERVICE_ROLE_KEY:'private-test'};
function invoke(overrides={},method='GET') {const result={headers:{}};const res={setHeader:(k,v)=>result.headers[k]=v,status:n=>{result.status=n;return res;},json:body=>{result.body=body;return result;}};createHandler({env:{...base,...overrides}})({method},res);return result;}
const r=invoke();assert.equal(r.status,200);assert.equal(r.headers['Cache-Control'],'no-store');assert.equal(r.body.isStaging,true);assert(!JSON.stringify(r).includes('private-test'));
for(const change of [{DPC_INTRODUCTION_ENABLED:'false'},{SUPABASE_ANON_KEY:'sb_secret_example'},{SUPABASE_ANON_KEY:'private-test'},{SUPABASE_ANON_KEY:'x.'+Buffer.from(JSON.stringify({role:'service_role'})).toString('base64url')+'.x'},{SUPABASE_URL:'https://attacker.example'},{SUPABASE_URL:'https://hohbsqkmrlhkstojfdgx.supabase.co?x=1'},{SUPABASE_URL:'https://ebiuspbgzggrdiaswpcc.supabase.co'},{VERCEL_ENV:'production'}])assert.equal(invoke(change).status,503);
assert.equal(invoke({},'POST').status,405);
assert.equal(invoke({VERCEL_ENV:'production',SUPABASE_URL:'https://ebiuspbgzggrdiaswpcc.supabase.co'}).body.isStaging,false);
console.log('PASS: Introduction config denies secret keys, wrong environments and disabled launches');
