import assert from 'node:assert/strict';
import { STAGING_PROJECT_URL, previewOrigin, assertStagingConfiguration, allowedFixture } from '../staging/homepage-checkout/preview-policy.mjs';
const origin = 'https://dpc-web-git-codex-homepage-rebuild-brandis-projects-65a11cb6.vercel.app';
const config = { environment: 'staging', stripeSecretKey: 'sk_test_fixture', turnstileMode: 'official_dummy' };
assert.equal(assertStagingConfiguration(STAGING_PROJECT_URL, config, origin), origin);
for (const value of ['https://www.downtownpourcollective.com', origin+'.evil.test', origin+'?next=live', origin+'/join', origin.replace('https:', 'http:'), origin.replace('https://','https://user:pass@')]) {
  assert.throws(() => previewOrigin(value));
}
for (const bad of [{...config, environment:'production'}, {...config, stripeSecretKey:'sk_live_fixture'}, {...config, turnstileMode:'hostname_bound'}]) {
  assert.throws(() => assertStagingConfiguration(STAGING_PROJECT_URL,bad,origin));
}
assert.throws(() => assertStagingConfiguration('https://ebiuspbgzggrdiaswpcc.supabase.co',config,origin));
const email = 'dpc-homepage-qa-20261020-tap-monthly@example.com';
assert(allowedFixture(origin,origin,email));
for (const email of ['member@example.com','dpc-homepage-qa-20261020-tap@gmail.com','dpc-homepage-qa-20261020-tap@example.com.evil.test',null]) {
  assert(!allowedFixture(origin,origin,email));
}
assert(!allowedFixture('https://www.downtownpourcollective.com',origin,email));
assert(!allowedFixture(null,origin,email));
console.log('PASS: staging-only project, test Stripe mode, exact preview origin and synthetic identity guards');
