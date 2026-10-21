# Homepage rebuild preview

Local review only; created October 18 and updated October 20, 2026
(America/Los_Angeles). Based on website
`main` at `a4b4e0b`, including the merged `/app` download page. Branch:
`codex/homepage-rebuild`. No PR, remote preview, or production deployment has
been created. Brandi remains the review and merge gate.

## Scope and direction

Implements Brandi's October 19 community-first direction for the homepage and a
separate Events page, using the existing DPC navy, cream, gold, Playfair Display,
Barlow, and Barlow Condensed identity. This supersedes the initial twelve-section
homepage ordering while retaining Nick's verified inputs and product facts.
Brandi selected the **indoor toast** as the main hero in this chat. No stock or
generated people, quotations, endorsements, or app UI were invented.

The site remains static HTML, CSS, and JavaScript. `homepage.v1.css` and
`homepage.v1.js` are new, separately versioned assets. Existing immutable
privacy, Meta, analytics, welcome, and backend behavior is unchanged. Join now
shares the beverage icons; its pricing and submission behavior is unchanged.
All six pricing links and their accessible names are preserved. `#circles`
is the new pricing anchor; `#membership` remains a compatible anchor.
The mobile Join bar appears after the hero, yields to the consent notice,
and hides while the footer is visible. Native FAQ disclosures work without JS.

The private preview intentionally has a visible review notice and `noindex,
nofollow`. All three app-screenshot placeholders have been replaced with native
captures using sample data. The remaining launch work is tracked in the
[current website launch checklist](website-launch-checklist.md).
Press text links and confirmed community wording now replace the original
placeholders. Ribbon photo permissions and delivery remain pending; kickoff
website use and featured-person permission are confirmed by Nick. See
[the asset manifest](homepage-assets.md) for remaining credit terms and inputs.

## Source reconciliation

Inputs: Nick's October 11 v0.2 blueprint and October 12 v0.4 build specification;
the October 18 handoff; Nick's October 19 email reply; existing website content;
current native authoritative specifications. v0.4's retained v0.2 sections and
updated strings were reviewed.

| Topic | Preview decision |
| --- | --- |
| Five Pours | Decision #37 permits supply-short periods. The preview says “up to five”; the old website test forbidding that qualifier was reconciled explicitly. Join copy remains outside this slice. |
| Circles and venues | Show the beverage ladder with assigned-venue/app qualifications. Do not publish Nick's proposed “Honored at” lists until actual production eligibility is confirmed. |
| Birthday Pour | Decision #36: opt-in before the month, eligible Circle membership, member benefit. No guest transfer or unconditional sixth-Pour promise. |
| Multiple Circles | Supported by the product. Brandi requested removal of the multiple-Circle FAQ; it is absent from both visible copy and FAQ structured data. |
| Pause | Not currently available; no pause-by-email promise. |
| First Pours | Setup and venue assignments must be ready. No immediate-access or exact start/reset-date promise. |
| Maker's Table and events | No monthly Maker's Table promise; events remain separately coordinated. Use announcements for schedule and attendance details. |
| Coaster Passport | Physical benefit only. No member-app Passport interface promised. |
| Welcome Kit | Optional, $49 once, one per account, no renewal. Home does not add a tax or pickup claim. Join retains its existing “no added kit tax” wording; catalog evidence and coordinated activation requirements are in `docs/optional-welcome-kit-release.md`. Runtime agreement remains a release verification item, not an assumed production failure. |
| Community positioning | Brandi explicitly requested a club supporting its community, with Pours part of the experience. Lead with local people and independent businesses; replace the exclusion-focused fit section with a welcoming community story. No charitable donation or revenue-impact claim. |
| Press/community | Nick's exact Independent, Livermore Vine, and Spotify show URLs appear as text links; no press-logo rights implied. Confirmed affiliations are attributed to Nick personally. Mayor name and supplied caption are applied to the expandable review image; no City seal. |
| Bruno's | Nick confirmed there is no official logo and approved using the existing treatment. Text wordmark retained; artwork is no longer a missing input. |
| Navigation | `/events` now exists and is linked from the header, hero, story, benefits and footer. Unbuilt Story/Locations routes remain omitted. `/partners` retains venue recruitment via “Partner with us.” |

The five visible FAQ answers and JSON-LD are identical. Retired founding offers,
counts, urgency, and unverified perks are absent.

