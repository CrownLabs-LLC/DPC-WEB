import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../assets/meta-pixel.v5.js', import.meta.url), 'utf8');
const proof = { status: 'paid', circle: 'reserve', billingInterval: 'annual', amountPaid: 83900,
  currency: 'usd', livemode: true, eventId: 'UKuoT8FuzSiSrKBcx6v_vZJoH9dTkZ30tMoEo-qqFmg' };
let checks = 0;
function check(name, run) { run(); checks++; console.log('PASS:', name); }
function browser({ privacy = true, path = '/welcome', origin = 'https://www.downtownpourcollective.com',
  referrer = '', storage = new Map(), storageFails = false, scrubFails = false } = {}) {
  const listeners = {}; const scripts = [];
  const location = new URL(path + '?session_id=private#secret', origin);
  const document = { readyState: 'complete', title: 'DPC', referrer,
    querySelector: () => null, createElement: () => ({}),
    getElementsByTagName: () => [{ parentNode: { insertBefore: s => scripts.push(s) } }],
    addEventListener: (type, fn) => listeners[type] = fn };
  const window = { location, history: { replaceState(_state, _title, next) { if (scrubFails) throw Error(); location.href = new URL(next, origin).href; } },
    DPCPrivacy: { canLoadAdvertising: () => privacy },
    sessionStorage: { getItem(k) { if (storageFails) throw Error(); return storage.get(k); }, setItem(k, v) { if (storageFails) throw Error(); storage.set(k, v); } },
    addEventListener: (type, fn) => listeners[type] = fn };
  vm.runInNewContext(source, { window, document, URL, URLSearchParams, Object, Number });
  return { window, scripts, storage, listeners, location,
    revoke() { privacy = false; listeners['dpc:privacy-change'](); },
    calls() { return JSON.parse(JSON.stringify(window.fbq?.queue?.map(args => Array.from(args)) || [])); } };
}
const purchases = b => b.calls().filter(c => c[1] === 'Purchase');
check('Purchase snapshots verified fields and uses cents plus Meta eventID options', () => {
  const b = browser(); const input = { ...proof, email: 'private@example.invalid', value: 1 };
  assert.equal(b.window.DPCMetaPixel.track('Purchase', input), true);
  input.amountPaid = 1; input.circle = 'tap';
  assert.equal(purchases(b).length, 0); assert.equal(b.storage.size, 0);
  b.scripts[0].onload();
  assert.deepEqual(purchases(b), [['track', 'Purchase', { content_name: 'reserve_annual', value: 839, currency: 'USD' }, { eventID: proof.eventId }]]);
  assert.deepEqual([...b.storage.keys()], ['dpc_purchase:' + proof.eventId]);
  assert.doesNotMatch(JSON.stringify([...b.storage.keys()]), /cs_(live|test)_/);
  assert.equal(b.location.search, ''); assert.equal(b.location.hash, '');
  assert.doesNotMatch(JSON.stringify(b.calls()), /private|email|secret|cs_(live|test)_/);
});
check('legacy sessionId fields are never forwarded to Meta or used as storage keys', () => {
  for (const mode of ['live', 'test']) {
    const b = browser(); b.scripts[0].onload();
    assert.equal(b.window.DPCMetaPixel.track('Purchase', { ...proof, sessionId: 'cs_' + mode + '_' + 'x'.repeat(40) }), true);
    assert.equal(purchases(b)[0][3].eventID, proof.eventId);
    assert.deepEqual([...b.storage.keys()], ['dpc_purchase:' + proof.eventId]);
    assert.doesNotMatch(JSON.stringify([b.calls(), [...b.storage.keys()]]), /cs_(live|test)_/);
  }
});
check('once-per-session survives another document, and different sessions remain eligible', () => {
  const storage = new Map(); const first = browser({ storage }); first.scripts[0].onload();
  first.window.DPCMetaPixel.track('Purchase', proof); first.window.DPCMetaPixel.track('Purchase', proof);
  assert.equal(purchases(first).length, 1);
  const reload = browser({ storage }); reload.scripts[0].onload(); reload.window.DPCMetaPixel.track('Purchase', proof);
  assert.equal(purchases(reload).length, 0);
  reload.window.DPCMetaPixel.track('Purchase', { ...proof, eventId: 'ZYIua0mzC_WEM9B80EKmgVoOHKJsOvKnRYifitln0B8' });
  assert.equal(purchases(reload).length, 1);
});
check('pending SDK events are discarded on opt-out and Back restore without marking dedup', () => {
  for (const trigger of [b => b.revoke(), b => b.listeners.pageshow({ persisted: true })]) {
    const b = browser(); b.window.DPCMetaPixel.track('Purchase', proof); trigger(b); b.scripts[0].onload();
    assert.equal(purchases(b).length, 0); assert.equal(b.storage.size, 0);
  }
});
check('privacy, referrer, origin, path and scrub guards apply to Purchase', () => {
  for (const options of [{ privacy: false }, { path: '/join' }, { path: '/' }, { path: '/subscription-success' },
    { origin: 'https://preview.vercel.app' }, { referrer: 'https://checkout.stripe.com/c/pay/private' },
    { referrer: 'https://www.downtownpourcollective.com/welcome?session_id=private' }, { scrubFails: true }]) {
    const b = browser(options); b.scripts[0]?.onload();
    assert.equal(b.window.DPCMetaPixel.track('Purchase', proof), false); assert.equal(purchases(b).length, 0);
  }
});
check('Purchase rejects malformed/test/unpaid payloads and unavailable storage', () => {
  const bad = [null, {}, { ...proof, livemode: false }, { ...proof, status: 'pending' }, { ...proof, currency: 'eur' },
    { ...proof, amountPaid: -1 }, { ...proof, amountPaid: 1.5 }, { ...proof, amountPaid: '83900' },
    { ...proof, amountPaid: 100000000 }, { ...proof, circle: 'private' }, { ...proof, billingInterval: 'weekly' },
    ...[undefined, '', 'a'.repeat(42), 'a'.repeat(44), 'a'.repeat(42) + '=', 'a'.repeat(42) + '/',
      'a'.repeat(42) + '+', 'private@example.invalid', ...['live', 'test'].flatMap(mode =>
        ['x'.repeat(40), 'x'.repeat(35)].map(suffix => 'cs_' + mode + '_' + suffix))].map(eventId => ({ ...proof, eventId })),
    { ...proof, eventId: undefined, sessionId: 'cs_live_' + 'x'.repeat(40) }];
  for (const input of bad) { const b = browser(); b.scripts[0].onload(); assert.equal(b.window.DPCMetaPixel.track('Purchase', input), false); assert.equal(purchases(b).length, 0); assert.equal(b.storage.size, 0); }
  const b = browser({ storageFails: true }); b.scripts[0].onload();
  assert.equal(b.window.DPCMetaPixel.track('Purchase', proof), false); assert.equal(purchases(b).length, 0);
});
check('SDK load failure never records a purchase or consumes the dedup guard', () => {
  const b = browser(); b.window.DPCMetaPixel.track('Purchase', proof); b.scripts[0].onerror();
  assert.equal(purchases(b).length, 0); assert.equal(b.storage.size, 0);
});
console.log(`Welcome pixel: ${checks} groups passed.`);
