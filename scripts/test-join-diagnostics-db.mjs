// Disposable local PostgreSQL only. No project credentials or exposed ports.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

const container = 'dpc-diag-test-' + randomUUID();
const image = 'public.ecr.aws/supabase/postgres:17.6.1.167';
function docker(args, input) {
  const result = spawnSync('docker', args, { input, encoding: 'utf8', timeout: 60000 });
  assert.equal(result.status, 0, result.error?.message || result.stderr);
  return result.stdout;
}
function sql(input) {
  return docker(['exec', '-i', container, 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], input);
}
const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
try {
  docker(['run', '--detach', '--rm', '--network', 'none', '--name', container,
    '-e', 'POSTGRES_PASSWORD=local-diagnostics-test-only', image]);
  let ready = false;
  for (let i = 0; i < 60; i++) {
    const probe = spawnSync('docker', ['exec', container, 'pg_isready', '-U', 'postgres'], { timeout: 1000 });
    if (probe.status === 0) { ready = true; break; }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.ok(ready, 'Local PostgreSQL did not become ready');
  sql(read('db/setup.sql'));
  sql("insert into site_events(event) values ('join_error');");
  sql(read('db/20260914_join_diagnostics.sql'));
  sql("insert into site_events(event,diagnostics) values ('join_recovery','{\"component\":\"legal_versions\",\"outcome\":\"recovered\"}');");
  // Both setup and incremental migration must remain safe after new events exist.
  sql(read('db/setup.sql'));
  sql(read('db/20260914_join_diagnostics.sql'));
  sql(read('tests/db/join-diagnostics.sql'));
  console.log('PASS: PostgreSQL migration reapplication, legacy rows, bounded diagnostics, anonymous insert-only RLS and service-role reads.');
} finally {
  spawnSync('docker', ['rm', '--force', container], { encoding: 'utf8', timeout: 10000 });
}
