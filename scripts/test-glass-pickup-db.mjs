// Real transactions in a disposable network-isolated PostgreSQL; never hosted data.
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
const container = 'dpc-glass-test-' + randomUUID();
const image = 'public.ecr.aws/supabase/postgres:17.6.1.167';
const args = ['exec', '-i', container, 'psql', '-X', '-At', '-U', 'supabase_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'];
function docker(args, input) {
  const result = spawnSync('docker', args, { input, encoding: 'utf8', timeout: 60000 });
  assert.equal(result.status, 0, result.error?.message || result.stderr); return result.stdout.trim();
}
const sql = input => docker(args, input);
function fails(input, pattern) {
  const result = spawnSync('docker', args, { input, encoding: 'utf8', timeout: 15000 });
  assert.notEqual(result.status, 0); assert.match(result.stderr, pattern);
}
function concurrent(input) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args); let error = '';
    child.stderr.on('data', chunk => { error += chunk; }); child.stdout.resume();
    child.on('error', reject); child.on('close', code => code === 0 ? resolve() : reject(new Error(error)));
    child.stdin.end(input);
  });
}
const call = (id, email, opt = true, changed = false) => `select public.register_glass_pickup('${id}','${email}',${opt},${changed},'glass-2026-09-24-v1');`;
const asService = statement => 'set role service_role;' + statement;
try {
  docker(['run', '--detach', '--rm', '--network', 'none', '--name', container, '-e', 'POSTGRES_PASSWORD=local-glass-tests-only', image]);
  let ready = false;
  for (let i = 0; i < 60; i++) {
    if (spawnSync('docker', ['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'], { timeout: 1000 }).status === 0) { ready = true; break; }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(ready);
  sql(readFileSync(new URL('../db/20260924202337_glass_pickup.sql', import.meta.url), 'utf8'));
  const first = randomUUID();
  sql(asService(call(first, ' Guest+tag@Example.com ', false, true)));
  sql(asService(call(first, 'guest+tag@example.com', false, true)));
  assert.equal(sql('select count(*) from glass_campaign_pickups'), '1');
  assert.equal(sql('select count(*) from glass_campaign_preference_events'), '1');
  sql(asService(call(randomUUID(), 'guest+tag@example.com')));
  assert.equal(sql('select marketing_opt_in from glass_campaign_contacts'), 'f', 'Untouched default preserves earlier opt-out');
  sql(asService(call(randomUUID(), 'guest+tag@example.com', true, true)));
  sql(asService(call(first, 'guest+tag@example.com', false, true)));
  assert.equal(sql('select marketing_opt_in from glass_campaign_contacts'), 't', 'Old retry cannot undo newer choice');
  assert.equal(sql('select count(*) from glass_campaign_preference_events'), '2');
  fails(asService(call(first, 'different@example.com', false, true)), /Request intent mismatch/);
  assert.equal(sql('select count(*) from glass_campaign_contacts'), '1');
  fails(asService(call(randomUUID(), 'not email')), /check constraint/);
  fails(asService(call(randomUUID(), 'none@example.com', false, false)), /Invalid pickup/);
  for (const role of ['anon', 'authenticated']) {
    for (const table of ['contacts', 'pickups', 'submissions', 'preference_events']) {
      fails(`set role ${role}; select * from glass_campaign_${table};`, /permission denied/);
    }
    fails(`set role ${role};` + call(randomUUID(), 'unauthorized@example.com'), /permission denied/);
    // Even a future accidental read grant cannot bypass RLS.
    assert.match(sql(`begin; grant select on glass_campaign_contacts to ${role}; set local role ${role}; select count(*) from glass_campaign_contacts; rollback;`), /\n0\n/);
    fails(`begin; grant insert on glass_campaign_contacts to ${role}; set local role ${role}; insert into glass_campaign_contacts(email,marketing_opt_in) values('unauthorized@example.com',true);`, /row-level security/);
  }
  fails(asService('update glass_campaign_preference_events set marketing_opt_in=false;'), /permission denied/);
  fails(asService('delete from glass_campaign_pickups;'), /permission denied/);
  // A forced failure at the final write rolls back contact, pickup and request.
  sql("create function public.test_fail_preference() returns trigger language plpgsql as $$ begin raise exception 'forced failure'; end $$; create trigger test_fail before insert on glass_campaign_preference_events for each row execute function public.test_fail_preference();");
  fails(asService(call(randomUUID(), 'rollback@example.com')), /forced failure/);
  assert.equal(sql("select count(*) from glass_campaign_contacts where email='rollback@example.com'"), '0');
  sql('drop trigger test_fail on glass_campaign_preference_events; drop function test_fail_preference();');
  const racingId = randomUUID();
  await Promise.all([0, 1].map(() => concurrent('begin;' + asService(call(racingId, 'race@example.com')) + 'select pg_sleep(0.15); commit;')));
  assert.equal(sql("select count(*) from glass_campaign_submissions where id='" + racingId + "'"), '1');
  await Promise.all([0, 1, 2, 3].map(() => concurrent('begin;' + asService(call(randomUUID(), 'parallel@example.com')) + 'select pg_sleep(0.1); commit;')));
  assert.equal(sql("select count(*) from glass_campaign_pickups p join glass_campaign_contacts c on c.id=p.contact_id where c.email='parallel@example.com'"), '1');
  assert.equal(sql("select count(*) from glass_campaign_preference_events p join glass_campaign_contacts c on c.id=p.contact_id where c.email='parallel@example.com'"), '1');
  assert.equal(sql('select count(*) from glass_campaign_contacts'), '3');
  assert.equal(sql('select count(*) from glass_campaign_pickups'), '3');
  assert.equal(sql("select count(*) from information_schema.columns where table_name='glass_campaign_pickups' and column_name in ('venue','venue_id','location','restaurant')"), '0');
  assert.equal(sql('select count(*) from glass_campaign_contacts where updated_at < preference_occurred_at'), '0');
  console.log('PASS: real PostgreSQL pickup atomicity, retries, concurrent requests, email normalization, preference preservation, rollback, RLS and role grants.');
} finally { spawnSync('docker', ['rm', '--force', container], { encoding: 'utf8', timeout: 10000 }); }
