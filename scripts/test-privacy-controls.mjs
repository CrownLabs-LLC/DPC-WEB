import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../assets/privacy-controls.v1.js', import.meta.url), 'utf8');
const KEY = 'dpc_advertising_opt_out';
let checks = 0;
function check(name, run) { run(); checks++; console.log('PASS:', name); }

function browser({ gpc = false, local = new Map(), cookies = new Map(), blockLocal = false, blockCookie = false, cookieThrows = false, host = 'www.downtownpourcollective.com' } = {}) {
  const listeners = {};
  const button = { attrs: {}, hidden: true, setAttribute(k,v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; }, addEventListener(k,v) { this[k] = v; } };
  const status = {};
  const document = {
    readyState: 'complete',
    getElementById(id) { return id === 'privacy-opt-out' ? button : id === 'privacy-choice-status' ? status : null; },
    get cookie() { if (cookieThrows) throw Error('storage denied'); return [...cookies].map(([k,v]) => k + '=' + v).join('; '); },
    set cookie(value) { this.lastCookie = value; if (cookieThrows) throw Error('storage denied'); if (!blockCookie) { const [k,v] = value.split(';')[0].split('='); cookies.set(k,v); } }
  };
  const window = {
    navigator: { globalPrivacyControl: gpc }, location: { hostname: host, protocol: 'https:' },
    localStorage: { getItem(k) { if (blockLocal) throw Error('denied'); return local.get(k) ?? null; }, setItem(k,v) { if (blockLocal) throw Error('denied'); local.set(k,v); } },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    addEventListener(k,v) { listeners[k] = v; }, dispatchEvent() {}
  };
  vm.runInNewContext(source, { window, document });
  return { api: window.DPCPrivacy, window, document, button, status, listeners, local, cookies };
}