## Inputs needed before release

The [website launch checklist](website-launch-checklist.md) is the current
cross-page readiness record. Earlier dated verification entries below describe
their respective snapshots; they do not mark today's release gates complete.

1. Nick: clean ribbon files `21` and `33`, photographer/Chamber website-use
   permission, and any required credit wording. Supplied watermarks remain intact.
2. Nick: any required Ron Essex Photography credit wording, or confirmation
   that no specific credit is required. Kickoff website use and featured-person
   permission are already confirmed and are no longer missing.
3. Final copy approval and the technical/content items in the current checklist.
   Brandi accepted the full-logo app captures and beverage icons on October 20.
   Three native app-screen examples with sample data are in the preview;
   no real Pour was used.
   Mayor name/caption, community wording, and Bruno's text
   treatment are now confirmed. Circle-specific venue lists and pickup claims
   need verified details only if added; the current homepage omits them.

Optional follow-ups: a direct DPC podcast episode URL (Nick supplied the show)
and preferred community URLs (names currently appear as plain text). Neither
blocks the current fallback. Press logos and member quotes are not required.
The asset-specific resolved/open checklist is in
[the asset manifest](homepage-assets.md).

After those inputs: replace remaining review photos, remove the review notice
and noindex, and rerun checks against the final content before requesting PR
approval. Do not deploy the current preview as a finished homepage.

## Separate unfinished scope

CAPI Purchase, Join proof strip, verified period-start wording, Circle-specific
venue lists, saved PostHog funnels, full wallet/Instagram paid-return validation,
Other Phase 2 pages, video, and gifting are not completed by this visual slice.
The Events preview is now included; this does not mark the other Phase 2 work complete.
Homepage Meta pricing-section ViewContent is also not added here: v4 restricts
that event to Join, so widening it needs a separately tested tracking change.
The existing consented GA pricing-section label is preserved. No purchase,
audience upload, account setting, or webhook deployment occurred. At Brandi's
explicit request, the asset-request email was sent October 18; Nick replied
October 19. No reply was sent as part of this preview update.

## October 19 content update

