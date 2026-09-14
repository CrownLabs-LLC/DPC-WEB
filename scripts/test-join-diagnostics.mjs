import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { sanitizeDiagnostics } from '../api/lib/join-diagnostics.js';
import track from '../api/track.js';
import legalVersions from '../api/legal-versions.js';

const id = 'a0000000-0000-4000-8000-000000000001';
const safe = { component: 'legal_versions', stage: 'initial_load', failure_kind: 'timeout', request_id: id, elapsed_ms: 4000 };
const unsafe = { ...safe, message: 'private@example.invalid', token: 'secret', provider_code: 'private@example.invalid', episode_id: 'bad-id', attempt: -1, body_code: 'private@example.invalid' };
assert.deepEqual(sanitizeDiagnostics(unsafe), safe);
assert.equal(sanitizeDiagnostics([]), null);

function response() {
  return { headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
}

process.env.SUPABASE_URL = 'https://example.invalid';
process.env.SUPABASE_ANON_KEY = 'test-anon';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service';
const originalFetch = globalThis.fetch;
const originalError = console.error;
const originalInfo = console.info;
try {
  const writes = [];
  globalThis.fetch = async (_url, opts) => { writes.push(JSON.parse(opts.body)); return new Response(null, { status: 201 }); };
  for (const event of ['join_error', 'join_recovery']) {
    const res = response();
    await track({ method: 'POST', body: { event, diagnostics: unsafe } }, res);
    assert.equal(res.body.stored, true);
    assert.deepEqual(writes.at(-1).diagnostics, safe);
  }
  const logs = [];
  console.error = console.info = (_label, json) => logs.push(JSON.parse(json));
  for (const [kind, reply] of [
    ['timeout', () => { throw new DOMException('private@example.invalid', 'TimeoutError'); }],
    ['network', () => { throw new TypeError('private@example.invalid'); }],
    ['rpc', () => new Response(JSON.stringify({ code: 'PGRST202', message: 'private@example.invalid' }), { status: 404, headers: { 'sb-request-id': id } })],
    ['invalid_json', () => new Response('private@example.invalid', { status: 200 })],
    ['incomplete_tuple', () => new Response('{}', { status: 200 })],
  ]) {
    globalThis.fetch = async () => reply();
    const res = response();
    await legalVersions({ method: 'GET', query: {} }, res);
    assert.equal(res.code, 503);
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.equal(res.headers['x-dpc-failure-kind'], kind);
    assert.equal(logs.at(-1).request_id, res.headers['x-dpc-request-id']);
    assert.equal(logs.at(-1).failure_kind, kind);
    assert.equal(Number.isInteger(logs.at(-1).elapsed_ms), true);
    if (kind === 'rpc') {
      assert.equal(logs.at(-1).provider_request_id, id);
      assert.equal(logs.at(-1).body_code, 'PGRST202');
      assert.equal(logs.at(-1).http_status, 404);
    }
  }
  assert.equal(JSON.stringify(logs).includes('private@example.invalid'), false);
} finally {
  globalThis.fetch = originalFetch;
  console.error = originalError;
  console.info = originalInfo;
}

// Exercise the actual two browser scripts together, with GA already loaded.
const beacons = [], ga = [];
let clock = 100;
const sandbox = {
  performance: { now: () => clock },
  navigator: {},
  document: { referrer: '' },
  fetch: async (_url, opts) => { beacons.push(JSON.parse(opts.body)); },
  location: { pathname: '/join' }, crypto: { randomUUID },
  gtag: (...args) => ga.push(args),
};
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const path of ['assets/analytics.js', 'assets/join-diagnostics.js']) {
  vm.runInContext(readFileSync(new URL('../' + path, import.meta.url), 'utf8'), sandbox);
}
const diagnostics = sandbox.DPCJoinDiagnostics('legal_versions');
diagnostics.begin('initial_load');
clock += 4000;
diagnostics.failure('legal_versions_unavailable', { ...unsafe, status: 503 });
diagnostics.begin('retry');
clock += 120;
diagnostics.recovered();
diagnostics.recovered(); // repeated success must not invent recovery events
assert.deepEqual(beacons.map((p) => p.event), ['join_error', 'join_recovery', 'join_recovery']);
assert.deepEqual(beacons.map((p) => p.diagnostics.attempt), [1, 2, 2]);
assert.equal(new Set(beacons.map((p) => p.diagnostics.episode_id)).size, 1);
assert.equal(beacons[0].diagnostics.elapsed_ms, 4000);
assert.equal(beacons[2].diagnostics.elapsed_ms, 120);
assert.equal(beacons[2].diagnostics.outcome, 'recovered');
assert.equal(JSON.stringify(beacons).includes('private@example.invalid'), false);
assert.equal(ga.length, 1);
assert.equal(ga[0][2].diagnostics, undefined);
const episode = beacons[0].diagnostics.episode_id;
diagnostics.begin('submit_check');
diagnostics.failure('legal_versions_unavailable', { failure_kind: 'network' });
assert.notEqual(beacons.at(-1).diagnostics.episode_id, episode);
assert.equal(beacons.at(-1).diagnostics.attempt, 1);
sandbox.DPCAnalytics.track = () => { throw new Error('telemetry failure'); };
assert.doesNotThrow(() => diagnostics.failure('legal_versions_unavailable', {}));
assert.doesNotThrow(() => diagnostics.recovered());
console.log('PASS: Join diagnostics correlation, recovery, privacy, GA isolation, and server error classification.');
