# Join content and plan tracking

This standalone website slice extends PR #65 with the Join-page event details
requested in the October 12 Website Conversion Blueprint v0.4 (G3). It starts
from main `7c04667`, after the homepage pricing links in PR #68, and is now
updated through `446866d`, including the email-preferences page (#67) and the
tracking-fixture beacon fix (#69).

| Event | Trigger | Parameters |
| --- | --- | --- |
| `ViewContent` | Join is ready, after link preselection | `content_name: membership`; `content_category: tap`, `cellar`, or `reserve` only when a Circle is selected |
| `JoinCheckoutClick` | Continue activation, including invalid forms | No parameters; existing custom event |
| `InitiateCheckout` | Checkout API returns a successful checkout URL | `content_name: circle_billing`, catalog `value`, `currency: USD` |

The blueprint describes InitiateCheckout at button activation. This slice keeps
the owner-reviewed PR #65 distinction: a click is intent, and InitiateCheckout
means checkout actually started. Invalid forms and rejected requests must not
inflate checkout starts. This difference from the blueprint is explicit and
should remain visible during review.

The checkout event uses the plan captured at submission, even if the visitor
changes the radios while a request is pending. Amounts come from a six-choice
catalog allowlist: Tap 59/590, Cellar 69/690, Reserve 79/790 (monthly/annual).
They exclude the optional kit, which is selected later in Stripe. They are not
evidence of a paid purchase. The retired founding flow sends no priced event.

## Privacy and delivery

- `meta-pixel.v4.js` replaces the loader reference on its three existing pages.
  Older immutable assets remain unchanged. Only `/join` gets new events or data.
- Personal form values, checkout URLs, flow IDs, tokens and arbitrary caller
  parameters never enter Meta event parameters. ViewContent always uses the
  fixed name `membership`; checkout prices and names are derived from allowed
  Circle and interval choices.
- Existing production-host, path, safe-referrer, query-scrubbing, GPC, opt-out,
  unavailable-storage and restored-page guards remain in place. Analytics
  consent and advertising opt-out retain their separate meanings.
- A slow SDK holds only one copied, sanitized selection per event. Delivery
  rechecks privacy, flushes in funnel order, and discards pending events after
  revocation or SDK failure. Events are once per loaded document.
- No analytics request delays checkout. Blockers and fast navigation can still
  lose browser events. First-party telemetry is unchanged.

## Verification

Run `npm test -- --runInBand` and the Join tracking/privacy Playwright files.
Browser fixtures intercept external requests; they create no membership or
charge and send nothing to Meta. Coverage includes all six preselected plans,
untouched legal consent, missing/invalid choices, no customer-data parameters,
request-time plan changes, rejected checkout, GPC and saved opt-out.

The optional captured real-SDK check also inspects the emitted `cd[...]` fields:

```sh
META_PIXEL_SDK_PATH=/path/to/fbevents.js \
META_PIXEL_CONFIG_PATH=/path/to/pixel-config.js \
node scripts/test-meta-pixel-sdk.mjs
```

The captured SDK is a compatibility check, not live Events Manager evidence.
After review and release, verify the approved parameters in Meta Test Events
through the established staging checkout flow. No production checkout is
needed during implementation.

## Remaining blueprint work

This slice does not complete the campaign launch gate. `/welcome`, verified
Purchase delivery, the Stripe return URL, attribution metadata and actual
iPhone/Android Instagram checkout evidence remain separate work. CAPI, the
Join proof strip, start-date copy, Honored at copy, saved funnels and the
homepage rebuild also remain. No legal text, production configuration,
campaign spending or database schema changes here.
