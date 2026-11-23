import assert from 'node:assert/strict';
import {createHandler} from '../api/introduction.js';
const base={VERCEL_ENV:'preview',DPC_INTRODUCTION_ENABLED:'true',SUPABASE_URL:'https://hohbsqkmrlhkstojfdgx.supabase.co',SUPABASE_ANON_KEY:'public-test',SUPABASE_SERVICE_ROLE_KEY:'private-test'};
function invoke(overrides={},method='GET') {const result={headers:{}};const res={setHeader:(k,v)=>result.headers[k]=v,status:n=>{result.status=n;return res;},json:body=>{result.body=body;return result;}};createHandler({env:{...base,...overrides}})({method},res);return result;}
const r=invoke();assert.equal(r.status,200);assert.equal(r.headers['Cache-Control'],'no-store');assert.equal(r.body.isStaging,true);assert(!JSON.stringify(r).includes('private-test'));
for(const change of [{DPC_INTRODUCTION_ENABLED:'false'},{SUPABASE_ANON_KEY:'sb_secret_example'},{SUPABASE_ANON_KEY:'private-test'},{SUPABASE_ANON_KEY:'x.'+Buffer.from(JSON.stringify({role:'service_role'})).toString('base64url')+'.x'},{SUPABASE_URL:'https://attacker.example'},{SUPABASE_URL:'https://hohbsqkmrlhkstojfdgx.supabase.co?x=1'},{SUPABASE_URL:'https://ebiuspbgzggrdiaswpcc.supabase.co'},{VERCEL_ENV:'production'}])assert.equal(invoke(change).status,503);
assert.equal(invoke({},'POST').status,405);
assert.equal(invoke({VERCEL_ENV:'production',SUPABASE_URL:'https://ebiuspbgzggrdiaswpcc.supabase.co'}).body.isStaging,false);
console.log('PASS: Introduction config denies secret keys, wrong environments and disabled launches');

const reviewedPreview={DPC_INTRODUCTION_ENABLED:undefined,VERCEL_ENV:'preview',VERCEL_PROJECT_ID:'prj_ja3XojU2IhCk0bvhrwRSRQmK6WYO',VERCEL_GIT_COMMIT_REF:'codex/introduction-browser',SUPABASE_URL:'https://ebiuspbgzggrdiaswpcc.supabase.co',SUPABASE_ANON_KEY:undefined};
const preview=invoke(reviewedPreview);
assert.equal(preview.status,200);assert.equal(preview.body.supabaseUrl,'https://hohbsqkmrlhkstojfdgx.supabase.co');assert.equal(preview.body.isStaging,true);const anonPayload=JSON.parse(Buffer.from(preview.body.anonKey.split('.')[1],'base64url'));assert.equal(anonPayload.role,'anon');assert.equal(anonPayload.ref,'hohbsqkmrlhkstojfdgx');
for(const change of [{VERCEL_ENV:'production'},{VERCEL_ENV:'development'},{VERCEL_ENV:undefined},{VERCEL_PROJECT_ID:'another-project'},{VERCEL_PROJECT_ID:undefined},{VERCEL_GIT_COMMIT_REF:'main'},{VERCEL_GIT_COMMIT_REF:undefined},{DPC_INTRODUCTION_ENABLED:'false'},{DPC_INTRODUCTION_ENABLED:'true'}])assert.equal(invoke({...reviewedPreview,...change}).status,503);
console.log('PASS: reviewed preview is project/branch/environment scoped and honors explicit disable');