Source: [Nick's reply at 2:01 PM Pacific](https://mail.google.com/mail/u/0/#all/1a155f86c95c7e10).
Adds the three supplied press links, founder-specific affiliations, corrected
Winegrowers Association name, and exact Mayor caption with named alt text.
Retains Bruno's approved text wordmark. Updates the preview notice and checklist
to distinguish confirmed kickoff permissions from pending ribbon permissions.
The Spotify link is explicitly a podcast/show link; no DPC episode is invented.
No checkout, privacy, analytics, image, or backend behavior changed.

## Verification

Evidence and remaining limitations are recorded in the completion note below.
No DB-backed paths or cross-module imports change, so database tests and native
module-boundary checks do not apply. The website has no TypeScript project;
`tsc --noEmit` prints compiler help and exits 1, as in earlier website slices.

### October 18 verification record

| Check | Result |
| --- | --- |
| `npm test -- --runInBand` | Passed, exit 0. Full offline website suite, including Meta and welcome guards. |
| `npx --no-install tsc --noEmit` | Not applicable: no TypeScript project/configuration; compiler help, exit 1. |
| `npm run test:db` | Not run: no database paths changed. |
| `git diff --check` | Passed. |
| Module boundaries | No backend/module changes or cross-module imports. |
| Browser matrix | Homepage, optional-kit/pricing navigation, privacy, Join tracking and welcome suites: **230 passed / 1 failed** initially. One unchanged Join WebKit fixture (`cellar monthly via form`) timed out. Its isolated repeat passed **3/3**; no Join implementation or timeout was changed. This initial flake is retained in the record. |
| Final homepage matrix | **12/12 passed** after the focus-contrast fix across desktop Chromium, mobile Chromium, and mobile WebKit. The keyboard-focus evidence capture then passed **4/4**, including actual Tab navigation and `:focus-visible` assertions; desktop and mobile screenshots regenerated. |
| Source/schema follow-up | Release-readiness static checks passed after retaining the original Organization/LocalBusiness/WebSite schema and matching all six visible FAQ answers. |
| Layout/accessibility checks | No overflow at 320, 390, 768, 1440px; visible images loaded; local anchors exist; keyboard FAQ open/close and no-JS use pass. Sticky Join yields to consent and footer. This is not a formal accessibility certification. |
| Performance | One local cold-cache mobile Chromium run, 390×844, 1.6 Mbps, 150ms latency, 4× CPU slowdown: LCP **1,208ms**, CLS **0.00235**. Third-party traffic was blocked; this is not production/field or Instagram evidence. |
| Design detector | Ran once in degraded regex mode (parser packages unavailable). 41 advisory findings against the narrow welcome-surface DESIGN.md: 32 type sizes, 7 colors, 2 radii. Computed contrast was not evaluated; independent finish review required. |
| Independent visual review | Final disposition: **ship**, for the local preview only. The one material finding—focus contrast on light surfaces—is resolved with navy outlines, verified in actual keyboard-focus screenshots on desktop and mobile. No material findings remain. Missing source assets and permissions still block publication. |

Full command outputs and screenshots remain local under the gitignored
`.impeccable/review/` (logs in `evidence/`). They must be refreshed against final
approved assets/copy before a production PR. The locked dependency installation
also reported existing audit advisories; dependencies were not upgraded in this
homepage slice.

### October 19 follow-up verification

- `npm test -- --runInBand`: passed, exit 0, full offline website suite.
- `npx playwright test tests/e2e/homepage.spec.mjs --workers=3`: **12/12 passed**
  across desktop Chromium, mobile Chromium, and mobile WebKit. Existing tests
  cover 320/390/768/1440px overflow, local navigation, images, consent/sticky Join,
  keyboard FAQ use, and no-JavaScript use. No new tests were added for this copy update.
- `git diff --check`: passed. Source diff against the start of this update is
  limited to the preview notice, press/community section, small text-link styles,
  and checklist records; prior homepage work is preserved.
- Local browser inspection at 1440×900 and 390×844 confirmed press-link wrapping,
  visible keyboard focus, the native Declaration disclosure, the complete
  watermarked portrait, and Nick's supplied caption. Screenshots:
  `.impeccable/review/oct19-desktop.jpg`, `oct19-mobile.jpg`,
  and `oct19-mayor-mobile.jpg`.
- Logs are saved in `.impeccable/review/evidence/oct19-offline.log` and
  `oct19-browser.log`. The October 18 independent review above remains its own
  dated record; this focused content update received local visual verification.
- Local server restarted for review at `http://localhost:4173/`. No PR, push,
  deployment, or outgoing email was made for this update.

## October 19 community direction and Events page

Brandi approved the community-first approach and asked to implement it. The
homepage now explains what DPC is in the first viewport and keeps the membership
mechanics visible: up to five Membership Pours, assigned venues, plan-dependent
beverage choices, and a starting monthly price. “Circle” and “Membership Pour”
are defined before the app instructions. The primary hero action goes to the
plans; a second action opens the separate Events page.

The homepage order is hero, community photo/story, partner roster, three app
steps, membership plans, Passport/Birthday benefits, press/community evidence,
optional kit, closing invitation/FAQ, footer. It has no event listings section.
Six checkout links, existing privacy controls, consent behavior and welcome
flow remain intact. Metadata and organization descriptions use the new positioning.

`events.html` and `assets/events.v1.css` add a standalone event journal:

- Upcoming: **The Social Pour, Wednesday November 18, 2026, 5–8 PM Pacific,
  Wood Family Vineyards; open to all DPC members.** Brandi supplied these details
  in this chat on October 19 and said there is no RSVP link. No RSVP requirement,
  guest admission, ticket price, free drink or street address is inferred.
- An Add to calendar link downloads `assets/events/social-pour-2026-11-18.ics`.
  The UTC values account for November Pacific standard time: Nov 19 at 01:00–04:00Z.
  This downloads a file; it does not sign anyone up or modify a connected calendar.
- Past: Sep 22 ribbon cutting at Swirl, with a note about the first Social Pour
  at Concannon that evening; Sep 15 kickoff at Demitri’s. Both dates and the
  Concannon context come from Nick's v0.2 blueprint timeline (lines 114 and 341
  of the local extracted source). Past events are newest first.
- Native photo disclosures reveal the Mayor declaration and kickoff gallery.
  Full ribbon watermarks remain intact. Kickoff captions name Ron Essex; final
  required credit wording still awaits Nick's confirmation.
