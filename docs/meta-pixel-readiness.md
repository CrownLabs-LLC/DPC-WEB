# Meta Pixel readiness — production disabled

This release prepares Meta Pixel ID `28569583012647858` without activating it. Every committed page launch switch is `false`. With those switches off, no Meta SDK, beacon, pixel event, preconnect or noscript request is emitted.

## Approved scope

- Event allowlist: `PageView` only.
- Eligible paths: `/`, `/join`, and `/subscription-success`.
- `/subscription-success` remains PageView-only. This change does not add `Purchase`, `Subscribe`, `Lead`, `CompleteRegistration`, value, currency or any other conversion payload.
- No advanced matching, customer fields, hashed identifiers, Conversions API or App data.
- Depositor/token pages, Stripe Connect returns, cancellations, partner pages, support, privacy/legal pages, dashboard, admin and all Glass Comes Back pickup/tasting pages are excluded.
- Query strings and fragments are removed from eligible URLs before the SDK boundary. An unsafe or unparseable referrer fails closed. The SDK request itself uses `referrerPolicy = "no-referrer"`.
- Attribution tradeoff, requiring owner acknowledgment before activation: this removes `utm_*`, `gclid`, and `fbclid` too. GA4 can lose campaign/click attribution when it initializes after the scrub, and Meta cannot derive `_fbc` from that removed `fbclid`. Visitors blocked from advertising keep their URLs unchanged, so attribution coverage can differ by privacy choice. Retaining selected parameters is a separate privacy/scope decision; this PR does not retain them.
- Same-origin referrers outside the three eligible paths also fail closed. Arrivals such as `/partners` or `/support` to `/join` therefore do not send PageView; counts will understate those visits.
- Only HTTPS requests on `www.downtownpourcollective.com` or `downtownpourcollective.com` can pass. Preview and local hosts remain off even if their HTML switch is changed; enabled browser tests intercept the production hostname and SDK locally.
- There is no unconditional noscript image.

`assets/privacy-controls.v2.js` owns the browser privacy decision. It reads the exact page-level launch switch:

```html
<meta name="dpc-advertising-enabled" content="false">
```

Missing, unreadable or non-`true` values are off. `assets/meta-pixel.v1.js` additionally requires a production HTTPS hostname, an allowlisted path, a safe referrer and `DPCPrivacy.canLoadAdvertising() === true` before requesting Meta's SDK. The privacy decision also fails closed when neither first-party preference store can be read. The loader rechecks the same predicate when the asynchronous SDK finishes, immediately before PageView. Loader PageView is deduplicated per path. `fbq.disablePushState = true` suppresses SDK-generated history/hash navigation events. A privacy block also calls `fbq('consent', 'revoke')`, including while the SDK is loading; the document never grants SDK consent again. A persisted `pageshow` revokes before the SDK's independent back-forward-cache listener, so restored documents stay silent even for allowed visitors. A full navigation/reload creates a new document and reevaluates privacy.

## Consent model — do not misstate it

The approved model is advertising **opt-out**, not affirmative advertising opt-in. A saved or in-page `dpc_advertising_opt_out=1` choice and Global Privacy Control block the SDK and all events. The existing cookie banner's **Accept** action controls GA4 analytics consent only. Accepting analytics does not grant advertising permission, and failing to accept analytics does not by itself block Meta after a later activation. The choices page explains that the two controls are separate.

Changing Meta to require the analytics-cookie Accept action would be a product/privacy model change and requires explicit owner review plus corresponding copy and test changes. Do not make that change as an incidental activation edit.

## Verification included in this preparation

