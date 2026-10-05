import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../assets/meta-pixel.v1.js', import.meta.url), 'utf8');
const PIXEL_ID = '28569583012647858';
let checks = 0;
function check(name, run) { run(); checks++; console.log('PASS:', name); }

function browser({
  path = '/', search = '', hash = '', referrer = '', privacyAllowed = false,
  origin = 'https://www.downtownpourcollective.com', readyState = 'complete', scrubThrows = false
} = {}) {
  const listeners = {};
  const inserted = [];
  const firstScript = { parentNode: { insertBefore(node) { inserted.push(node); } } };
  const location = {
    origin,
    protocol: origin.split(':')[0] + ':',
    hostname: new URL(origin).hostname,
    pathname: path,
    search,
    hash
  };
  const window = {
    location,
    history: {
      state: null,
      replaceState(state, _title, nextPath) {
        if (scrubThrows) throw Error('history unavailable');
        this.state = state;
        location.pathname = nextPath;
        location.search = '';
        location.hash = '';
      }
    },
    DPCPrivacy: { canLoadAdvertising() { return privacyAllowed; } },
    addEventListener(type, listener) { listeners[type] = listener; }
  };
  const document = {
    readyState,
    title: 'DPC',
    referrer,
    createElement(tag) { return { tag }; },
    getElementsByTagName(tag) { return tag === 'script' ? [firstScript] : []; },
    addEventListener(type, listener) { listeners[type] = listener; }
  };
  vm.runInNewContext(source, { window, document, URL, Object });
  return { window, document, location, listeners, inserted };
}

function queuedCalls(b) {
  return JSON.parse(JSON.stringify((b.window.fbq && b.window.fbq.queue || []).map(args => Array.from(args))));
}

check('production-disabled privacy gate makes zero Meta SDK or event requests', () => {
  for (const path of ['/', '/join', '/subscription-success']) {
    const b = browser({ path, privacyAllowed: false });
    assert.equal(b.inserted.length, 0);
    assert.equal(typeof b.window.fbq, 'undefined');
    assert.equal(b.window.DPCMetaPixel.getState().sdkRequested, false);
  }
});

check('enabled path requests the exact SDK without advanced matching and emits PageView once', () => {
  const b = browser({ path: '/join', privacyAllowed: true });
  assert.equal(b.inserted.length, 1);
  assert.equal(b.inserted[0].src, 'https://connect.facebook.net/en_US/fbevents.js');
  assert.equal(b.inserted[0].referrerPolicy, 'no-referrer');
  assert.equal(b.window.fbq.disablePushState, true);
  assert.deepEqual(queuedCalls(b).slice(0, 2), [
    ['set', 'autoConfig', false, PIXEL_ID],
    ['init', PIXEL_ID]
  ]);
  b.inserted[0].onload();
  assert.deepEqual(queuedCalls(b).filter(call => call[0] === 'track'), [['track', 'PageView']]);
  assert.equal(b.window.DPCMetaPixel.track('PageView'), false);
  assert.equal(b.window.DPCMetaPixel.track('Purchase'), false);
});

check('homepage, join and membership success are the only eligible paths', () => {
  for (const path of ['/', '/join', '/join/', '/subscription-success']) {
    assert.equal(browser({ path, privacyAllowed: true }).inserted.length, 1, path);
  }
  for (const path of ['/depositor-confirmation', '/reserved-confirmation', '/subscription-cancelled', '/partners', '/support', '/privacy-choices', '/dashboard', '/admin/support', '/glass-pickup', '/glass-comes-back', '/glass-comes-back/demitris-taverna', '/glass-comes-back/calamari-bistro-bar', '/glass-comes-back/l-campo', '/glass-comes-back/swirl-on-the-square']) {
    assert.equal(browser({ path, privacyAllowed: true }).inserted.length, 0, path);
  }
});

check('preview, local and non-HTTPS hosts cannot request Meta even if a flag is changed', () => {
  for (const origin of ['https://preview.example.test', 'http://127.0.0.1:4173', 'http://www.downtownpourcollective.com']) {
    assert.equal(browser({ path: '/join', privacyAllowed: true, origin }).inserted.length, 0, origin);
  }
});

