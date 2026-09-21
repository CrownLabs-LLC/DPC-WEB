# Advertising privacy controls and disabled Meta readiness

The original controls slice added the public **Do Not Sell or Share My Personal
Information** footer link and `/privacy-choices`. The current preparation adds a
separately gated Meta loader and tests while keeping every production launch
switch off. It does not activate Meta or change legal versions.

## Behavior

- `assets/privacy-controls.v2.js` loads on public HTML pages before analytics.
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
`canLoadAdvertising()`. The latter requires the exact page launch switch plus
no saved/in-page opt-out and no GPC signal. `assets/meta-pixel.v1.js` is present
only on the three approved paths and enforces that decision again at SDK-load
and PageView boundaries. Every committed launch switch remains `false`, so
production behavior is still zero Meta requests. There is no noscript image.
The `dpc:privacy-change` event announces changes.

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

- `npm test -- --runInBand`: passed, including 14 privacy-control checks and
  8 Meta readiness checks.
- Focused browser privacy/Meta coverage: 33/33 passed across desktop Chromium,
  mobile Chromium and mobile WebKit. Width checks cover 320, 390 and 1280
  pixels. Every external service is blocked or locally fulfilled; enabled-path
  tests use an inert intercepted SDK response and transmit no visitor data.
- The full browser run passed 216/219. The three failures were the existing
  mobile-WebKit checkout-handoff test timing out at its five-second URL
  assertion. An untouched `main` comparison reproduced the same failure in the
  same test; this patch changes no checkout behavior. The focused privacy/Meta
  suite and every non-WebKit-handoff regression passed.
- `node --check assets/privacy-controls.v2.js` and
  `node --check assets/meta-pixel.v1.js`: passed.
- `git diff --check`: passed.
- TypeScript and DB tests: not applicable; this static website has no
  TypeScript project and the slice changes no API, database, or module imports.
- The automatic visual detector ran in degraded regex mode (parser modules
  unavailable). It reported no findings but did not check computed contrast.
  Focused desktop/mobile browser tests supplement it. This is not comprehensive
  accessibility certification.

The temporary `node_modules` dependency symlink is a local verification
artifact, not a source change to stage.

## Before activating Meta (separate approval/release)

The notice rollout completed September 18, 2026 at 3:25:44.302062 PM Pacific.
Brandi's September 21 amendment selected fourteen full days, so earliest
eligibility is October 2 at the same time. Eligibility is not activation.
Follow the complete checklist, event scope and rollback procedure in
`docs/meta-pixel-readiness.md`; obtain a separate go-live decision.

The site uses immutable caching for `/assets/*`. New controls use versioned
filenames; future asset changes must use new versions and update all HTML
references. Do not silently replace the contents of a previously deployed
immutable asset.
