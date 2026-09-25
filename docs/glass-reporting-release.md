# Private campaign results and CSVs

`/admin/glass-comes-back` lets the DPC team view saved campaign participation
and download participation and current marketing-choice CSVs. It uses existing
DPC admin accounts. No new accounts, roles, guest steps or emails are created.

## Counts and downloads

- Pickup check-ins count the deduplicated universal pickup records. They do not
  count glasses handed out by a server during a tasting.
- Tasting check-ins count one stored visit per normalized email, restaurant and
  eligible date. Emails with multiple tastings have more than one stored visit,
  including visits to different restaurants on the same date.
- Distinct email addresses count campaign contacts, not verified people.
- Marketing contacts count currently opted-in contacts. A marketing download
  includes the exact recorded choice wording/version, basis, occurrence time
  and recording time. Saved opt-outs are excluded. Missing choice evidence
  makes the export unavailable; it is never invented or silently omitted.
- The matrix includes all four restaurants and all five eligible dates, with
  zero cells only after a successful query. Empty and unavailable states differ.

Participation CSV columns are `record_type`, `event_date`, `email`, `restaurant`,
`origin`, `recorded_at` and `record_id`. Pickup restaurant is blank, and its
original occurrence time determines its Pacific calendar date. A tasting uses
its original stored event date. Browser/paper source comes from the record;
paper entry is the separate Phase 5 slice and is not implemented here.

Marketing CSV columns are `email`, `marketing_opt_in`, `choice_basis`, `wording`,
`wording_version`, `choice_occurred_at` and `choice_recorded_at`. It has one row
per current opted-in email. This is campaign choice evidence, not permission to
erase a mailing provider's existing unsubscribes or suppression records. Manual
imports must preserve those downstream rules.

Each report is a read-only database snapshot. One scalar JSON response avoids
PostgREST's normal set-of-rows cap. CSV values are quoted, embedded quotes are
escaped, formula-leading values are neutralized, and UTF-8 BOM/CRLF support
spreadsheet use. The endpoint sends either the complete CSV or an explicit
error. Exports over 4,000,000 bytes fail before any file is sent; a larger export
requires an authorized complete-export procedure. Separate downloads can reflect
different snapshots when guests submit between them.

## Authorization and data boundaries

Every summary/download verifies the bearer token with Supabase Auth and checks
fresh server-owned `app_metadata.role` or `app_metadata.roles` for `admin`.
User-editable metadata, browser role claims and decoded JWT contents do not
authorize access. Anonymous, expired and non-admin requests never reach the
report RPC. The static sign-in shell is public; the data and exports are private.

The browser uses the existing `dpc_admin_session` credential pattern and can
operate in memory if storage is blocked. It does not persist reports or email
lists. Sign-out, expiration and denied access clear displayed results; stale
responses cannot restore them. Token refresh uses Supabase Auth. Tokens are
never placed in download URLs. Auth transitions move keyboard focus to the new
view; ordinary refreshes preserve focus. Returning from another tab or a save
dialog preserves the displayed snapshot. Use Refresh results for newer counts;
refreshing counts does not revoke a CSV already handed to the browser. Download
URLs retain their timed cleanup, and session invalidation releases them immediately.

`read_glass_campaign_report(text)` is STABLE, SECURITY INVOKER, with a fixed
search path and execute granted only to `service_role`. It reads campaign tables
only and makes no writes. Existing table RLS remains unchanged. No membership,
ledger, arrivals, billing or finance table is read or changed. Imports are within
DPC-WEB helpers; there are no cross-module internal imports.

API responses use `private, no-store`, `Vary: Authorization` and `nosniff`.
The page includes no analytics or third-party scripts. The endpoint does not log
tokens, email addresses, report bodies or upstream errors. Downloaded files must
stay with the DPC team under the campaign's approved handling rules.

## Configuration and migration

Server configuration uses `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
Browser Auth uses `ADMIN_SUPABASE_URL` / `ADMIN_SUPABASE_ANON_KEY`, falling back
to `SUPABASE_URL` / `SUPABASE_ANON_KEY`. The browser and server project must match;
secret/service keys are rejected from browser bootstrap. Preview binds only to
staging `hohbsqkmrlhkstojfdgx`; Production only to `ebiuspbgzggrdiaswpcc`.

Apply `db/20260925180724_glass_campaign_reporting.sql` once after the existing
pickup and tasting migrations. The migration adds one read-only function and
its restricted execute grant. It does not activate tastings. Production tasting
schema is a prerequisite that remains separately approved work; disabled guest
pages do not mean that prerequisite has been applied.

This slice makes no hosted migration, environment, policy or guest-data change.
Keep pickup available, `GLASS_TASTING_ENABLED` absent/false, and the public
preparation notice in place. Brandi's campaign privacy wording approval is
recorded; publication mechanics and operational retention/export handling are
tracked by the privacy workstream. Do not infer publication or activation from
that wording approval.

## Verification and release gates

Local application checks cover fresh admin authorization, role spoofing, wrong
environment, malformed/partial responses, current-choice evidence, CSV safety,
more than 1,000 rows, and explicit oversized-export failure. Disposable local
PostgreSQL checks prove known counts, deduplication, Pacific dates, complete
1,211-row export, role denial, read-only transactions and unchanged row counts.
No hosted database is used by these tests.

Browser checks use synthetic API fixtures on desktop Chromium, Android Chromium
and iPhone WebKit. They cover login, counts, both downloaded file contents,
empty/unavailable states, 401/403, refresh, sign-out races, blocked storage and
keyboard focus. They are not hosted Auth/PostgREST integration evidence.

The JavaScript repository has no TypeScript configuration. The required
`npx tsc --noEmit` prints help and exits 1; this is not reported as a pass.
Exact command outputs and screenshots are in the local review packet. Existing
RLS and function privileges are tested locally; no hosted advisor run is claimed
for this unapplied reporting migration.

Before releasing reporting:

1. Obtain approval to open this standalone Phase 4 PR, then user review and CI.
2. With explicit staging-change authorization, apply only the new reporting
   migration to the already migrated staging campaign. Bind that branch's
   Preview server and browser Auth settings to staging; leave guest flags alone.
3. Use an existing authorized staging admin to verify actual login, expected
   stored counts and both complete CSVs. Reconcile exports privately against the
   database. Verify anonymous/non-admin/expired denials and no public caching;
   keep credentials and guest records out of the evidence packet. Do not create
   broader rights or assume stubbed-browser checks meet this gate.
4. Complete the privacy workstream's publication/handling requirements before
   production export access. Do not ask for approval of the same wording again.
5. Obtain production migration/release authorization. Confirm both prerequisite
   migrations and the new reporting function, correct Auth project and Nick's
   existing admin sign-in. Verify actual counts/downloads privately with Nick;
   do not alter his roles or add synthetic production guest records.
6. Reconfirm pickup availability, disabled tasting check-ins and preparation
   notice. Reporting release does not establish restaurant physical readiness.

To stop reporting access, revert its website/API deployment through the approved
release process or remove only the report function's service-role execute grant.
Preserve campaign records and guest configuration. Never drop campaign tables as
a reporting rollback.
