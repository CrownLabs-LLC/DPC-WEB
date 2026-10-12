# Join button and checkout-start tracking

Owner request: October 11, 2026, following the October 8 ad restart. This slice
distinguishes an attempt to continue from a successfully created checkout.

| Trigger | First-party event | Meta event |
| --- | --- | --- |
| Activate Continue to Checkout, including keyboard activation and invalid fields | `join_checkout_click` | custom `JoinCheckoutClick` |
| Checkout API returns a successful response with a checkout URL | existing `join_checkout_ready` | standard `InitiateCheckout` |

The dashboard shows **Continue button clicks** and **Checkout started**, with
both counts in the daily table. Existing valid submissions, navigation evidence
and completion metrics retain their meaning. Clicks use a separate query budget
and never participate in checkout-outage detection. Historical click counts
before this release are unavailable, not evidence that nobody clicked.

First-party telemetry records each activation. Meta records each of the two
intent events at most once per loaded Join document, so repeated invalid clicks
do not inflate advertising intent. Neither signal proves a paid membership.
Purchase and subscription-completion measurement remain outside this slice.

## Privacy and failure behavior

The Meta loader sends event names only. It accepts no form values, customer
identifiers, checkout URL, flow ID, price, currency or arbitrary parameters.
The existing production-host, path, referrer, URL-sanitization, GPC and saved
opt-out checks apply before SDK loading and every event. Checkout events are
restricted to `/join`; existing PageViews remain on the three approved pages.

While the SDK loads, at most one pending flag per approved event is retained
in memory. Pending events are checked again before emission and discarded on
revocation, SDK failure or restored-page revocation. A revoked document never
resumes advertising. Slow or blocked analytics never delay navigation. Like any
browser-only signal, an event can be lost when the SDK is blocked or navigation
happens before it loads. First-party diagnostics remain independent of Meta.

The immutable deployed assets remain unchanged. Join loads the new
`analytics.v2.js`; all three approved marketing pages reference
`meta-pixel.v3.js`. Privacy switches, controls and legal versions are unchanged.

## Verification

- Offline tests check API acceptance, dashboard totals/daily counts, separate
  query budgets, Meta event commands, event scope, deduplication, pending-load
  handling, revocation and forbidden events.
- Browser tests exercise invalid clicks, keyboard activation, successful and
  rejected checkout, GPC, saved opt-out and throwing analytics providers.
  Production-host fixtures intercept all network requests; no real membership
  or payment is created. Existing checkout and privacy regressions also run.
- Disposable PostgreSQL tests apply the upgrade twice, retain existing rows,
  rerun clean setup and verify the event constraint and anonymous insert-only
  access with service-role readback.

Verified locally on the slice branch from website main `b3435df`:
`npm test -- --runInBand` and `npm run test:db` passed.
After correcting the legal test's versioned analytics route and waiting for
the tracking fixture's solved Turnstile marker, the full browser suite passed
in [CI on `521646a`](https://github.com/CrownLabs-LLC/DPC-WEB/actions/runs/38207896145):
**357 passed, 9 optional screenshot checks skipped, no failures or retries**
across desktop Chromium, mobile Chromium and mobile WebKit (366 total cases).
Eight additional captured real-SDK checks passed on Chromium and mobile WebKit,
including payload checks for the new events. `git diff --check` passed.
`npx tsc --noEmit` prints compiler help (exit 1): this JavaScript-only repository
has no TypeScript project. No cross-module business imports were added.

The full-suite pass above is CI evidence. A separate local full run had 351
passes, 9 skips and 6 failures in existing legal-recovery/optional-kit tests;
5 failures passed in a single-worker rerun, with one optional-kit radio-choice
assertion still failing. Concurrent memory pressure was reported locally, but
its causal role was not established. No assertions were weakened or production
behavior changed to address those local results.

## Release order

1. Obtain owner review and approval for the PR and release.
2. Apply `db/20261011_join_checkout_click.sql` before publishing the website
   writer. Otherwise the existing database constraint rejects button events.
3. Deploy the reviewed website revision. Confirm Join references the new asset
   filenames and the dashboard exposes both counters.
4. Verify a controlled invalid click records only click intent. For a valid
   checkout test, use the approved staging flow and verify checkout-start occurs
   only after a successful response. Confirm event receipt in Meta Test Events
   when advertising is permitted, and no Meta requests for GPC/opted-out visits.

The migration is additive to the event allowlist and changes no membership or
billing tables. Roll back the website revision if necessary; retain the widened
constraint and existing event rows. Reapplying the old restrictive constraint
after click rows exist would fail. No production migration or deployment is
performed by the implementation/tests themselves.