- Event attendance is separate from membership entitlements. No schedule or
  frequency is invented for the three named gathering formats.
- The Events page uses existing privacy controls and ordinary page analytics.
  It adds no advertising opt-in marker or Meta loader; the existing route
  allowlist and advertising scope are unchanged.

Upcoming event facts are now supplied; they are **not** a missing input. Before
publishing, the photo/credit/app-capture inputs listed above and Brandi's final
copy review still apply. After the Social Pour, move it to the past archive and
replace the upcoming block with the next confirmed gathering or an honest empty
state. No automatic maintenance or notification job has been created.

### Community / Events verification

- `npm test -- --runInBand`: full offline suite passed, exit 0. The initial run
  correctly rejected an advertising loader inherited into Events; it was removed
  without widening the advertising allowlist, then the full suite passed.
- `npx playwright test tests/e2e/homepage.spec.mjs tests/e2e/events.spec.mjs tests/e2e/optional-welcome-kit.spec.mjs --workers=3`:
  **105/105 passed** across desktop Chromium, mobile Chromium and mobile WebKit.
  Includes membership checkout-link handoff, consent-aware sticky action,
  disclosures, cross-page navigation, image loading, 320/390/768/1440px overflow
  and no-JavaScript behavior. No live purchases were made.
- After Brandi supplied the November gathering, the Events suite was extended
  to verify the actual calendar download and Pacific-to-UTC timestamps.
  `npx playwright test tests/e2e/events.spec.mjs --workers=3`: **6/6 passed**.
- Final `node scripts/test-release-readiness.mjs` and
  `node scripts/test-privacy-controls.mjs`: passed after the event/calendar update.
- `git diff --check`: passed. TypeScript and database checks are not applicable
  to these static pages; no backend, schema or module boundary changes.
- Visual checks at 1440×900 and 390×844: community-first introduction, full-frame
  imagery, membership plans, real upcoming event, native photo stories and
  remaining-input notices. A clipped Passport capture initially preceded lazy
  image loading; the image was confirmed loaded and the evidence recaptured at
  both sizes. This was a capture issue, not a broken asset.
- Impeccable detector ran once for the changed scope in degraded regex mode
  because HTML parser modules are unavailable: 49 advisory type/color/radius
  findings, no computed contrast evaluation. No second detector pass.
- Independent finish review disposition: **ship for local preview**. No material
  preview defects remain. Final report `.impeccable/review/community-finish-review.md`.
  Outstanding real app captures and final photo/credit terms remain release inputs.

Evidence is in `.impeccable/review/`: `community-*.jpg`, `events-*.jpg`, and
`evidence/community-*.log` / `community-detector.json`. Local preview routes are
`http://localhost:4173/` and `http://localhost:4173/events`. No commit, PR, push,
production deployment, email or connected-calendar write was performed.

## October 19 mobile layout and header follow-up

Brandi requested mobile improvements and a cohesive header while preserving
the original logo and partner roster. Both pages now have a full-width navy
header, cream navigation/focus outlines, and a bounded inner row. At mobile
widths, navigation sits beside the original logo in two columns and includes
the membership button. The original SVGs and their 104px/88px sizing are intact.

The mobile homepage moves detailed Pour/price copy after the complete toast
photograph. At 390px, the header is 131px high (previously about 205px), and the
photo starts at about 620px (previously about 853px), including the preview
notice. Below 600px, how-to instructions span the content width, with screenshots
underneath; at 320px the text width increases from 140px to 272px. Standalone
header, app-download, declaration, contact, legal and privacy controls provide
at least 44px-high targets without changing inline prose links.

Verification: all 18 existing homepage/Events browser checks passed, along with
release-readiness and 16 privacy checks. Visual/DOM checks covered 320px, 390px,
768px, 844px landscape and 1440px layouts; no overflow was found. Header keyboard
focus is cream against navy. Exact-source comparisons confirmed both original
SVGs, the partner roster, the membership/pricing section, and all page text are
unchanged. The one detector pass remained limited to regex because parser
dependencies are unavailable; its six advisories are inside the approved logos.
No physical-device or 200% text-resize verification is claimed. The preview
server remains running; publication and missing-asset requirements are unchanged.

## October 19 membership clarity follow-up