check('query strings and fragments are removed before the SDK boundary', () => {
  const b = browser({ path: '/join', search: '?email=person%40example.com&utm_source=test', hash: '#secret', privacyAllowed: true });
  assert.equal(b.inserted.length, 1);
  assert.equal(b.location.pathname, '/join');
  assert.equal(b.location.search, '');
  assert.equal(b.location.hash, '');
  assert.doesNotMatch(JSON.stringify(queuedCalls(b)), /person|example|utm|secret/i);
});

check('unsafe referrer details fail closed before any Meta request', () => {
  for (const referrer of [
    'https://www.downtownpourcollective.com/join?email=person@example.com',
    'https://example.com/customer/12345',
    'not a url'
  ]) {
    assert.equal(browser({ path: '/join', referrer, privacyAllowed: true }).inserted.length, 0, referrer);
  }
  assert.equal(browser({ path: '/join', referrer: 'https://www.google.com/', privacyAllowed: true }).inserted.length, 1);
});

check('a later privacy block suppresses an event while the SDK is loading', () => {
  let allowed = true;
  const b = browser({ path: '/subscription-success', privacyAllowed: true });
  b.window.DPCPrivacy.canLoadAdvertising = () => allowed;
  allowed = false;
  b.listeners['dpc:privacy-change']({ detail: { optedOut: false } });
  assert.deepEqual(queuedCalls(b).filter(call => call[0] === 'consent'), [['consent', 'revoke']]);
  b.inserted[0].onload();
  assert.equal(queuedCalls(b).filter(call => call[0] === 'track').length, 0);
});

check('privacy changes revoke the loaded SDK and never grant consent back', () => {
  const b = browser({ privacyAllowed: true });
  b.inserted[0].onload();
  b.listeners['dpc:privacy-change']();
  assert.equal(queuedCalls(b).filter(call => call[0] === 'consent').length, 0);
  b.window.DPCPrivacy.canLoadAdvertising = () => false;
  b.listeners['dpc:privacy-change']();
  b.window.DPCPrivacy.canLoadAdvertising = () => true;
  b.listeners['dpc:privacy-change']();
  assert.deepEqual(queuedCalls(b).filter(call => call[0] === 'consent'), [['consent', 'revoke']]);
  const blocked = browser();
  blocked.listeners['dpc:privacy-change']();
  assert.equal(typeof blocked.window.fbq, 'undefined');
});

check('bfcache restores revoke SDK consent before its independent automatic event', () => {
  const b = browser({ privacyAllowed: true });
  b.listeners.pageshow({ persisted: false });
  assert.equal(queuedCalls(b).filter(call => call[0] === 'consent').length, 0);
  b.listeners.pageshow({ persisted: true });
  assert.deepEqual(queuedCalls(b).filter(call => call[0] === 'consent'), [['consent', 'revoke']]);
});

check('public tracking safely refuses requests before SDK setup or after failed setup', () => {
  for (const options of [
    { readyState: 'loading' },
    { search: '?private=1', scrubThrows: true }
  ]) {
    const b = browser({ ...options, privacyAllowed: true });
    assert.equal(b.window.DPCMetaPixel.track('PageView'), false);
    assert.equal(typeof b.window.fbq, 'undefined');
  }
  const b = browser({ privacyAllowed: true });
  b.inserted[0].onerror();
  assert.equal(b.window.DPCMetaPixel.track('PageView'), false);
});

check('later public tracking scrubs a changed URL before emitting on another allowed path', () => {
  const b = browser({ privacyAllowed: true });
  b.inserted[0].onload();
  b.location.pathname = '/join';
  b.location.search = '?private=1';
  b.location.hash = '#private';
  assert.equal(b.window.DPCMetaPixel.track('PageView'), true);
  assert.equal(b.location.search, '');
  assert.equal(b.location.hash, '');
});

check('source contains no noscript beacon, customer data, purchase event or CAPI path', () => {
  assert.doesNotMatch(source, /<noscript|facebook\.com\/tr|fetch\s*\(|sendBeacon/i);
  assert.doesNotMatch(source, /fbq\(['"]track['"],\s*['"](?:Purchase|Subscribe|Lead|CompleteRegistration)['"]/);
  assert.doesNotMatch(source, /fbq\(['"]init['"],\s*PIXEL_ID\s*,/);
  assert.match(source, /ALLOWED_EVENTS = Object\.freeze\(\['PageView'\]\)/);
});

console.log('\n' + checks + ' Meta Pixel checks passed.');
