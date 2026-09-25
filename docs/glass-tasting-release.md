# Restaurant tasting check-in

This slice adds four browser check-ins at the already agreed destinations:

| Restaurant | Path |
| --- | --- |
| Demitri's Taverna | `/glass-comes-back/demitris-taverna` |
| Swirl on the Square | `/glass-comes-back/swirl-on-the-square` |
| Calamari Bistro & Bar | `/glass-comes-back/calamari-bistro-bar` |
| L Campo | `/glass-comes-back/l-campo` |

The public origin is `https://www.downtownpourcollective.com`. Email is required
and unverified. Marketing starts checked, remains optional, and an untouched
default preserves a saved opt-out. A successful transaction produces the same
restaurant/date confirmation for new and repeated check-ins. There is no contact
lookup, automatic email, browser storage, tracking, or staff account.

## Dates, counts and boundaries

The server accepts September 29–30, October 6, and October 13–14, 2026, using
America/Los_Angeles. October 7 is excluded. Database time determines the submitted
date; browser-supplied dates are rejected. Exact restaurant opening hours have
not been supplied, so the software enforces eligible dates. Staff apply the
normal-dining-hours, dining and physical-glass requirements.

`glass_campaign_tastings` records at most one check-in per campaign contact,
restaurant and date. This is a submitted check-in, not proof of service. Separate
restaurants and dates produce separate visits. Pickup and tasting remain separate
forms and counts, including during the same dining visit; they share contact
preferences and append-only choice history. Request IDs bind to flow and intent,
so retries cannot overwrite a later preference or become a different activity.

The migration adds tasting identity to existing submissions and adds a kind guard
to the existing pickup RPC. Old pickup submissions retain their pickup identity.
The existing pickup regression suite runs after this migration. No membership,
ledger, arrival, billing or finance records are read or changed. Imports stay
inside DPC-WEB campaign helpers; there are no cross-module internal imports.

Responses contain only the current restaurant/date and a server-calculated
expiry. They never disclose previous participation, original check-in timestamps,
contact IDs or saved preferences. The page hides a confirmation at the next
Pacific midnight, while revalidating on page return, and if availability cannot
be confirmed. No date override is shipped. Anonymous/member database access and
RPC execution are denied; the server uses its service credential.

Tastings use a separate 30-submission/60-second network bucket, shared across
restaurants. Retries count. The approved pickup HMAC/header mechanism is reused
with a separate tasting purpose; neither raw network addresses nor links to
contacts are stored in rate buckets. A missing trusted address fails closed.
HTTP 429 retains the guest's email and checkbox for retry after one minute.

## Local evidence and its limits

- `npm test -- --runInBand` includes API validation, schedule boundaries,
  safe repeats, preference intent and fail-closed environment checks.
- `npm run test:db` uses disposable, network-isolated PostgreSQL. It proves
  upgrade compatibility, concurrency, rollback, duplicate rules, all 20
  restaurant/date combinations, preference preservation, throttling and RLS.
  A deterministic clock exists only in that disposable test database.
- Playwright exercises desktop Chromium, Android Chromium and iPhone WebKit,
  including all restaurants, retries, expiry, wrong device clocks, offline
  revalidation, no JavaScript, blocked storage and narrow/keyboard layouts.
  These browser tests stub the API. Screenshots use synthetic September 29 data.
- This JavaScript repository has no TypeScript configuration. The required
  `npx tsc --noEmit` command prints help and exits 1; it is not counted as a pass.
- Actual output, the exact branch/base, screenshots and the independent design
  review belong in the review packet. Local checks are not hosted integration
  evidence. No hosted migration or environment change has been made for this slice.

## Staging verification before release

These are pending operations requiring the corresponding hosted-change approval.

1. Apply `db/20260925152006_glass_tasting.sql` once to **dpc-staging**, project
   `hohbsqkmrlhkstojfdgx`. The existing pickup migration is a prerequisite; do not
   replay it on an already migrated project. Retain the generated migration
   version and exact applied SQL in the release evidence.
2. Scope Preview server `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and
   `GLASS_TASTING_ENABLED=true` to the reviewed `codex/glass-tasting` branch.
   Use only staging credentials. Preview fails closed on the production URL.
   Admin-browser settings do not supply server credentials. Redeploy that preview
   to load its approved settings. Pickup has its own independent flag.
3. Verify all four URLs and real availability responses. Before September 29,
   confirm the next date is shown, submission is disabled, and a direct valid
   POST returns 409 without adding contacts, visits or preference history.
4. The positive hosted check cannot use today's date before September 29. For an
   approved, exclusive staging test window, save and verify the real
   `glass_tasting_now()` definition, temporarily replace it **in staging only**
   with a fixed eligible timestamp, and restore it in a `finally` cleanup. The
   test browser may intercept only the public GET availability response to show
   the same synthetic date; every POST must go through the actual Vercel API and
   hosted RPC. Do not add a production code path, environment clock flag or
   request date. Record this fixture explicitly as synthetic; it is not evidence
   that today's real date is eligible. If a controlled staging window is not
   available, positive hosted verification remains pending.
5. With uniquely labeled synthetic staging emails, submit all four forms, opt
   out, repeat with a fresh request/browser, and perform a separate pickup and
   tasting. Verify durable counts and preserved preferences privately. After a
   quiet rate window, confirm the 31st rapid tasting submission gets 429 and the
   form retains its entries; confirm retry after 60 seconds. This also proves
   Vercel supplies the trusted network header. Do not run the burst in production.
6. Verify direct anon/member reads and RPC calls are denied. Restore the exact
   real clock definition even if a test fails, confirm real-date rejection again,
   and record any synthetic row IDs for exact, authorized cleanup. Leave existing
   staging pickup evidence and other records intact. Never print service secrets.

## Production and restaurant readiness

After review, CI and production-change authorization, apply the identical
migration once to production `ebiuspbgzggrdiaswpcc`. Enable the independent
Production `GLASS_TASTING_ENABLED=true` flag only when the schema is ready.
Publish through the reviewed Git main/Vercel integration. Never apply the staging
clock fixture to production. Before an eligible date, live verification must
expect disabled check-in and 409, with no synthetic campaign data written.

Preserve the public event page's preparation notice. This campaign task owns its
later removal in Phase 6, after all four live flows are verified and Nick confirms
the exact QR cards and paper forms are printed, placed and understood by staff.
Software release alone does not establish that readiness. QR production, private
results/CSV, authenticated paper back-entry and the operational handoff remain
separate planned slices.

To disable tastings safely, set `GLASS_TASTING_ENABLED=false` and redeploy through
the approved process. Preserve all campaign records; do not drop tables or undo
the additive migration. Pickup remains independently available. After October 14,
the tasting forms refuse submissions and point guests to continuing glass pickup.
