# Pour reminder preference page: Slice 1c

This is the DPC-WEB implementation/release record for `/email-preferences`.
The canonical feature plan and product decisions remain in
[DPC's monthly reminder plan](https://github.com/CrownLabs-LLC/DPC/blob/main/plans/monthly-pour-reminder-emails.md).
It is not a separate feature plan or deployment authorization.

## Source and scope

This branch starts at DPC-WEB main `57e78ef2b1aeece63c4e9366424134d8a668a604`.
The prerequisite [DPC #441](https://github.com/CrownLabs-LLC/DPC/pull/441) and
[DPC #443](https://github.com/CrownLabs-LLC/DPC/pull/443) are merged. #443 was
reviewed at `a896beb2c31205044306ff51da6e8e86e33c148d` and merged as
`2274994ae2f863f4c4b2521fe2286bc5f487a07e` on October 13, 2026.

The static page uses existing DPC typefaces and colors, self-hosted fonts, and
native radio controls. Members review on/off/unknown state, choose a preference
and explicitly save it across all Circles. Unknown is not preselected. Loading,
expired/invalid links, stale changes, network failure, missing configuration and
disabled JavaScript have neutral recovery text. Essential-email copy remains
visible. No sign-in or account identity is exposed.

Only DPC's membership API owns verification and database changes. This repository
has no preference database, Supabase client, signing keys, service credential or
proxy for capability-bearing requests. No cross-module implementation imports
are added. No reminder sender, enrollment, cron or provider call is introduced.

## Public configuration and independent gates

`GET /api/email-preferences-config` returns `{ enabled: false }` unless all
configuration exactly matches. Non-GET requests receive 405. Responses are
no-store, no-referrer and noindex, and never include secrets.

| Setting | Required behavior |
| --- | --- |
| `POUR_REMINDER_PAGE_ENABLED` | Exact `true` only; missing, false or malformed values leave the page unavailable. Independent of sender and backend flags. |
| `POUR_REMINDER_API_URL` | Exact environment-specific HTTPS endpoint below. No fallback to generic Supabase environment variables. |
| `VERCEL_ENV=preview` or `development` | Only `https://hohbsqkmrlhkstojfdgx.supabase.co/functions/v1/pour-reminder-preferences` is accepted. |
| `VERCEL_ENV=production` | Only `https://ebiuspbgzggrdiaswpcc.supabase.co/functions/v1/pour-reminder-preferences` is accepted. |
| Missing or unrecognized `VERCEL_ENV` | Unavailable. Custom environments require a reviewed explicit mapping. |

The initial HTML contains no active preference form. A disabled page reads only
its public configuration; it never calls the membership API. Configuration
failure also leaves the form hidden. The project refs are existing DPC-WEB
bindings, confirmed read-only against the Supabase project inventory on October
13. Vercel configuration remains unchanged; the approved staging API setup and
its test results are recorded below.

Backend `POUR_REMINDER_PREFERENCES_ENABLED` separately gates capability issuance
and re-enable. Its approved continuity exception permits minimal read/disable
with already-issued valid links after that flag is turned off. It never treats
an unverified token as authority. Keep the browser page, exact allowed origin
and old verification keys available after first live mail, even when sending
stops. Do not use the page flag as the sender kill switch. Keys must survive
90 days after their last issuance.

## Browser/API contract

The link format is `/email-preferences#token=r1.…`. The inline bootstrap takes
only a syntactically bounded opaque fragment, removes query/fragment from the
current history entry before resources load, and holds the capability only in
its closure. A second fragment-only navigation repeats this process and fences
responses from the previous link. Reload requires reopening the email link;
there is deliberately no persistent token storage.

`POST /functions/v1/pour-reminder-preferences` sends JSON:

- Read: `{ token, action: "read" }`.
- Explicit save: `{ token, action: "enable" | "disable", requestId, version }`.
  `requestId` is a fresh UUID for that user action; `version` is the integer
  from the last read (mandatory on backend enable).
- Successful response: `{ state: "enabled" | "disabled" | "unknown", version }`.
- 400/403: neutral invalid/unavailable-link text without echoing any response.
- 409: hide controls and require a fresh read before another explicit choice.
- Network/timeout/other failure: no automatic write retry and no success claim;
  offer a read to discover the committed outcome before another user action.

Requests omit cookies, use no-store/no-referrer, refuse redirects, send only the
content-type header, and time out after ten seconds including JSON decoding.
GET and passive visits never change preference. CORS allows only explicitly
approved HTTPS origins in backend `POUR_REMINDER_ALLOWED_ORIGINS`; no wildcard
preview access. CORS does not replace capability authentication. The backend
function uses `verify_jwt=false` because it verifies its own capability.

## Privacy and hosting verification

Both `/email-preferences` and `/email-preferences.html` have no-store,
no-referrer, noindex/nofollow/noarchive, nosniff and a restrictive CSP. Only the
exact hashed inline bootstrap may execute. Forms cannot navigate, framing is
blocked, and network access is restricted to same-origin configuration/resources
and the two exact preference endpoints. Inline-script changes require updating
both CSP hashes; `scripts/test-email-preferences.mjs` fails on drift.

There are no analytics, pixels, error-reporting scripts, external fonts,
capability storage, or application logging. The static advertising opt-out link
is retained without the site's advertising/privacy loader. This intentional
exception is tested explicitly without weakening tests on other pages.

The normal fragment never goes into HTTP URLs or Referer headers. The browser
tests inspect requests, storage, DOM and console using synthetic tokens only.
Self-hosted font requests may refer to their stylesheet, which contains no token.
A manually malformed URL carrying a token in its query is rejected as an
authorization source, but its initial query can already reach platform logs;
never create such links or promise that client scrubbing can undo that exposure.

Before release, inspect actual Vercel/Supabase logging configuration and record
available query/body redaction. Never enable request-body logging. Do not save
real capabilities in screenshots, browser traces, HAR files, shell history,
issue comments or the PR. Any Vercel preview toolbar/injected scripts must be
disabled or proven blocked by this page's CSP. Platform access-log behavior is
a hosted verification gate, not a claim established by these local tests.

## Staging execution: October 13, 2026

Brandi explicitly approved opening this PR and the staging-only deployment/test
steps below. [DPC-WEB #67](https://github.com/CrownLabs-LLC/DPC-WEB/pull/67) is open
at implementation revision `96d74851694b892b670fbfd689fd6d14c2eda500`.
Its [GitHub browser gate](https://github.com/CrownLabs-LLC/DPC-WEB/actions/runs/38468984297)
passed, and Vercel created the
[Git-integrated preview](https://dpc-web-git-codex-pour-reminde-966a8e-brandis-projects-65a11cb6.vercel.app/email-preferences).
No merge or production activation is authorized by that approval.

Only `dpc-staging` (`hohbsqkmrlhkstojfdgx`) was changed:

- Preflight confirmed the migration's existing member, membership, period,
  audit, digest and updated-at dependencies. Applied the exact reviewed DPC
  `2274994ae2f863f4c4b2521fe2286bc5f487a07e` Slice 1a migration, whose source name
  is `20261011211055_pour_reminder_preferences.sql`. The hosted migration tool
  recorded it as **`20261013211825` / `pour_reminder_preferences`**. Preserve this
  mapping for later deployment reconciliation; do not blindly replay it.
  SQL SHA-256: `eda012d08c80d0a9daec202681fbb1040bf557261bead469727d5b7d911ec66a`.
- Deployed only `pour-reminder-preferences`, version 1, with its five exact
  source files from that DPC revision. Deployment ID:
  `348fc63e-f138-4d93-b0b1-52430deb3bd0`; bundle SHA-256:
  `786f07c340a1f287b68b0c356a9c4e65e21cac31d364e681f6ded23004207f8a`.
  `verify_jwt=false` retains the reviewed AES-GCM capability authentication.
- Added a fresh staging-only capability keyring and the single exact preview
  origin above. No reminder-prefixed secrets existed before this setup.
  The API activation flag was tested missing, false, then true, and returned
  to **false** afterward. No sender, enrollment, provider-event or scheduler
  activation was added. Other existing secrets were preserved.
- Created one clearly labeled inactive synthetic member at `example.com`,
  without an auth identity or Circle memberships. Capabilities were generated
  privately with the exact reviewed codec for this fixture only. Fixture IDs,
  tokens and signing material remain outside Git, PR text and screenshots.

Actual HTTPS checks against the deployed endpoint passed:

| Check | Hosted result |
| --- | --- |
| Exact-origin preflight / other origin | 200 with exact CORS origin / 403 without allow-origin. |
| Scanner GET | 405, no preference change. |
| Invalid and expired capabilities | 400 `invalid_link`, no preference change. |
| Initial read | Only `{ state: "unknown", version: 0 }`; no enrollment on read. |
| API flag missing or false | Enable 503; valid-link read and explicit disable still succeed. Reviewed issuer also rejects `apiEnabled=false`. |
| API flag true | Explicit enable/disable/re-enable succeed with monotonic versions. |
| Stale enable | 409 `preference_changed`; current opt-out survives. |
| Old enable request replay after opt-out | 200 returning the current disabled state; no new enable/audit. |
| Final fixture state | Inactive member, disabled preference at version 5, six expected preference audit rows. |
| Side effects | Zero fixture Circle memberships, periods, credits, ledger entries, redemption attempts, onboarding deliveries, reminder deliveries, reminder notifications and provider events. |
| Privilege boundary | Preference RPC executable by service role only; anonymous and authenticated execute are false. Support evidence rejects a caller without trusted admin identity. |
| Current web preview | Public config returns `{ enabled: false }` with no-store. Browser shows unavailable text and no preference controls. |

Hosted advisors confirm RLS on all five new tables. The new notices are four
intentional service-only deny-all tables with
[no member policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy),
and the intentionally authenticated
[admin-guarded support RPC](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).
The deployed privilege and forbidden-caller checks above confirm that boundary;
pre-existing staging notices were unchanged and not edited in this slice.

For the function-specific 21:18–21:22:30 UTC test window, inspection found 31
edge-access and 34 function-runtime log records. Their logged attributes had
zero capability strings, request-body fields or query-bearing request URLs.
Access logs do retain ordinary URL, request metadata, IP and inferred location
fields. This sampled attribute inspection is not a claim of platform-wide body
or query redaction; no body logging was enabled. The browser capability belongs
in the fragment and API POST body only. Vercel logging/settings inspection
remains pending authenticated dashboard access.

**Open hosted gate:** the saved Vercel CLI token is invalid, and the in-app
browser requires sign-in. No Vercel environment setting was changed. The user
was asked to sign in while independent staging work continued. Branch-scoped
Preview configuration, actual browser-to-staging read/write proof, explicit
false web flag proof, desktop/mobile screenshots of those live states and
Vercel logging/injection checks remain pending. This PR is not yet a completed
Slice 1c release gate. Keep the synthetic member disabled and the API flag false
until continuing that proof. Retain the staging keyring for the issued test
links' 90-day lifetime; no member mail has been sent.

## Authorized staging steps and remaining production gates

Read-only inspection on October 13 found that `dpc-staging`
(`hohbsqkmrlhkstojfdgx`) has neither `member_reminder_preferences` nor a deployed
`pour-reminder-preferences` Edge Function. Browser mocks cannot satisfy the
shared plan's real staging proof requirement.

The following staging steps were explicitly approved; completed parts and
remaining work are distinguished in the execution record above:

1. Opening this DPC-WEB PR and obtaining its Git-integrated Vercel preview.
2. A staging-only preference deployment from reviewed DPC `2274994`: preflight
   schema dependencies, apply only the missing reviewed Slice 1a migration
   `20261011211055_pour_reminder_preferences.sql`, and deploy
   `pour-reminder-preferences` with its reviewed shared dependencies. Do not
   blanket-push unrelated migrations or deploy the sender.
3. Configure a staging-only capability keyring, exact approved preview origin
   and preference activation; create a clearly labeled synthetic staging member
   fixture without issuing Pours or triggering mail. Configure only the Preview
   web page flag and staging endpoint. No production setting is changed.
4. On the exact preview SHA/origin, prove CORS preflight, actual read/disable/
   re-enable, stale-enable refusal, invalid/expired links, unavailable backend,
   missing/false page flags, missing/false API flag behavior and the valid-link
   read/disable continuity exception. Inspect only the fixture preference and
   audit evidence; confirm no ledger, credit, billing or mail side effects.
5. Record preview URL, reviewed web SHA, deployed DPC revision, actual flag
   states, safe results and device/browser screenshots in this record and link
   the PR/revisions back to the canonical DPC plan. Never commit fixture tokens
   or signing keys. Restore staging test configuration and account for fixtures.

Only after staging proof and independent review may Brandi separately authorize
the DPC-WEB merge **as an inert production deployment**. Merge to main triggers
Vercel production through Git integration; no direct local deployment is used.
Verify the exact production SHA and unavailable state after merge. Production
page/API activation and any member sending remain Slice 2 gates.

## Local verification

October 13, 2026, on this standalone branch:

| Gate | Result |
| --- | --- |
| `npm test` | Passed, 394 reported checks, including six new config/privacy checks. |
| `npm run test:db` | Passed all three disposable PostgreSQL suites; test containers removed. |
| `npm run test:e2e -- --workers=2` | Passed 402 tests, including all 45 reminder browser cases; nine existing opt-in campaign screenshot tests skipped. |
| JavaScript syntax | Node checked the inline bootstrap, config handler, offline tests and browser tests successfully. No TypeScript project exists here. |
| Whitespace/module boundary | `git diff --check` passed; no cross-module internal imports or direct database access. |
| Visual/accessibility implementation QA | Desktop/mobile screenshots reviewed against the existing utility-page design; no material visual findings. Source contrast and keyboard/native control semantics checked. No independent PR approval is implied. |

The design detector produced no findings in degraded regex mode; its parser and
computed-contrast checks were unavailable. The separate visual/source pass
verified the palette contrast; full assistive-technology and hosted verification
remain distinct from the local browser evidence. Initial browser runs exposed
fragment-only navigation handling and test-fixture assumptions; corrected before
the final complete gate above.

Run `npm test`, `npm run test:db`, `npm run test:e2e -- --workers=2`, and
`git diff --check` on this standalone branch. DPC-WEB is JavaScript without a
TypeScript project; use Node syntax checks for the new handler and test modules
instead of claiming a TypeScript gate. Browser tests execute the page with its
real CSP on desktop Chromium, mobile Chromium and mobile WebKit. Their API
responses and opaque tokens are synthetic; they do not establish hosted CORS,
key, database, log-redaction or deployment evidence.

Read-only documentation checks used the
[Supabase browser/CORS contract](https://supabase.com/docs/guides/functions/cors)
and [Vercel environment variables](https://vercel.com/docs/environment-variables/system-environment-variables).
No SDK or platform upgrade was needed for this plain HTTPS integration.
