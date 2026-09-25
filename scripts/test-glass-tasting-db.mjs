// Real transactions in a disposable network-isolated PostgreSQL; never hosted data.
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
const container = 'dpc-tasting-test-' + randomUUID();
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
const quote = value => "'" + String(value).replaceAll("'", "''") + "'";
const network = () => randomUUID().replaceAll('-', '').repeat(2);
const call = (id, email, restaurant = 'demitris-taverna', opt = true, changed = false, key = network()) =>
  `select public.register_glass_tasting(${quote(id)},${quote(email)},${opt},${changed},'glass-2026-09-24-v1',${quote(restaurant)},${quote(key)});`;
const pickup = (id, email, opt = true, changed = false) =>
  `select public.register_glass_pickup(${quote(id)},${quote(email)},${opt},${changed},'glass-2026-09-24-v1',${quote(network())});`;
const asService = statement => 'set role service_role;' + statement;
const clock = instant => sql(`update public.test_tasting_clock set instant=${quote(instant)};`);
const result = statement => JSON.parse(sql(asService(statement)).split('\n').at(-1));
const count = table => sql('select count(*) from public.glass_campaign_' + table);
const restoreClock = () => sql("create or replace function public.glass_tasting_now() returns timestamptz language sql volatile security invoker set search_path=pg_catalog as $$ select instant from public.test_tasting_clock; $$;");
try {
  docker(['run', '--detach', '--rm', '--network', 'none', '--name', container, '-e', 'POSTGRES_PASSWORD=local-tasting-tests-only', image]);
  let ready = false;
  for (let i = 0; i < 60; i++) {
    if (spawnSync('docker', ['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'], { timeout: 1000 }).status === 0) { ready = true; break; }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(ready);
  sql(readFileSync(new URL('../db/20260924202337_glass_pickup.sql', import.meta.url), 'utf8'));
  // A pre-migration pickup remains readable and replayable after the extension.
  const preMigration = randomUUID();
  sql(asService(pickup(preMigration, 'existing@example.com', false, true)));
  sql(readFileSync(new URL('../db/20260925152006_glass_tasting.sql', import.meta.url), 'utf8'));
  sql(asService(pickup(preMigration, 'existing@example.com', false, true)));
  assert.equal(count('pickups'), '1');
  assert.equal(sql('select kind from glass_campaign_submissions'), 'pickup');
  // Date fixtures are installed only in this disposable, network-isolated DB.
  // The shipped clock has no argument and uses clock_timestamp().
  sql("create table public.test_tasting_clock(instant timestamptz); insert into public.test_tasting_clock values('2026-09-29T19:00:00Z'); grant select on public.test_tasting_clock to service_role;");
  restoreClock();
  const first = randomUUID();
  const initial = result(call(first, ' Guest+tag@Example.com ', 'demitris-taverna', false, true));
  const repeated = result(call(first, 'guest+tag@example.com', 'demitris-taverna', false, true));
  assert.deepEqual(initial, repeated);
  assert.deepEqual(Object.keys(initial).sort(), ['date', 'serverNow', 'status', 'validUntil']);
  assert.equal(initial.date, '2026-09-29');
  assert.equal(Date.parse(initial.validUntil), Date.parse('2026-09-30T07:00:00Z'));
  assert.equal(count('tastings'), '1');
  assert.equal(count('preference_events'), '2');
  assert.equal(result(call(randomUUID(), 'guest+tag@example.com')).status, 'confirmed');
  assert.equal(sql("select marketing_opt_in from glass_campaign_contacts where email='guest+tag@example.com'"), 'f');
  assert.equal(count('tastings'), '1');
  assert.equal(count('preference_events'), '2');
  // Pickup and tasting share preferences, but never count one another.
  assert.equal(result(call(randomUUID(), 'existing@example.com')).status, 'confirmed');
  assert.equal(sql("select marketing_opt_in from glass_campaign_contacts where email='existing@example.com'"), 'f');
  sql(asService(pickup(randomUUID(), 'guest+tag@example.com', true, true)));
  assert.equal(result(call(first, 'guest+tag@example.com', 'demitris-taverna', false, true)).status, 'confirmed');
  assert.equal(sql("select marketing_opt_in from glass_campaign_contacts where email='guest+tag@example.com'"), 't', 'Old tasting retry cannot undo a later pickup preference');
  assert.equal(count('pickups'), '2');
  assert.equal(count('tastings'), '2');
  fails(asService(call(preMigration, 'existing@example.com', 'demitris-taverna', false, true)), /Request intent mismatch/);
  fails(asService(pickup(first, 'guest+tag@example.com', false, true)), /Request intent mismatch/);
  fails(asService(call(first, 'other@example.com', 'demitris-taverna', false, true)), /Request intent mismatch/);
  fails(asService(call(first, 'guest+tag@example.com', 'l-campo', false, true)), /Request intent mismatch/);
  fails(asService(call(first, 'guest+tag@example.com', 'demitris-taverna', true, true)), /Request intent mismatch/);
  fails(asService(call(randomUUID(), 'none@example.com', 'l-campo', false, false)), /Invalid tasting/);
  fails(asService(call(randomUUID(), 'none@example.com', 'fake')), /Invalid tasting/);
  fails(asService(call(randomUUID(), 'not email')), /check constraint/);
  fails(asService(call(randomUUID(), 'none@example.com', 'l-campo', true, false, '192.0.2.1')), /Invalid tasting/);
  assert.equal(result(call(randomUUID(), "o'connor@example.com")).status, 'confirmed');

  for (const role of ['anon', 'authenticated']) {
    for (const table of ['contacts', 'pickups', 'tastings', 'submissions', 'preference_events', 'rate_limits']) {
      fails(`set role ${role}; select * from glass_campaign_${table};`, /permission denied/);
      assert.match(sql(`begin; grant select on glass_campaign_${table} to ${role}; set local role ${role}; select count(*) from glass_campaign_${table}; rollback;`), /\n0\n/);
    }
    fails(`set role ${role};` + call(randomUUID(), 'unauthorized@example.com'), /permission denied/);
    fails(`set role ${role}; select public.glass_tasting_now();`, /permission denied/);
    fails(`begin; grant insert on glass_campaign_tastings to ${role}; set local role ${role}; insert into glass_campaign_tastings(contact_id,restaurant,event_date) values(gen_random_uuid(),'l-campo','2026-09-29');`, /row-level security/);
  }
  fails(asService('update glass_campaign_tastings set restaurant=\'l-campo\';'), /permission denied/);
  fails(asService('delete from glass_campaign_tastings;'), /permission denied/);
  assert.equal(sql("select count(*) from pg_proc where proname in ('register_glass_tasting','glass_tasting_now','glass_tasting_dates') and prosecdef"), '0');
  assert.equal(sql("select count(*) from pg_class where relname like 'glass_campaign_%' and relkind='r' and not relrowsecurity"), '0');

  const racingId = randomUUID();
  await Promise.all([0, 1].map(() => concurrent('begin;' + asService(call(racingId, 'race@example.com')) + 'select pg_sleep(0.1); commit;')));
  assert.equal(sql(`select count(*) from glass_campaign_submissions where id=${quote(racingId)}`), '1');
  await Promise.all([0, 1, 2, 3].map(() => concurrent('begin;' + asService(call(randomUUID(), 'parallel@example.com')) + 'select pg_sleep(0.1); commit;')));
  assert.equal(sql("select count(*) from glass_campaign_tastings t join glass_campaign_contacts c on c.id=t.contact_id where c.email='parallel@example.com'"), '1');
  assert.equal(sql("select count(*) from glass_campaign_preference_events e join glass_campaign_contacts c on c.id=e.contact_id where c.email='parallel@example.com'"), '1');
  await Promise.all([
    concurrent(asService(call(randomUUID(), 'same-visit@example.com', 'l-campo'))),
    concurrent(asService(pickup(randomUUID(), 'same-visit@example.com', false, true))),
  ]);
  assert.equal(sql("select marketing_opt_in from glass_campaign_contacts where email='same-visit@example.com'"), 'f');
  assert.equal(sql("select count(*) from glass_campaign_tastings t join glass_campaign_contacts c on c.id=t.contact_id where c.email='same-visit@example.com'"), '1');
  assert.equal(sql("select count(*) from glass_campaign_pickups p join glass_campaign_contacts c on c.id=p.contact_id where c.email='same-visit@example.com'"), '1');

  sql("create function public.test_fail_tasting_preference() returns trigger language plpgsql as $$ begin raise exception 'forced failure'; end $$; create trigger test_fail before insert on glass_campaign_preference_events for each row execute function public.test_fail_tasting_preference();");
  const rollbackId = randomUUID(), rollbackKey = network();
  fails(asService(call(rollbackId, 'rollback@example.com', 'l-campo', false, true, rollbackKey)), /forced failure/);
  assert.equal(sql("select count(*) from glass_campaign_contacts where email='rollback@example.com'"), '0');
  assert.equal(sql(`select count(*) from glass_campaign_submissions where id=${quote(rollbackId)}`), '0');
  assert.equal(sql(`select count(*) from glass_campaign_rate_limits where rate_key=${quote(rollbackKey)}`), '0');
  sql('drop trigger test_fail on glass_campaign_preference_events; drop function public.test_fail_tasting_preference();');

  const key = network();
  for (let i = 0; i < 28; i++) assert.equal(result(call(randomUUID(), `limited-${i}@example.com`, 'l-campo', false, true, key)).status, 'confirmed');
  await Promise.all([28, 29, 30, 31].map(i => concurrent(asService(call(randomUUID(), `limited-${i}@example.com`, 'l-campo', false, true, key)))));
  assert.equal(sql("select count(*) from glass_campaign_contacts where email like 'limited-%'"), '30');
  const limitedId = randomUUID();
  const before = [count('contacts'), count('tastings'), count('submissions'), count('preference_events')];
  assert.equal(result(call(limitedId, 'limited-0@example.com', 'l-campo', true, true, key)).status, 'limited');
  assert.deepEqual([count('contacts'), count('tastings'), count('submissions'), count('preference_events')], before);
  assert.equal(sql("select marketing_opt_in from glass_campaign_contacts where email='limited-0@example.com'"), 'f');
  sql(`update glass_campaign_rate_limits set window_started_at=clock_timestamp()-interval '61 seconds' where rate_key=${quote(key)};`);
  assert.equal(result(call(limitedId, 'limited-0@example.com', 'l-campo', true, true, key)).status, 'confirmed');
  assert.equal(sql(`select submissions from glass_campaign_rate_limits where rate_key=${quote(key)}`), '1');

  const dates = ['2026-09-29','2026-09-30','2026-10-06','2026-10-13','2026-10-14'];
  const restaurants = ['demitris-taverna','swirl-on-the-square','calamari-bistro-bar','l-campo'];
  for (const date of dates) {
    clock(date + 'T19:00:00Z');
    for (const restaurant of restaurants) {
      assert.equal(result(call(randomUUID(), 'tour@example.com', restaurant)).date, date);
      assert.equal(result(call(randomUUID(), 'tour@example.com', restaurant)).status, 'confirmed');
    }
  }
  assert.equal(sql("select count(*) from glass_campaign_tastings t join glass_campaign_contacts c on c.id=t.contact_id where c.email='tour@example.com'"), '20');
  clock('2026-09-30T19:00:00Z');
  assert.equal(result(call(first, 'guest+tag@example.com', 'demitris-taverna', false, true)).status, 'expired');
  for (const instant of ['2026-09-29T06:59:59Z', '2026-10-01T19:00:00Z', '2026-10-07T19:00:00Z', '2026-10-15T07:00:00Z']) {
    clock(instant);
    const before = [count('contacts'), count('tastings'), count('submissions'), count('preference_events')];
    assert.equal(result(call(randomUUID(), 'closed@example.com')).status, 'closed');
    assert.deepEqual([count('contacts'), count('tastings'), count('submissions'), count('preference_events')], before);
  }
  for (const instant of ['2026-09-29T07:00:00Z', '2026-10-15T06:59:59Z']) {
    clock(instant); assert.equal(result(call(randomUUID(), 'boundary@example.com')).status, 'confirmed');
  }
  // Simulate a lock wait crossing midnight: a newly inserted contact must roll
  // back along with its visit, request and choice. Never installed on a host.
  sql("create sequence public.test_tasting_clock_calls; grant usage on sequence public.test_tasting_clock_calls to service_role; create or replace function public.glass_tasting_now() returns timestamptz language plpgsql volatile security invoker set search_path=pg_catalog as $$ begin if nextval('public.test_tasting_clock_calls')=1 then return '2026-09-30T06:59:59Z'::timestamptz; else return '2026-09-30T07:00:00Z'::timestamptz; end if; end; $$;");
  assert.equal(result(call(randomUUID(), 'midnight@example.com')).status, 'closed');
  assert.equal(sql("select count(*) from glass_campaign_contacts where email='midnight@example.com'"), '0');
  restoreClock();
  console.log('PASS: PostgreSQL tasting migration compatibility, atomicity/rollback, shared preferences, request intent, cross-flow isolation, concurrency, 30-per-minute race/retry, all restaurant/date combinations, Pacific boundaries, expired retries and RLS/grants.');
} finally { spawnSync('docker', ['rm', '--force', container], { encoding: 'utf8', timeout: 10000 }); }