Brandi prioritized membership clarity and explicitly retained the current
partner logo/name roster. The homepage pricing section now puts shared Circle
benefits, assigned-venue scope, Pour timing, and expiration rules before the plan
choices. Each annual option says it is prepaid for twelve months. Renewal copy
clarifies continued access through the paid monthly or annual term; the optional
Kit remains a separate one-time purchase.

The six plan/billing links and prices are unchanged. A comparison against the
pre-edit snapshot confirmed that all homepage HTML outside the pricing section
is unchanged, including the original logo and partner roster. Events HTML is
also unchanged. Added styling is scoped to the pricing overview.

Verification: release-readiness checks, 16 privacy checks, and all 18 existing
homepage/Events browser checks passed. The browser suite initially could not
launch within the sandbox; it passed outside the sandbox against the local
preview. Visual/DOM inspection at 1440, 768, 390 and 320 CSS pixels found no
horizontal overflow; all six join buttons remained at least 48px high in the
sampled narrow layouts. Existing preview release inputs remain outstanding.

## October 19 header logo correction

Restored the original stacked pour-glass logo on both homepage and Events
headers, replacing the favicon and typed-name substitute. The original SVG
interior was checked byte-for-byte against `HEAD:index.html`. Shared CSS changes
are limited to the logo wrapper and responsive sizing. Both HTML files were
compared with pre-correction copies to confirm everything outside the header
is unchanged. No content, navigation destinations or other page styling changed.

## October 19 compact navigation and section placement

Brandi requested a visible Explore membership action with the remaining header
links behind a kebab menu on its right, lighter Explore typography, and moving
the partner roster up one section. Both pages now use the compact menu at
860px and below. A native details/summary disclosure keeps navigation usable
without JavaScript; the small shared script adds Escape, outside-click and
focus-leave dismissal, closes on navigation, and resets across breakpoint
changes. Focus-leave uses focusin on the destination to avoid premature
closure when Safari taps a link without focusing it.

Explore membership and Explore DPC events now use regular-weight Barlow.
The Events closing membership invitation shares that treatment. Other action
styles are preserved. The homepage order is now hero, partners, community
story, then how it works. Exact-source comparisons confirmed both original
header SVGs, the complete partner section, and the pricing section are
unchanged. No business copy, prices or event facts were changed.

Verification: the 27 homepage, Events and header browser cases passed across
desktop Chromium, mobile Chromium and mobile WebKit (25 in the full final run,
with the remaining two passing in the targeted WebKit rerun after using its
Option+Tab link-navigation shortcut). The WebKit no-JavaScript case also passed
again. Menu checks include open/close, Escape, focus leaving, outside click,
menu-link navigation, breakpoint reset, and 320/390/760/860/861/1024/1440px
layouts. Release-readiness and all 16 privacy checks passed. No physical-device
verification is claimed. Source and screenshot evidence is in
`.impeccable/review/header-menu-*` and `.impeccable/review/evidence/header-menu-*`.

The single detector scan was degraded to regex (parser dependencies unavailable)
and returned design-system drift findings for the preserved original SVGs and
shared stylesheet against its narrower recorded scale. It did not evaluate
computed contrast. Those established styles and protected artwork were retained;
no detector-context repair was attempted as part of this refinement. Local
preview only; the outstanding release inputs remain as recorded above.

## October 19 Events button consistency

The lighter regular-weight Barlow style is now the shared primary-button style
for both public pages, including Upcoming gatherings and Add to calendar.
Explore past events and gallery disclosures use the same lighter text role.
Existing button sizes, colors, focus styles and destinations are preserved.
The existing 18 homepage/Events browser checks passed across desktop Chromium,
mobile Chromium and mobile WebKit; static release checks and diff checks passed.
App screenshots are the next work item, using Brandi's existing computer test
build. Capture requirements are recorded in `docs/homepage-assets.md`.

## October 20 FAQ removal and app screenshots

Removed “Can I belong to more than one Circle?” from both the visible FAQ and
its JSON-LD. Five matching entries remain. Existing keyboard coverage now
uses the unused-Pours question, and the static FAQ count was updated.

Replaced all three screenshot placeholders with native iPhone SE captures of
implemented Circle, Pours, and confirmation screens. The saved Expo project
had lost its temporary source; the restored local harness uses current locally
available main-branch components with synthetic reads. This is a UI example,
not staging redemption evidence. Source provenance and scope are recorded in
the asset manifest and `.impeccable/review/app-capture-metadata.json`.

