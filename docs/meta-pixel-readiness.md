# Meta Pixel readiness — production disabled

This release prepares Meta Pixel ID `28569583012647858` without activating it. Every committed page launch switch is `false`. With those switches off, no Meta SDK, beacon, pixel event, preconnect or noscript request is emitted.

## Approved scope

- Event allowlist: `PageView` only.
- Eligible paths: `/`, `/join`, and `/subscription-success`.
- `/subscription-success` remains PageView-only. This change does not add `Purchase`, `Subscribe`, `Lead`, `CompleteRegistration`, value, currency or any other conversion payload.
- No advanced matching, customer fields, hashed identifiers, Conversions API or App data.
- Depositor/token pages, Stripe Connect returns, cancellations, partner pages, support, privacy/legal pages, dashboard and admin are excluded.
- Query strings and fragments are removed from eligible URLs before the SDK boundary. An unsafe or unparseable referrer fails closed. The SDK request itself uses `referrerPolicy = "no-referrer"`.
- Only HTTPS requests on `www.downtownpourcollective.com` or `downtownpourcollective.com` can pass. Preview and local hosts remain off even if their HTML switch is changed; enabled browser tests intercept the production hostname and SDK locally.
- There is no unconditional noscript image.

`assets/privacy-controls.v2.js` owns the browser privacy decision. It reads the exact page-level launch switch:

```html
<meta name="dpc-advertising-enabled" content="false">
```

Missing, unreadable or non-`true` values are off. `assets/meta-pixel.v1.js` additionally requires a production HTTPS hostname, an allowlisted path, a safe referrer and `DPCPrivacy.canLoadAdvertising() === true` before requesting Meta's SDK. The privacy decision also fails closed when neither first-party preference store can be read. The loader rechecks the same predicate when the asynchronous SDK finishes, immediately before PageView. PageView is deduplicated per path.

## Consent model — do not misstate it

The approved model is advertising **opt-out**, not affirmative advertising opt-in. A saved or in-page `dpc_advertising_opt_out=1` choice and Global Privacy Control block the SDK and all events. The existing cookie banner's **Accept** action controls GA4 analytics consent only. Accepting analytics does not grant advertising permission, and failing to accept analytics does not by itself block Meta after a later activation. The choices page explains that the two controls are separate.

Changing Meta to require the analytics-cookie Accept action would be a product/privacy model change and requires explicit owner review plus corresponding copy and test changes. Do not make that change as an incidental activation edit.

## Verification included in this preparation

- Offline VM tests exercise the disabled state, enabled PageView path, exact ID/SDK URL, no advanced matching, allowlisted/excluded routes, URL/referrer sanitation, delayed-event opt-out race, event deduplication and forbidden-event rejection.
- Browser tests keep all external services blocked. The enabled fixture locally rewrites only the launch switch, intercepts Meta's SDK URL with an inert local response and verifies PageView queueing without transmitting visitor data.
- Browser paths cover homepage, join and subscription success, saved opt-out, GPC, analytics consent independence, query/fragment removal and the production-disabled zero-request state.
- Existing checkout, legal-version, diagnostics, privacy-control and responsive/keyboard tests remain part of the full suites.

## Activation checklist — separate owner-approved release

Do not perform these steps before **October 2, 2026 at 3:25:44.302062 PM Pacific** (`2026-10-02T22:25:44.302062Z`), and never without a separate go-live decision.

1. Confirm the production policy is v4.9, the September 18 notice evidence remains intact and the fourteen full days have elapsed.
2. Confirm Meta Events Manager Pixel ID is exactly `28569583012647858` and Automatic Advanced Matching is OFF. This account setting cannot be proven from repository code.
3. Confirm the owner still intends the documented advertising opt-out model. If the requirement changes to affirmative opt-in, stop and revise the implementation/copy/tests first.
4. In one reviewed activation PR, change the launch-switch content from `false` to `true` only in `index.html`, `join.html`, `subscription-success.html`, and `privacy-choices.html`. Do not add the loader to excluded pages.
5. Run the full offline and Playwright suites. In preview, keep Meta requests intercepted or blocked; verify no real visitor/test data is sent to Meta.
6. After the separately approved Git merge deploys, verify production source, allowed/excluded paths, GPC, saved opt-out, cross-tab behavior, no duplicate PageView, sanitized URLs and no conversion events. Use a clean test browser profile and avoid personal query values.
7. Record the exact activation deployment and readback. Activation eligibility is not automatic authorization.

## Off switch and rollback

The primary off switch is the four reviewed HTML meta values. Set all four back to `false` in an emergency PR and merge through Git; this stops new SDK requests before any event boundary while preserving saved opt-outs. Verify homepage, join and subscription success make zero Meta requests and that `/privacy-choices` says tracking is off.

If the activation release contains another defect, use Vercel's Git-integrated rollback procedure to return to the last known-good deployment with all switches false. Do not edit `assets/privacy-controls.v2.js` or `assets/meta-pixel.v1.js` in place after they have been served: `/assets/*` is immutable for one year. Any future asset behavior change requires a new versioned filename and HTML references.

Meta's already-received requests cannot be recalled. Turning the switch off prevents subsequent page loads/events; it does not delete prior provider data. Provider-side deletion or account action, if ever required, is a separate operator/legal procedure.
