# Advertising privacy controls — controls-only release

This slice adds the public **Do Not Sell or Share My Personal Information**
footer link and `/privacy-choices`. It does not install or activate Meta,
publish amended policy text, change checkout legal versions, or deploy anything.

## Behavior

- `assets/privacy-controls.v1.js` loads on public HTML pages before analytics.
- Manual opt-out saves `dpc_advertising_opt_out=1` in first-party cookie and
  local storage. Either copy is sufficient. The cookie has a one-year maximum
  lifetime, `Path=/`, `SameSite=Lax`, and `Secure` on HTTPS. Production www/apex
  share the cookie; previews and localhost use a host-only cookie.
- GPC (`navigator.globalPrivacyControl === true`) automatically saves an
  opt-out. Removing the signal later does not erase the saved preference.
  See the [GPC specification](https://www.w3.org/TR/gpc/).
- Storage failures are caught. When neither store retains the choice, the
  current page stays opted out and the UI explains that future visits could
  not be saved. The visitor can retry or use GPC.
- Other tabs pick up local-storage changes. Focus and page restoration
  recheck preferences and GPC. Choices are browser/device-specific, not tied
  to a member account. Clearing all site storage can reset the saved choice.
- Public footers reserve the measured height and bottom inset of the existing
  fixed cookie notice, so visitors can reach privacy choices without accepting
  analytics. Observers keep clearance correct when the notice wraps or hides.
- Existing GA4 consent and anonymous operations telemetry are unchanged.
  Analytics acceptance is not advertising consent. The choices page itself
  loads no analytics, external fonts, or other third-party resources.
- The choices page mirrors counsel's 4.8 exclusion: precise location, Check-In
  records, Membership Pour redemption data and all other App-collected data
  are outside website advertising sharing.
- With JavaScript unavailable, the static link still works and the page gives
  a clear fallback and privacy contact. No advertising request is possible.

`window.DPCPrivacy` exposes `getState()`, `optOut()`, and
`canLoadAdvertising()`. The latter is hard-disabled with
`ADVERTISING_ENABLED = false`. There is deliberately no advertising loader,
Meta SDK, tracking call, preconnect, or noscript image. Toggling the constant
alone does **not** install a pixel. A future integration must enforce the
privacy decision at every load and event boundary, and fail closed when the
controls are unavailable. The `dpc:privacy-change` event announces changes.

## Scoped interface decisions

- This is an extension of DPC's existing legal surface, not a new visual
  identity: navy, gold, and paper colors retain the incumbent presentation.
- Browser status and the opt-out action precede storage explanations and
  contact details. A polite live status region announces changes; the saved
  action stays focusable with an explicit disabled state and visible focus
  styling. Text explains GPC and unsaved preferences without relying on color.
- The reading column is bounded, links wrap, and the action fills the narrow
  mobile column. Static footer links remain available without JavaScript.
- System body type and a local Georgia heading stack avoid external font
  requests on the choices page. No animation or external assets are added to
  this page; the control remains a small, direct browser-level task.
- These decisions apply only to this controls release. They do not establish
  a global design system or revise policy content or legal versions.

## Verification

- `npm test -- --runInBand`: existing offline suites plus 13 privacy-control
  checks; passed.
- Browser regression coverage: 86 tests across mobile Chromium and WebKit,
  including 16 privacy test runs. Width checks cover 320, 390, and 1280 pixels.
  New tests block external services. The initial 78-test suite passed; after
  adding footer-clearance tests, all 16 privacy runs passed but two existing
  legal-checkbox tests failed in a four-worker run and passed in isolation.
  The current-main reconciliation rerun, `npm run test:e2e -- --workers=2`,
  passed all 86 tests. No checkout logic or legal-version fixture was changed
  for this controls slice.
- `node --check assets/privacy-controls.v1.js`: passed.
- `git diff --check`: passed.
- TypeScript and DB tests: not applicable; this static website has no
  TypeScript project and the slice changes no API, database, or module imports.
- The automatic visual detector ran in degraded regex mode (parser modules
  unavailable). It reported no findings but did not check computed contrast.
  Desktop/mobile browser inspection and independent finish review supplement it.
- Independent Impeccable finish review: PASS for the scoped UI. The mobile
  image is usable; desktop composition is visible and corroborated by DOM
  dimensions, but screenshot scaling/padding artifacts limit pixel-accurate
  visual evidence. This is not comprehensive accessibility certification.

Local screenshots under `.impeccable/review/` and the temporary `node_modules`
dependency symlink are verification artifacts, not source changes to stage.

## Before activating Meta (separate approval/release)

1. Counsel's 4.8 response supplies the amended advertising text. Confirm its
   effective date, who receives the Section 15 advance notice, how that notice
   is delivered, and the earliest date advertising may start. Preserve the
   existing published text/version until that rollout is authorized.
2. Coordinate website policy publication and checkout's legal-version tuple.
3. Confirm Meta Automatic Advanced Matching is OFF in Events Manager; do not
   infer its account setting from website code. Reconfirm counsel's commercial
   assumptions with the owner.
4. Implement a separately reviewed, restricted marketing-page integration for
   the supplied pixel ID `28569583012647858`. Exclude token-bearing return and
   depositor pages, admin/support and all member App activity. Decide event
   scope explicitly; do not add purchase attribution as an incidental change.
5. Test GPC and saved opt-out before any SDK request, including repeat visits,
   blocked storage, unavailable controls, and privacy changes in another tab.
   Never add an unconditional noscript pixel.
6. Avoid transmitting query strings, fragments, emails, identifiers, App data,
   or location/redemption data. Verify real outgoing payloads before approval.
7. Update the choices-page copy that currently says advertising is off, and
   rerun tests against the actual proposed integration.
8. Obtain owner review and deployment approval. No PR, commit, push, merge, or
   production configuration change is included in this local implementation.

The site uses immutable caching for `/assets/*`. New controls use versioned
filenames; future asset changes must use new versions and update all HTML
references. Do not silently replace the contents of a previously deployed
immutable asset.