check('default is unselected and advertising is hard-disabled', () => {
  const b = browser();
  assert.equal(b.api.getState().optedOut, false);
  assert.equal(b.api.canLoadAdvertising(), false);
  assert.equal(b.api.getState().advertisingEnabled, false);
  assert.equal(b.button.hidden, false);
});
check('legacy analytics acceptance never grants advertising permission', () => {
  for (const key of ['dpc_cookie_consent', 'dpc_partner_cookie_consent']) {
    const b = browser({ local: new Map([[key, '1']]) });
    assert.equal(b.api.canLoadAdvertising(), false);
    assert.equal(b.api.getState().optedOut, false);
  }
});
check('manual opt-out persists in cookie and local storage without changing analytics', () => {
  const b = browser({ local: new Map([['dpc_cookie_consent', '1']]) });
  b.button.click();
  assert.equal(b.cookies.get(KEY), '1');
  assert.equal(b.local.get(KEY), '1');
  assert.equal(b.local.get('dpc_cookie_consent'), '1');
  assert.match(b.document.lastCookie, /Path=\/; Max-Age=31536000; SameSite=Lax; Domain=downtownpourcollective.com; Secure$/);
  assert.equal(b.api.getState().saved, true);
  assert.match(b.status.textContent, /opt-out is saved/);
  assert.equal(browser({ local: b.local, cookies: b.cookies }).api.getState().optedOut, true);
});
check('GPC takes precedence and remains saved after the signal is disabled', () => {
  const b = browser({ gpc: true, local: new Map([['dpc_cookie_consent', '1']]) });
  assert.equal(b.api.canLoadAdvertising(), false);
  assert.equal(b.api.getState().optedOut, true);
  assert.equal(b.button.attrs['aria-disabled'], 'true');
  assert.match(b.status.textContent, /Global Privacy Control is on/);
  assert.equal(browser({ cookies: b.cookies }).api.getState().optedOut, true);
});
check('cookie-only and local-only preferences both survive reload', () => {
  for (const blockLocal of [true, false]) {
    const b = browser({ blockLocal, blockCookie: !blockLocal });
    b.api.optOut();
    assert.equal(b.api.getState().saved, true);
    assert.equal(browser({ local: b.local, cookies: b.cookies }).api.getState().optedOut, true);
  }
});
check('fully blocked storage does not report a successful save or enable advertising', () => {
  for (const cookieThrows of [true, false]) {
    const b = browser({ blockLocal: true, blockCookie: true, cookieThrows });
    b.button.click();
    assert.equal(b.api.getState().saved, false);
    assert.equal(b.api.getState().optedOut, true);
    assert.equal(b.api.canLoadAdvertising(), false);
    assert.match(b.status.textContent, /did not let us save/);
    assert.equal(b.button.attrs['aria-disabled'], 'false');
  }
});
check('GPC still blocks with no storage', () => {
  const b = browser({ gpc: true, blockLocal: true, cookieThrows: true });
  assert.equal(b.api.getState().optedOut, true);
  assert.equal(b.api.getState().saved, false);
  assert.equal(b.api.canLoadAdvertising(), false);
  assert.match(b.status.textContent, /keep Global Privacy Control on/);
});
check('cross-tab opt-out refreshes status; unrelated keys do not change preference', () => {
  const b = browser();
  b.local.set(KEY, '1');
  b.listeners.storage({ key: KEY });
  assert.match(b.status.textContent, /opt-out is saved/);
  b.listeners.storage({ key: 'dpc_cookie_consent' });
  assert.equal(b.api.getState().optedOut, true);
});
check('returning to a page rechecks GPC, including back-forward cache restores', () => {
  for (const event of ['pageshow','focus']) {
    const b = browser();
    b.window.navigator.globalPrivacyControl = true;
    b.listeners[event]();
    assert.equal(b.api.getState().saved, true);
    assert.match(b.status.textContent, /Global Privacy Control is on/);
  }
});
check('clearing storage does not undo an in-page opt-out; new pages read storage afresh', () => {
  const b = browser(); b.api.optOut(); b.local.clear(); b.cookies.clear();
  b.listeners.storage({ key: null });
  assert.equal(b.api.getState().optedOut, true);
  assert.equal(browser().api.getState().optedOut, false);
});
check('preview/local cookies stay host-only; preference names require an exact match', () => {
  const b = browser({ host: 'preview.example.test', cookies: new Map([['not_' + KEY, '1']]) });
  assert.equal(b.api.getState().optedOut, false);
  b.api.optOut();
  assert.doesNotMatch(b.document.lastCookie, /Domain=/);
});
check('all public pages expose a static opt-out link and load controls before analytics', () => {
  const root = new URL('../', import.meta.url);
  const files = readdirSync(root).filter(f => f.endsWith('.html') && !['dashboard.html','google92d1118acab8f389.html'].includes(f));
  files.push('stripe-connect/return.html', 'stripe-connect/refresh.html');
  files.push(...readdirSync(new URL('glass-comes-back/', root)).filter(f => f.endsWith('.html')).map(f => 'glass-comes-back/' + f));
  for (const file of files) {
    const html = readFileSync(new URL(file, root), 'utf8');
    assert.match(html, /privacy-controls\.v1\.js/);
    if (file !== 'privacy-choices.html') assert.match(html, /privacy-footer\.v2\.css/);
    if (file !== 'privacy-choices.html') assert.match(html, /<a href="\/privacy-choices">Do Not Sell or Share My Personal Information<\/a>/);
    const analytics = html.indexOf('src="assets/analytics.js"');
    if (analytics !== -1) assert.ok(html.indexOf('privacy-controls.v1.js') < analytics);
    assert.doesNotMatch(html, /connect\.facebook\.net|facebook\.com\/tr[?]|fbq\s*\(/);
  }
  const footerCss = readFileSync(new URL('assets/privacy-footer.v2.css', root), 'utf8');
  assert.match(footerCss, /\.dpc-policy-notice\s*\{/);
  assert.doesNotMatch(source, /fetch\s*\(|sendBeacon|createElement\s*\(|fbq\s*\(/);
});
check('choices page states the counsel-approved App-data exclusion', () => {
  const html = readFileSync(new URL('../privacy-choices.html', import.meta.url), 'utf8');
  assert.match(html, /do not use App-collected data/);
  assert.match(html, /precise location/);
  assert.match(html, /Check-In records/);
  assert.match(html, /Membership Pour redemption data/);
});
console.log('\n' + checks + ' privacy-control checks passed.');
