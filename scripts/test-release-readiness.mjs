import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [join, support, deploy, serve, ...linkedPages] = await Promise.all([
  read('join.html'),
  read('support.html'),
  read('DEPLOY.md'),
  read('serve.json'),
  ...['index.html', 'join.html', 'partners.html', 'privacy.html', 'terms.html'].map(read),
]);

assert.match(join, /TURNSTILE_MAX_LOAD_ATTEMPTS = 50/);
assert.match(join, /error_code: 'turnstile_unavailable'/);
assert.match(join, /error_code: 'turnstile_incomplete'/);
assert.match(join, /'error-callback': showTurnstileUnavailable/);
assert.match(join, /1x00000000000000000000AA/);
assert.match(join, /www\.downtownpourcollective\.com/);

const rewrites = JSON.parse(serve).rewrites;
assert.ok(rewrites.some(({ source, destination }) => (
  source === '/support' && destination === '/support.html'
)));

assert.match(support, /role="group" aria-label="Support topics"/);
assert.match(support, /2601 Horseshoe Ct, Livermore, California 94551/);
assert.doesNotMatch(support, /<nav class="legal"[^>]*>[\s\S]*?<span>&copy;/);
for (const page of linkedPages) assert.match(page, /href="\/support"/);

assert.match(deploy, /Cloudflare Turnstile — membership checkout/);
assert.match(deploy, /TURNSTILE_SECRET_KEY/);
assert.match(deploy, /\/support/);

console.log('Release-readiness static checks passed.');
