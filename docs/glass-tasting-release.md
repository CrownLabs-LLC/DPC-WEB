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
restaurant/date confirmation on the guest's device for new and repeated check-ins. There is no contact
lookup, automatic email, browser storage, tracking, or staff account.

## Dates, counts and boundaries

The server accepts September 29–30, October 6, and October 13–14, 2026, using
America/Los_Angeles. October 7 is excluded. Database time determines the submitted
date; browser-supplied dates are rejected. Exact restaurant opening hours have
not been supplied, so the software enforces eligible dates. Staff apply the
normal-dining-hours, dining and physical-glass requirements.

`glass_campaign_tastings` records at most one check-in per campaign contact,
restaurant and date. This is a submitted check-in, not proof of service. Separate
restaurants and dates produce separate visits. Nick's September 25 rule is once
per person, per restaurant, per eligible day, with return visits on later nights
welcome. The software deduplicates normalized, unverified email; it does not
prove personhood or prior physical service. A server may hand a glass to a tasting
guest who needs one after the restaurant check-in. There is no glass toggle or
additional pickup submission, and those handovers are not separately reported.
The universal pickup form remains for separate glass distribution. Pickup totals
count pickup-form submissions, not all glasses handed out. Its records
share contact preferences and append-only choice history with tastings. Request IDs bind to flow and intent,
so retries cannot overwrite a later preference or become a different activity.

The migration adds tasting identity to existing submissions and adds a kind guard
to the existing pickup RPC. Old pickup submissions retain their pickup identity.
The existing pickup regression suite runs after this migration. No membership,
ledger, arrival, billing or finance records are read or changed. Imports stay
inside DPC-WEB campaign helpers; there are no cross-module internal imports.

Responses contain only the current restaurant/date and a server-calculated
expiry. They never disclose previous participation, original check-in timestamps,
contact IDs or saved preferences. The page hides a confirmation at the next
Pacific midnight. Refreshes and connection failures preserve a still-valid
confirmation; only local expiry or a successful response reporting a changed date
or disabled tastings removes it. Relative monotonic and wall-clock deadlines also
check expiry on return from device sleep without relying on a correct device
calendar. No date override is shipped. Anonymous/member database access and
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
   out, repeat with a fresh request/browser, and exercise the universal pickup
   independently to confirm cross-flow preferences. A tasting guest receiving a
   glass from the server must make only the tasting submission. Verify durable counts and preserved preferences privately. After a
   quiet rate window, confirm the 31st rapid tasting submission gets 429 and the
   form retains its entries; confirm retry after 60 seconds. This also proves
   Vercel supplies the trusted network header. Do not run the burst in production.
6. Verify direct anon/member reads and RPC calls are denied. Restore the exact
   real clock definition even if a test fails, confirm real-date rejection again,
   and record any synthetic row IDs for exact, authorized cleanup. Leave existing
   staging pickup evidence and other records intact. Never print service secrets.

## Production and restaurant readiness

Review the campaign privacy disclosure before activation. The currently published
policy describes member Check-Ins with device location; it does not explicitly
describe non-member campaign email/restaurant/date records. A separate campaign
privacy draft is prepared for owner/counsel review, including retention and the
existing policy's notice/versioning process. This PR does not publish legal copy
or treat that review as complete.

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

Include the repeat-confirmation limitation in Nick's restaurant handoff: an
unverified email can reopen the same generic confirmation, so one stored
check-in is not proof that a tasting has not already been served. Keep the agreed
privacy-preserving response; do not expose an email's earlier visit to anyone
who types that address. Restaurant staff must understand and accept this
limitation when applying the one-tasting policy. The system does not verify
identity or prevent a guest from using another email.

To disable tastings safely, set `GLASS_TASTING_ENABLED=false` and redeploy through
the approved process. Preserve all campaign records; do not drop tables or undo
the additive migration. Pickup remains independently available. After October 14,
the tasting forms refuse submissions and point guests to continuing glass pickup.

## Nick's Part 1 copy and handoff alignment

Both forms show “By checking in, you confirm you're 21 or older.” immediately
above their submit button. This is an affirmation in the form copy, not a new
checkbox, collected age field, identity check or verification process. Marketing
remains prechecked and optional, with the existing privacy link and saved opt-out
semantics. This change does not approve or publish the separate privacy draft.

Staff should look for exactly “Enjoy your pour.” on a successful restaurant
check-in, with the restaurant and eligible date below it. On a known non-tasting
date the form is hidden and a friendly greeting names the next actual eligible
weekday and date. An unavailable service remains a distinct error. After
October 14 the ended state replaces the invitation and links to continuing
glass pickup. The existing confirmation expiry and offline continuity stay in
place.

Universal pickup confirms “Your glass is ready.” followed by “Bring it back on a
Tuesday or Wednesday for a complimentary taste of wine.” The existing schedule
shows all five dates before the event, then remaining dates, plus all four
restaurants. After October 14, the invitation is hidden and the ended message
remains; glass pickup still works while supplies last.

Nick reports that the pickup QR on his server card uses the unchanged production
pickup URL, was redrawn in navy, and scans clean. This is Nick's reported scan
evidence, not an independent scan by this task. It does not establish that all
four tasting QR cards and paper forms are ready, so the public preparation notice
remains. No new QR or print-kit file was generated.
