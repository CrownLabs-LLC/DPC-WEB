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

Refreshed October 5, 2026 against current main `f8bc310` on the readiness
branch, with all four launch switches still false:

- `npm test -- --runInBand`: passed, including 16 privacy-control checks,
  12 Meta readiness checks, and the current campaign suites.
- Full browser suite: 336 passed, 9 capture-only skips, no retries across
  desktop Chromium, mobile Chromium and mobile WebKit. Every external service
  in the privacy/Meta tests is blocked or locally fulfilled; enabled-path tests
  use an inert intercepted SDK response and transmit no visitor data.
- Campaign pickup, landing and restaurant pages use the same versioned privacy
  controls but have no Meta loader or advertising-enabled switch. Static and
  loader tests explicitly exclude these routes.
- `node --check assets/privacy-controls.v2.js` and
  `node --check assets/meta-pixel.v1.js`: passed.
- `git diff f8bc310 --check`: passed with no output.
- `npx tsc --noEmit`: not applicable; actual exit 1/compiler help because this
  JavaScript website has no TypeScript configuration.
- Database tests: not required locally; no API or DB path differs from main.
  The repository CI still runs its existing disposable PostgreSQL suites.
- Module boundaries: no cross-module imports or DPC internal imports added.
- Real-SDK compatibility: six intercepted Chromium/mobile-WebKit scenarios pass
  for navigation, cross-tab opt-out, GPC and simulated persisted `pageshow`.
  SDK SHA256: `89a2a82574d35ba44820a985fff208cb50bbe810307f7ee069f97fd391c9a131`.
  The original loader at `4e4d169` fails the same check with three extra PageViews
  exposing fragments/query strings. No browser request reaches Meta.
  This manual SDK check supplements the inert fixtures; it is not part of `npm test`.
- The automatic visual detector ran in degraded regex mode (parser modules
  unavailable). It reported no findings but did not check computed contrast.
  Focused desktop/mobile browser tests supplement it. This is not comprehensive
  accessibility certification.

The temporary `node_modules` dependency symlink is a local verification
artifact, not a source change to stage.

## Before activating Meta (separate approval/release)

The notice rollout completed September 18, 2026 at 3:25:44.302062 PM Pacific.
Merged DPC Decision #56 still requires thirty full days: October 18 at the
same time. Brandi's September 21 fourteen-day amendment would make eligibility
October 2, but it must land in a separate DPC docs PR before activation relies
on it. Preserve Day 0; neither date is automatic activation. See the readiness
checklist for the governance gate and the attribution tradeoff requiring owner
acknowledgment.
Follow the complete checklist, event scope and rollback procedure in
`docs/meta-pixel-readiness.md`; obtain a separate go-live decision.

The site uses immutable caching for `/assets/*`. New controls use versioned
filenames; future asset changes must use new versions and update all HTML
references. Do not silently replace the contents of a previously deployed
immutable asset.
