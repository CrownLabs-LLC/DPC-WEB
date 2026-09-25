import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
const container='dpc-glass-reporting-'+randomUUID();
const image='public.ecr.aws/supabase/postgres:17.6.1.167';
const args=['exec','-i',container,'psql','-X','-At','-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1'];
function docker(argv,input){const r=spawnSync('docker',argv,{input,encoding:'utf8',timeout:60000});assert.equal(r.status,0,r.error?.message||r.stderr);return r.stdout.trim();}
const sql=q=>docker(args,q);
const report=kind=>JSON.parse(sql(`set role service_role; select public.read_glass_campaign_report('${kind}');`).split('\n').at(-1));
const pickup=(email,opt=true,changed=false)=>`select public.register_glass_pickup('${randomUUID()}','${email}',${opt},${changed},'glass-2026-09-24-v1','${'a'.repeat(64)}');`;
const taste=(email,restaurant)=>`select public.register_glass_tasting('${randomUUID()}','${email}',true,false,'glass-2026-09-24-v1','${restaurant}','${'b'.repeat(64)}');`;
const totals=()=>sql('select (select count(*) from glass_campaign_contacts),(select count(*) from glass_campaign_pickups),(select count(*) from glass_campaign_tastings),(select count(*) from glass_campaign_submissions),(select count(*) from glass_campaign_preference_events)');
try {
  docker(['run','--detach','--rm','--network','none','--name',container,'-e','POSTGRES_PASSWORD=local-reporting-tests-only',image]);
  let ready=false;for(let i=0;i<60;i++){if(spawnSync('docker',['exec',container,'pg_isready','-h','127.0.0.1','-U','postgres'],{timeout:1000}).status===0){ready=true;break;}await new Promise(r=>setTimeout(r,250));}assert(ready);
  for(const file of ['20260924202337_glass_pickup.sql','20260925152006_glass_tasting.sql','20260925180724_glass_campaign_reporting.sql'])sql(readFileSync(new URL('../db/'+file,import.meta.url),'utf8'));
  let data=report('summary');assert.equal(data.emails,0);assert.equal(data.byRestaurantDate.length,20);assert.equal(report('participation').total,0);assert.equal(report('marketing').total,0);
  sql("create or replace function public.glass_tasting_now() returns timestamptz language sql set search_path=pg_catalog as $$select '2026-09-29T19:00:00Z'::timestamptz$$;");
  sql('set role service_role;'+pickup('opted-out@example.com',false,true)+pickup('opted-out@example.com')+pickup('opted-in@example.com')+taste('opted-out@example.com','demitris-taverna')+taste('opted-out@example.com','demitris-taverna')+taste('opted-out@example.com','l-campo')+taste('taste-only@example.com','swirl-on-the-square'));
  sql("create or replace function public.glass_tasting_now() returns timestamptz language sql set search_path=pg_catalog as $$select '2026-09-30T19:00:00Z'::timestamptz$$;");
  sql('set role service_role;'+taste('opted-out@example.com','demitris-taverna'));
  const before=totals();data=report('summary');
  assert.deepEqual([data.pickups,data.tastings,data.emails,data.marketingContacts,data.repeatTasters],[2,4,3,2,1]);
  assert.equal(data.byRestaurantDate.reduce((n,r)=>n+r.tastings,0),4);
  data=report('participation');assert.equal(data.total,6);assert.equal(new Set(data.rows.map(r=>r.record_id)).size,6);
  assert(data.rows.filter(r=>r.record_type==='pickup').every(r=>r.restaurant===null));
  assert(data.rows.some(r=>r.event_date==='2026-09-30'&&r.restaurant==='demitris-taverna'));
  data=report('marketing');assert.equal(data.total,2);assert(!data.rows.some(r=>r.email==='opted-out@example.com'));
  assert(data.rows.every(r=>r.choice_basis==='initial_default'&&r.wording_version==='glass-2026-09-24-v1'));
  assert.equal(totals(),before,'Reports are read-only');
  sql('begin read only;set local role service_role;select public.read_glass_campaign_report(\'summary\');select public.read_glass_campaign_report(\'participation\');select public.read_glass_campaign_report(\'marketing\');rollback;');
  sql('set role service_role;'+pickup('opted-out@example.com',true,true));data=report('marketing');
  assert.equal(data.total,3);assert.equal(data.rows.find(r=>r.email==='opted-out@example.com').choice_basis,'explicit_change');
  sql("with c as (insert into glass_campaign_contacts(email,marketing_opt_in) select 'bulk-'||n||'@example.com',false from generate_series(1,1205) n returning id) insert into glass_campaign_pickups(contact_id,occurred_at) select id,'2026-09-30T06:30:00Z'::timestamptz from c;");
  data=report('participation');assert.equal(data.total,1211);assert.equal(data.rows.length,1211);
  assert.equal(data.rows.filter(r=>r.email.startsWith('bulk-')&&r.event_date==='2026-09-29').length,1205,'Pickup date uses Pacific time');
  assert.equal(report('marketing').total,3,'Bulk opt-outs never enter marketing export');
  for(const role of ['anon','authenticated']){
    const denied=spawnSync('docker',args,{input:`set role ${role};select public.read_glass_campaign_report('marketing');`,encoding:'utf8',timeout:15000});
    assert.notEqual(denied.status,0);assert.match(denied.stderr,/permission denied/);
  }
  const invalid=spawnSync('docker',args,{input:"set role service_role;select public.read_glass_campaign_report('other');",encoding:'utf8',timeout:15000});assert.notEqual(invalid.status,0);
  const properties=sql("select p.provolatile,p.prosecdef,has_function_privilege('anon',p.oid,'execute'),has_function_privilege('authenticated',p.oid,'execute') from pg_proc p where p.oid='public.read_glass_campaign_report(text)'::regprocedure;");
  assert.equal(properties,'s|f|f|f');
  console.log('PASS: real PostgreSQL read-only report snapshots, deduplicated pickups/tastings/emails, repeated tasters, complete 1211-row export, Pacific pickup dates, current-choice provenance, opt-out exclusion, role denial and no table mutations.');
} finally {spawnSync('docker',['rm','--force',container],{encoding:'utf8',timeout:10000});}