Images are lazy-loaded, have intrinsic dimensions and descriptive alt text,
and open at original resolution. The section labels sample member and venue
data and explains that redemption requires the live app. Desktop image tops
align; mobile instructions sit above centered captures. Original website logos
and the partner roster were preserved.

Verification: 12 existing homepage browser checks passed across desktop
Chromium, mobile Chromium and mobile WebKit. Static release-readiness and
diff checks passed. Visual inspection covered the native PNGs, desktop
composition, phone sizing and the small-tablet breakpoint. Review images and
test logs are saved under `.impeccable/review/`.

## Full-logo captures and beverage icons, October 20

Recaptured all three native screens on iPhone 16 Pro Max at 1320 × 2868.
The unmodified Home screen now shows its full logo and membership card together.
The existing sample-data labels and full-resolution links remain in place.

Both homepage and Join Circle choices now share gold Lucide outline icons:
beer for Tap, beer and wine for Cellar, and beer, wine and cocktail for Reserve.
The icons supplement the existing eligibility text and are hidden from assistive
technology to avoid duplicate labels. The shared sprite and stylesheet keep both
views consistent; original logos and partner roster are unchanged.

Validation: 54 existing browser checks passed across desktop Chromium, mobile
Chromium and mobile WebKit, covering homepage behavior, Circle pricing links,
plan changes and narrow Join layouts. Release-readiness static checks and
`git diff --check` passed. Desktop and 390px mobile visual checks confirmed the
icons on both pages and the complete membership screenshot. Evidence is saved
as `beverage-icons-*.jpg` and refreshed `app-screens-*.jpg` in
`.impeccable/review/`.

## Clean ribbon photographs, October 20

Replaced the two watermarked assets with optimized versions of Nick's October
20 JPEG attachments. Home and Events now use the clean Declaration portrait;
Events uses the supplied outdoor ribbon-cutting group frame. Each placement
credits Meli Miller Photography. Watermarked-review captions were removed and
the general preview notices now refer to final launch review.

The design and full photo frames are preserved. The photo manifest records
the attachment mapping, photographer permission, original location and output
sizes; the launch checklist marks replacement complete and keeps the separate
Chamber confirmation item open. Nine focused Home/Events browser checks,
release-readiness and diff checks passed. Evidence is under
`.impeccable/review/ribbon-originals-2026-10-20/`.

## Social Pour attendance confirmation, October 20

Brandi confirmed that the November 18 gathering at Wood Family Vineyards is
free to attend for DPC members, guests and partners, with RSVP invitations
sent by email. The Events card and downloadable calendar now state those
details; no public RSVP link is requested. The launch checklist marks the
attendance item complete.

At Brandi's request, an email was sent to Nick asking for the separate Chamber
photo-use confirmation and Ron Essex's required credit wording. Those two
checklist items remain open pending his response; the sent-message link is
recorded in the checklist.

Verification: six existing Events browser checks passed across desktop
Chromium, mobile Chromium and mobile WebKit. Desktop and mobile inspection
confirmed the event copy and layout. Calendar checks confirmed correct UTC
times, escaped punctuation, CRLF endings and 75-octet line folding. Evidence
is under `.impeccable/review/social-pour-details-2026-10-20/`.

## Nick's photo confirmations and hosted Join check, October 20

Nick's 1:41 PM reply accepts “Photo: Ron Essex Photography.” His separate
forward records the Chamber's approval to post the ribbon-cutting photographs,
with the scope of that approval preserved in the asset manifest and checklist.
Both previously open photo-confirmation items are now complete.

Read-only hosted checks passed for production's current legal tuple, all six
displayed plan totals and the enabled optional-kit backend policy. The live
Join and latest existing PR #73 preview still serve the older page. This
rebuild has no PR/hosted preview, and the existing preview's legal endpoint
returns a configuration-related 503; retry leaves checkout disabled. The
candidate's Stripe handoff, kit add/remove and return-path verification remain
open until a reviewed preview is configured with an isolated staging backend.
No payment, membership, deployment or environment change was made.

Full results and the prior staging evidence reconciliation are in
`docs/hosted-join-verification-2026-10-20.md`; the canonical launch checklist now
distinguishes completed live checks from the remaining candidate checkout gate.
