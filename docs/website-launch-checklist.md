# Home, Events and Join launch checklist

Updated October 21, 2026 (America/Los_Angeles).

Scope: the `codex/homepage-rebuild` Home/Events/Join candidate, the October 20
read-only production baseline, and the completed staging checkout verification.
This is the current cross-page readiness record. It supersedes old open-item
lists that still request app screenshots, Bruno's logo or an upcoming event.
Historical deployment notes are evidence of prior work, not proof of today's
production configuration. The [staging preview](https://dpc-web-git-codex-homepage-rebuild-brandis-projects-65a11cb6.vercel.app)
is deployed through [draft PR #74](https://github.com/CrownLabs-LLC/DPC-WEB/pull/74).
Production remains unchanged. No payment has been submitted in this verification.

## October 21 release preparation

Brandi requested committing the approved website changes and publishing within
ten minutes. Home and Events preview notices and public-page noindex tags are
removed; the sitemap includes Home, Events and Join with October 21 dates.
Events now uses the same cache-versioned shared stylesheet as Home. Private
page noindex rules and all checkout routing/security settings are unchanged.
The newest CI failure was an ECR image-download limit, not a failing database
assertion; a new complete gate is required. Physical-device/accessibility
closeout remains unverified. Publication status below must be updated only
after deployment and production health verification.

## October 21 copy review

Brandi requested these refinements to the staging candidate: identify the roster
as businesses that have joined, with more coming soon; remove its redundant
Pour reminder; use “monthly venues,” “Choose your Circle” and “After joining”;
state beverage flexibility explicitly; give the timing note two readable
paragraphs; list the four included benefits on Home and Join; and link optional
Welcome Kit mentions to the Home kit section. The Join link opens a new tab to
preserve the in-progress form. Existing design, logo, partner roster and pricing
are retained. Social Pour invitations are an included benefit; the confirmed
Events attendance details still welcome members, guests and partners.

Brandi explicitly requested “5 Membership Pours” instead of “up to five.” This
preview follows that copy direction, including its search/FAQ consistency.
It does **not** change the app's issuance policy: Decision #37 still permits
fewer issued Pours under venue shortage. Correction after the October 21
backend review: Decision #58's no-auto-fill member-choice model is an
uncommitted, unmerged proposal, not a deployed exception. It must not be
presented as current production behavior.

Brandi has clarified the intended rule: members should always receive five.
A read-only production check found selection disabled for all three Circles,
with 10 assignable Tap venues, 10 Cellar venues and 7 Reserve venues. All 45
current issuance-eligible periods reviewed had exactly five issued Pours and
selection-disabled snapshots. This check excluded newly created periods less
than ten minutes old; it examined issued counts, not remaining unused Pours.
No current shortfall was found in that scope.

To make five an enforceable guarantee, formalize the paid-per-Circle monthly
promise, retain automatic five-Pour assignment, define the business fallback
when fewer than five distinct eligible venues exist, and implement safe
shortfall/replacement recovery with ledger/audit evidence and regression tests.
Optional swaps can preserve member choice without making issuance depend on
participation. Unpaid/past-due issuance restrictions remain a separate rule.
No backend policy, schema, credits, assignments or production settings were
changed in this read-only review.

Validation: `npm test` and `git diff --check` passed. The existing Home and
optional-kit browser suites passed **99/99 cases**, across desktop Chromium,
mobile Chromium and mobile WebKit, with two workers and no retries. Desktop
(1440px) and mobile (390px) visual checks confirmed the benefit lists; the
desktop timing note is two complete lines, and visible FAQ answers match their
structured data. The Home kit anchor resolves, and Join's kit link targets that
anchor in a separate tab. Header logo, partner roster and Join scripts are
byte-for-byte unchanged. No new payment or backend verification was needed for
this copy/layout-only change. Screenshots are saved locally under
`.impeccable/review/copy-2026-10-21/`.

The staging branch alias now serves the exact reviewed Home, Join and shared
stylesheet bytes (HTTP 200). Vercel Preview deployment
`dpl_2foqgJftXs5br4YEsuRmSjACA1UH` is READY at `56dccfe`; it was created from
the connected Git repository because this push did not trigger an automatic
deployment. No local source upload or production deployment was used. The hosted visual check
found the previous stylesheet cached in an already-open browser tab; a version
query on Home’s stylesheet refreshes the new list spacing and timing layout.

[CI run 39637865682](https://github.com/CrownLabs-LLC/DPC-WEB/actions/runs/39637865682)
passed `npm test` but stopped before database/browser tests: the ECR registry
rejected the disposable Postgres image download with
`toomanyrequests: Data limit exceeded`. This is an external download blocker,
not a failed database assertion against the app. A green full CI run remains
required before publication; the 99 local browser passes remain valid.

Impeccable's mechanical detector used its degraded regex parser and returned
68 advisory entries for existing font/color/radius values. It did not evaluate
computed contrast; this pass preserves the existing palette and typography.
The older surface brief/design sidecar contains historical drift, which was
observed but not rewritten during this narrow refinement.

## Fix or confirm before public release

| Status | Item | Owner | Done when |
| --- | --- | --- | --- |
| [x] | Correct Join contrast | Implementation | October 20: muted-gold control borders measure at least 4.32:1; cream keyboard-focus rings 13.56:1; selected annual price notes 5.68:1; copyright 7.07:1. Selected/unselected, hover, Circle/billing keyboard selection and text-field focus verified. |
| [x] | Reconcile Join's membership explanation and share descriptions | Implementation | October 20: compact recap defines the included eligible drink, up to five Pours per membership month, assigned venues and expiry/no rollover. Keyboard-accessible details contain redemption times and excluded selections, with a Home FAQ link. October 21 wording now follows Brandi’s requested five-Pour promise; the policy reconciliation below is still open. |
| [x] | Complete Social Pour attendance instructions | Brandi + Implementation | Brandi confirmed October 20: no cost to attend; members, guests and partners are welcome; RSVP invitations arrive by email. Events and the calendar download reflect this. No public RSVP URL is needed. |
| [x] | Replace ribbon photography and apply attribution | Implementation | October 20: Nick's two supplied originals were inspected, optimized and installed on Home and Events. The outdoor replacement is a different frame of the same ribbon-cutting scene. All three placements credit **Meli Miller Photography**; obsolete watermarked-review captions are removed. |
| [x] | Record separate Chamber confirmation | Nick | October 20: Nick forwarded Christy Malsack's October 19 reply approving posting the ribbon-cutting photographs. The Chamber says event photos may be made public; it does not individually confirm permission with attendees. Record this as the Chamber's approval, not individual signed releases. Photographer website permission is separately recorded. |
| [x] | Confirm kickoff attribution wording | Nick | October 20, 1:41 PM: Nick confirmed the proposed “Photo: Ron Essex Photography” wording is fine. Existing attribution is accepted; website use and photographed-person permission were already confirmed. |
| [ ] | Implement the confirmed five-Pour guarantee and shortage recovery | Brandi + product/app owner | Brandi confirmed that members should always receive five. Formalize the paid-per-Circle monthly rule, decide a supported fallback when five distinct eligible venues cannot be assigned, and implement ledgered shortfall/replacement recovery with tests and staging proof. Live Decision #37 permits shortage; Decision #58 is an unmerged future proposal. Read-only October 21 check found all 45 reviewed current eligible periods already had five issued. No backend rule has been changed. |
| [ ] | Resolve the reported member cancellation/eligibility confusion | Nick + app/support owner | Check the current member-facing cancellation route and give clear instructions; confirm the reported venue's eligible selections agree with the app and staff guidance. Join now explains venue-specific eligibility, but that does not resolve the reported operational problem. No membership was cancelled during this website task. |
| [x] | Verify current hosted Join terms, displayed prices and backend policy | Implementation | October 20: production legal endpoints return 200 and the current four-version tuple; fresh lookup is `no-store`. All six plan summaries show correct membership-only totals ($59/$590, $69/$690, $79/$790); consent stays unchecked. The production checkout source has checkout and optional-kit flags true; the report records the unchanged source bundle and provider version readbacks. These checks cover the existing live page, not the rebuilt release candidate or a new Stripe session. |
| [x] | Deploy the isolated staging candidate | Implementation | October 20: draft PR #74 and Git-integrated Preview are ready at implementation commit `9572762`. Home/Events/Join match the tested source. Dedicated staging checkout v1 has test-key, exact-Origin and synthetic-identity guards; readiness and rejection probes pass. Staging current legal tuple is `3.0 / 4.9 / 3.0 / 3.0`. Production main, Join source and checkout source bundle match the baseline; no production writes were made. |
| [x] | Finish hosted checkout verification of the rebuilt pages | Implementation | October 20: branch-only staging credentials configured; fresh legal lookup 200/no-store. All six real Stripe sandbox handoffs have correct membership-only totals. Monthly/annual one-time $49 kit add/remove and recurring amounts pass; browser Back/retry and Stripe cancel/Return to Join pass. Six unpaid test sessions, no completed checkout or Circle membership. Stale founding-reservation cancel copy removed. See the [hosted verification report](hosted-join-verification-2026-10-20.md). |
| [ ] | Complete physical-device and accessibility closeout | Release owner | Physical iPhone Safari and Android Chrome pass the Join handoff/return checks; keyboard focus, VoiceOver/form announcements and 200% text resizing are checked after the contrast correction. Include the in-app social browser if used for the launch campaign. Emulation is not physical-device evidence. |
| [ ] | Obtain a clean verification gate for this preview | Implementation | October 20 implementation: [CI run `39506731776`](https://github.com/CrownLabs-LLC/DPC-WEB/actions/runs/39506731776) on `a40d963` passed unit tests, all database suites and the full browser suite: **546 passed, nine optional screenshot captures skipped, no failures/flaky cases reported**. The WebKit resize test now waits for the actual desktop-close state; 90 repeated cases also passed without retries. Initial registry/timing failures are retained in the report. October 21: npm test and 99 targeted browser cases passed; full PR CI run 39637865682 is blocked by ECR’s Postgres image-download data limit before DB/browser execution. The earlier CI result remains historical checkout evidence. |
| [x] | Finish release metadata and remove preview treatment | Implementation + Brandi | October 21: approved Home/Events preview notices and public-page noindex tags removed. Sitemap now includes Home, Events and Join with current modification dates. Production canonicals and social URLs are correct in source. Events shares Home’s versioned stylesheet. Private-page noindex rules are preserved. Hosted production readback remains part of publication verification. |
| [ ] | Final review and controlled publication | Brandi + release owner | Brandi approves the final copy/assets and reviewed PR. Publish through the existing Git-integrated process; verify the deployed commit, routes, checkout health and rollback readiness using the current runbook. No local production upload. |

## Recommended improvements; not launch blockers

- [ ] Add a confirmed street address and a directions link to the Social Pour
  card and calendar location. This concerns event attendance, not partner-roster
  links; the logo-and-name roster remains unchanged.
- [ ] Make the selected billing interval's total the most prominent price near
  that decision. Join currently defaults to annual while Circle cards emphasize
  monthly prices; the downstream annual total is correct.
- [ ] Add a direct DPC podcast episode URL if Nick supplies it. The current
  Spotify show link is a valid fallback.
- [ ] Add preferred community-affiliation URLs if supplied. Existing text is
  sufficient; press logos, testimonials, video and extra venue descriptions
  are not required to launch these pages.

## Complete and accepted

- [x] Community-first Home introduction explaining what DPC is.
- [x] Separate Events page with upcoming and past gatherings.
- [x] Social Pour: November 18, 2026, Wood Family Vineyards, 5–8 PM Pacific,
  free to attend for DPC members, guests and partners; RSVP invitations by email.
- [x] Calendar download has the correct Pacific-to-UTC event times.
- [x] Original header logos retained; partner roster kept as logos and names.
- [x] Mobile header retains Explore membership beside a kebab menu.
- [x] Lighter Home/Events button treatment.
- [x] Membership rules beside Home pricing and matching five-question FAQ
  structured data; multiple-Circle question removed at Brandi's request.
- [x] Three actual native app-screen captures using sample data. Full logo and
  complete membership card visible; accepted by Brandi October 20.
- [x] Matching beverage icons on Home and Join: Tap beer; Cellar beer/wine;
  Reserve beer/wine/cocktail. Existing eligibility text remains.
- [x] Supplied press links, founder affiliation wording and Mayor caption applied.
- [x] Bruno's text treatment accepted; no replacement-logo request remains.
- [x] Kickoff website-use and featured-person permissions confirmed.
- [x] Join contrast and membership recap corrected within the existing design.
- [x] Requested ribbon originals received in Nick's October 20 forward;
  photographer website permission and attribution name received.
- [x] Clean ribbon originals installed on Home and Events with Meli Miller
  Photography credit at all three placements; full frames retained.
- [x] Chamber posting approval received; Ron Essex attribution wording accepted.
- [x] Git-integrated staging preview, current terms, six real sandbox handoffs,
  optional kit add/remove and checkout return/retry verified.
- [x] Retired founding-reservation wording removed from the checkout cancel page.

## Nick's October 20 updates

- [1:41 PM reply](https://mail.google.com/mail/u/0/#all/1a15b0c9640bc1de): Nick
  confirmed “Photo: Ron Essex Photography” is fine and that he forwarded the
  Chamber permission email. Both requested photo follow-ups are now complete.
- [Chamber forward](https://mail.google.com/mail/u/0/#all/1a15b0c1424c6cbe):
  Christy Malsack, Director of Member Services, approved posting the event photos
  in her October 19 reply. She says the Chamber does not confirm individually
  with attendees, but understands event photos may be made public. This is the
  recorded scope of the Chamber confirmation; no signed attendee releases are
  claimed.
- [Follow-up sent to Nick](https://mail.google.com/mail/u/0/#all/1a15b0afcba763e8)
  at Brandi's request is now answered. Brandi separately confirmed the Social
  Pour attendance details, which are complete.
- [11:50 AM photo forward](https://mail.google.com/mail/u/0/#all/1a15aa6a948fa7e5):
  Meli agreed to Nick's explicit website-use request for ribbon files 21 and
  33 and requested credit to Meli Miller Photography. Both attached JPEGs have
  now been inspected and installed as optimized WebP images. The outdoor
  image is the supplied replacement frame of the ribbon-cutting group.
  This email does not supply the separate Chamber confirmation or Ron Essex
  credit wording.
- [11:12 AM membership forward](https://mail.google.com/mail/u/0/#all/1a15a83d8c2dbb12):
  member feedback identifies difficulty finding cancellation and confusion
  about a venue's eligible wine selection. The launch follow-up above records
  those concerns without publishing the member's personal details.

## Evidence and limits

The final UI/UX review and test disposition are recorded in
[website-final-review-2026-10-20.md](website-final-review-2026-10-20.md).
Screenshots and raw technical evidence are under
`.impeccable/review/final-2026-10-20/`.
The subsequent Join corrections and verification are recorded in
[join-accessibility-clarity-2026-10-20.md](join-accessibility-clarity-2026-10-20.md).
Ribbon replacement provenance, screenshots and focused browser-check results
are under `.impeccable/review/ribbon-originals-2026-10-20/`.
Hosted Join checks, environment identity, prior release evidence and the
staging deployment, completed sandbox verification and final CI results are recorded in
[hosted-join-verification-2026-10-20.md](hosted-join-verification-2026-10-20.md).
Sanitized HTTP results, the six-plan matrix and browser captures are under
`.impeccable/review/hosted-join-2026-10-20/`.

The local static server does not implement `/api/legal-versions`; its Join
terms-loading failure is expected in this environment. It does not prove a
production outage. The browser suite mocks legal/security/checkout providers,
and no real personal data or payment is submitted.
Separately, today's real production legal endpoint passed. The older hosted
preview's 503 is an observed configuration failure, not the expected local
static-server limitation. The rebuilt candidate now passes its real hosted sandbox handoff/navigation
gate with branch-specific staging variables. No payment was completed; this
does not replace physical-device or controlled-publication checks. The October 20 full CI result is historical evidence. October 21 local validation
is recorded above; the latest PR revision must have a green required CI check
before publication.

The native app captures are real implemented screen components with synthetic
data. They are complete as marketing examples, not evidence of a successful
production redemption or of every published app build.

Supporting records:

- [Photo/input manifest](homepage-assets.md)
- [Homepage implementation history](homepage-rebuild.md)
- [Operational runbook](../DEPLOY.md), especially checkout/device and legal-version gates
- [Optional-kit catalog and coordinated release record](optional-welcome-kit-release.md)
