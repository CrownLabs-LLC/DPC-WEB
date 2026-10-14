import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import handler from '../api/email-preferences-config.js';

const production = 'https://ebiuspbgzggrdiaswpcc.supabase.co/functions/v1/pour-reminder-preferences';
const staging = 'https://hohbsqkmrlhkstojfdgx.supabase.co/functions/v1/pour-reminder-preferences';
const keys = ['VERCEL_ENV', 'POUR_REMINDER_PAGE_ENABLED', 'POUR_REMINDER_API_URL'];
const original = Object.fromEntries(keys.map(key => [key, process.env[key]]));
let checks = 0;
function check(name, run) { run(); checks++; console.log('PASS: ' + name); }
function config(env, method = 'GET') {
  for (const key of keys) delete process.env[key];
  Object.assign(process.env, env);
  const res = { code: 0, headers: {}, body: null,
    setHeader(key, value) { this.headers[key.toLowerCase()] = value; },
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; } };
  handler({ method }, res);
  return res;
}
try {
  check('page gate is false for missing, false, malformed and incomplete configuration', () => {
    for (const enabled of [undefined, 'false', 'TRUE', '1', 'true ']) {
      const env = { VERCEL_ENV: 'production', POUR_REMINDER_API_URL: production };
      if (enabled !== undefined) env.POUR_REMINDER_PAGE_ENABLED = enabled;
      assert.deepEqual(config(env).body, { enabled: false });
    }
    for (const env of [{}, { POUR_REMINDER_PAGE_ENABLED: 'true' },
      { VERCEL_ENV: 'production', POUR_REMINDER_PAGE_ENABLED: 'true' }]) {
      assert.deepEqual(config(env).body, { enabled: false });
    }
  });
  check('environment target is exact; preview cannot target production or arbitrary hosts', () => {
    for (const [environment, expected] of [['production', production], ['preview', staging], ['development', staging]]) {
      assert.deepEqual(config({ VERCEL_ENV: environment, POUR_REMINDER_PAGE_ENABLED: 'true', POUR_REMINDER_API_URL: expected }).body,
        { enabled: true, apiUrl: expected });
      for (const invalid of [expected === production ? staging : production, expected + '?token=x',
        expected + '#x', expected + '/', expected.replace('https:', 'http:'),
        expected.replace('https://', 'https://user:secret@'), 'https://example.com/functions/v1/pour-reminder-preferences']) {
        assert.deepEqual(config({ VERCEL_ENV: environment, POUR_REMINDER_PAGE_ENABLED: 'true', POUR_REMINDER_API_URL: invalid }).body, { enabled: false });
      }
    }
    for (const environment of ['staging', 'unknown', '']) {
      assert.deepEqual(config({ VERCEL_ENV: environment, POUR_REMINDER_PAGE_ENABLED: 'true', POUR_REMINDER_API_URL: staging }).body, { enabled: false });
    }
  });
  check('public config has only public values and refuses non-GET methods', () => {
    const env = { VERCEL_ENV: 'preview', POUR_REMINDER_PAGE_ENABLED: 'true', POUR_REMINDER_API_URL: staging };
    for (const method of ['POST', 'PUT', 'OPTIONS']) {
      const res = config(env, method);
      assert.equal(res.code, 405);
      assert.equal(res.headers.allow, 'GET');
      assert.deepEqual(res.body, { enabled: false });
    }
    const res = config(env);
    assert.equal(res.code, 200);
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.equal(res.headers['referrer-policy'], 'no-referrer');
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.match(res.headers['x-robots-tag'], /noindex/);
    assert.deepEqual(Object.keys(res.body), ['enabled', 'apiUrl']);
  });
} finally {
  for (const key of keys) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
}

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const html = read('email-preferences.html');
const script = /<script id="preference-bootstrap">([\s\S]*?)<\/script>/.exec(html)[1];
check('capability is scrubbed before same-origin resources and never put in storage/logs', () => {
  assert.ok(html.indexOf('history.replaceState') < html.indexOf('<link'));
  assert.equal((html.match(/<script\b/g) || []).length, 1);
  assert.doesNotMatch(html, /localStorage|sessionStorage|document\.cookie|console\.|sendBeacon|analytics|pixel|sentry|privacy-controls/i);
  assert.doesNotMatch(html, /(?:src|href)="https?:/);
  assert.doesNotMatch(script, /innerHTML|insertAdjacentHTML/);
  assert.match(script, /credentials: 'omit'/);
  assert.match(script, /referrerPolicy: 'no-referrer'/);
  assert.match(script, /redirect: 'error'/);
});
check('both page routes have no-store, no-referrer, noindex and exact-script CSP', () => {
  const config = JSON.parse(read('vercel.json'));
  const hash = 'sha256-' + createHash('sha256').update(script).digest('base64');
  for (const path of ['/email-preferences', '/email-preferences.html']) {
    const headers = Object.fromEntries(config.headers.find(rule => rule.source === path).headers.map(({ key, value }) => [key.toLowerCase(), value]));
    assert.equal(headers['cache-control'], 'no-store');
    assert.equal(headers['referrer-policy'], 'no-referrer');
    assert.match(headers['x-robots-tag'], /noindex, nofollow, noarchive/);
    const csp = headers['content-security-policy'];
    assert.ok(csp.includes("script-src '" + hash + "'"));
    assert.match(csp, /default-src 'none'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /form-action 'none'/);
    assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval|\*/);
  }
});
check('page preserves static privacy/support links and member language', () => {
  assert.match(html, /href="\/privacy-choices">Do Not Sell or Share My Personal Information<\/a>/);
  assert.match(html, /href="\/support"/);
  const body = html.split('<body>')[1].replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ');
  assert.doesNotMatch(body, /credit balance|drink credit|stored value|cash value|voucher|coupon|gift card|discount|reimbursement|Schedule A/i);
  assert.match(body, /essential account emails/);
});
console.log('\n' + checks + ' email-preference checks passed.');
