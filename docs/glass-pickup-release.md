# Universal glass pickup: review and release

This slice adds `/glass-pickup` on the existing DPC website. It records one pickup
per normalized email for the 2026 campaign, without a location. Email is required;
marketing is optional and initially checked. An untouched default keeps a saved
choice. Confirmation follows a successful database transaction and shows current
restaurant tasting information. Pickup has no scheduled start or end date.

The fixed QR destination is:
`https://www.downtownpourcollective.com/glass-pickup`.
Nick may print it before deployment; guest use waits for a verified live flow.

## Scope and ownership

The four `glass_campaign_*` tables and submission RPC belong to this DPC-WEB
promotion. They do not touch memberships, credit ledgers, arrivals, finance,
subscriptions, email providers, or analytics. No cross-repository module-internal
imports are introduced. SQL defaults are explicitly narrowed to prevent anonymous
or authenticated reads and to make preference and request history append-only to
the service role. Browser responses never identify a contact, reveal a saved
choice, or distinguish a new pickup from a repeated email.

The new fonts are locally served copies of the existing DPC typefaces, from
Google Fonts, with their OFL license files. No third-party requests are required
for this page. The site's existing privacy controls and links remain available.

Restaurant tasting check-in, the public event page, private results/CSV exports,
paper back-entry, four restaurant QR cards, and Nick's demonstrated admin
walkthrough are later reviewed slices. The pickup sign and paper sheet can be
prepared now; a stored pickup check-in is not proof of physical glass handover.

## Read-only hosting inspection, September 24

Vercel project: `brandis-projects-65a11cb6/dpc-web`.

- Production `SUPABASE_URL`: `https://ebiuspbgzggrdiaswpcc.supabase.co` (verified value).
- Production `SUPABASE_SERVICE_ROLE_KEY`: present as a secret; its value was not
  revealed or copied. Runtime authorization for the new RPC remains to be tested.
- Preview `ADMIN_SUPABASE_URL`: `https://hohbsqkmrlhkstojfdgx.supabase.co`
  (verified value), with a Preview admin anon key. These are admin-browser settings.
- The Project variable list has no Preview server `SUPABASE_URL` or
  `SUPABASE_SERVICE_ROLE_KEY` and no `GLASS_*` variable. Add the correct Preview
  server binding before staging verification. Do not reuse production credentials.
- No environment settings, hosted schema, account privileges, or releases were
  changed during this inspection. Safari project access works; local Vercel CLI
  credentials are invalid and were not refreshed.

Nick's confirmed production Auth account has the existing `admin` role, verified
read-only. No expanded access is required for the later private campaign surface.

## Required release sequence

1. Obtain approval to open this independently verified pickup PR from current
   `main`. Brandi reviews and merges; agents do not approve or merge it.
2. With the corresponding migration/configuration approval, apply
   `db/20260924202337_glass_pickup.sql` once to the **staging** project. The migration
   was generated through `supabase migration new glass_pickup` and retained its
   generated timestamp under this repository's existing `db/` convention.
3. Set Preview `SUPABASE_URL` and server-only `SUPABASE_SERVICE_ROLE_KEY` to staging
   and `GLASS_PICKUP_ENABLED=true` for the reviewed campaign preview. Existing
   admin URL/anon settings do not substitute for these server variables. Redeploy
   the approved preview through the normal process to load environment changes.
4. Use synthetic staging addresses to exercise the real HTTP → RPC → confirmation
   path, uncheck marketing, repeat it, and verify one contact/pickup and preserved
   preference. Check that anon/member table access and RPC execution are denied.
   Record request/row evidence without copying actual contact data into logs.
5. With production migration/release approval, apply the same additive migration
   to `ebiuspbgzggrdiaswpcc`. Keep pickup disabled until the production schema is
   ready. Set `GLASS_PICKUP_ENABLED=true` for Production when authorized.
6. Publish through the reviewed Git main/Vercel integration, not local
   `vercel --prod`. Verify the production page, availability response, privacy
   links, and an authorized actual pickup. Keep staging/test entries out of real
   campaign totals. Validate the printed QR on a phone before guest use.

The endpoint fails closed if the flag, server URL, or service key is absent. A
Vercel Preview URL must bind to the known staging project; Production must bind
to the known production project. Dates do not control pickup availability.

To stop pickup safely, set `GLASS_PICKUP_ENABLED=false` and redeploy using the
approved process. Preserve recorded data; do not drop the tables as rollback.
The form then directs guests to the paper fallback. Closing the tasting schedule
on October 14 does not turn pickup off.

## Local verification

- `npm test -- --runInBand`: offline endpoint and privacy checks, including the
  pickup contract, run without service credentials or external writes.
- `npm run test:db`: existing diagnostics and new pickup tests run in disposable
  network-isolated PostgreSQL containers. Covers concurrency, retry after newer
  preference, opt-out preservation, rollback, access grants and RLS.
- The diagnostics fixture now waits for TCP readiness after Supabase image
  initialization and uses the local bootstrap administrator for `SET ROLE` tests.
  This changes no production permissions and fixes a pre-existing fixture race.
- Playwright pickup tests cover desktop Chromium, Android Chromium, and iPhone
  WebKit: optional marketing, confirmation, retry identity, errors, ended tasting
  dates, keyboard use, narrow viewports, blocked storage and no-JavaScript fallback.
  Browser fixtures stub HTTP responses; hosted integration remains a release gate.
- This is JavaScript, with no TypeScript project configuration. `npx tsc --noEmit`
  prints compiler help and exits 1. It is not a passing TypeScript check; JavaScript
  syntax checks and functional tests supply applicable local evidence.
- Full website browser-suite results, any isolated retries, raw output, screenshots,
  and the unchanged main SHA belong in the review packet. Do not claim a green
  full suite if a pre-existing test failed in the recorded run.

No Meta activation or open Meta PR dependency is part of this release.