- Offline VM tests exercise the disabled state, enabled PageView path, exact ID/SDK URL, no advanced matching, allowlisted/excluded routes, URL/referrer sanitation, delayed-event opt-out race, event deduplication and forbidden-event rejection.
- Browser tests keep all external services blocked. The enabled fixture locally rewrites only the launch switch, intercepts Meta's SDK URL with an inert local response and verifies PageView queueing without transmitting visitor data.
- Browser paths cover homepage, join and subscription success, saved opt-out, GPC, analytics consent independence, query/fragment removal and the production-disabled zero-request state.
- GPC and saved-opt-out browser cases run in independent contexts; all four launch switches must agree, separately from the preparation release's false-value assertion.
- `scripts/test-meta-pixel-sdk.mjs` exercises a separately downloaded real SDK with a local config stub in Chromium and mobile WebKit. Every browser request is fulfilled locally or aborted. It checks history/hash changes, cross-tab opt-out, mid-session GPC, direct SDK calls after revocation and a synthetic persisted `pageshow`. It is a manual compatibility check, not an ordinary offline-suite dependency or proof of native browser cache eligibility.
- Run the SDK check with `META_PIXEL_SDK_PATH=/absolute/path/to/fbevents.js node scripts/test-meta-pixel-sdk.mjs`. Download the public SDK separately from `https://connect.facebook.net/en_US/fbevents.js`; the command prints its SHA256. `META_PIXEL_LOADER_PATH` optionally selects an older local loader for a negative control. Do not allow browser requests through to Meta.
- Existing checkout, legal-version, diagnostics, privacy-control and responsive/keyboard tests remain part of the full suites.

## Activation checklist — separate owner-approved release

**Pending Decision #56 amendment:** merged DPC `main` still requires thirty full days, making the current documented eligibility date **October 18, 2026 at 3:25:44.302062 PM Pacific** (`2026-10-18T22:25:44.302062Z`). Brandi's September 21 approval of fourteen days preserves Day 0 and yields October 2 at the same time, but that amendment must be reviewed and merged in its own DPC docs PR before this release relies on it. An uncommitted shared-worktree edit is not a merged specification. Neither date enables the switches automatically.

1. Read Decision #56 from merged DPC `main`; confirm the applicable notice period has elapsed, production policy is v4.9, and the September 18 Day 0 evidence remains intact. Record the merged amendment commit if using fourteen days. Never activate while the governance conflict is unresolved.
2. Confirm Meta Events Manager Pixel ID is exactly `28569583012647858`, Automatic Advanced Matching is OFF, and Track events automatically without code is OFF. These account settings cannot be proven from repository code. Brandi supplied the matching-settings screenshot and confirmed automatic events OFF on October 5; recheck if settings change.
3. Confirm the owner acknowledges the attribution and visit-count limits above and still intends the documented advertising opt-out model. If the requirement changes to affirmative opt-in, stop and revise the implementation/copy/tests first.
4. In one reviewed activation PR, change the launch-switch content from `false` to `true` only in `index.html`, `join.html`, `subscription-success.html`, and `privacy-choices.html`. Do not add the loader to excluded pages.
5. Run the full offline and Playwright suites. In preview, keep Meta requests intercepted or blocked; verify no real visitor/test data is sent to Meta.
6. After the separately approved Git merge deploys, verify production source, allowed/excluded paths, GPC, saved opt-out, cross-tab behavior, no duplicate PageView, sanitized URLs and no conversion events. Use a clean test browser profile and avoid personal query values.
7. Record the exact activation deployment and readback. Activation eligibility is not automatic authorization.

## Off switch and rollback

The primary off switch is the four reviewed HTML meta values. Set all four back to `false` in an emergency PR and merge through Git; this stops new SDK requests before any event boundary while preserving saved opt-outs. Verify homepage, join and subscription success make zero Meta requests and that `/privacy-choices` says tracking is off.

If the activation release contains another defect, use Vercel's Git-integrated rollback procedure to return to the last known-good deployment with all switches false. Do not edit `assets/privacy-controls.v2.js` or `assets/meta-pixel.v1.js` in place after they have been served: `/assets/*` is immutable for one year. Any future asset behavior change requires a new versioned filename and HTML references.

Meta's already-received requests cannot be recalled. Turning the switch off prevents subsequent page loads/events; it does not delete prior provider data. Provider-side deletion or account action, if ever required, is a separate operator/legal procedure.
