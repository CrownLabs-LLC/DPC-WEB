# Verified welcome return

This website slice adds `/welcome`, a read-only Stripe verifier, and a browser
Purchase event. It stands alone: existing Checkout Sessions still return to
`/subscription-success`. Do not change the billing return URL until this page
has merged, deployed and passed the checks below.

## Response and payment contract

`POST /api/welcome-checkout` accepts only `{ "sessionId": "cs_live_…" }` (or a
test ID outside production). The session is a bearer reference, never an
authentication or fulfillment credential. Requests require a same-origin JSON
POST. Responses and both page routes are non-cacheable.

The existing server-only `STRIPE_SECRET_KEY` must have **Checkout Sessions read
and Invoices read**, including expanded session line items. A restricted key is
supported. Production requires a live key/session; previews require a test key
and cannot send a production Purchase. The request pins Stripe `2024-06-20`
for the existing Node SDK's invoice shape, with zero network retries and a
five-second request timeout. No Stripe updates or database operations occur.

`WELCOME_EVENT_ID_SECRET` is a separate server-only secret, required in production
and preview. Missing or blank values return 503 before contacting Stripe; there
is no fallback to another credential. Generate at least 32 random bytes, store
the resulting string in Vercel, and use different production/preview values.
Keep each value stable across deployments.

Verification requires subscription mode, the correct live/test mode, DPC member
and checkout-intent metadata, matching client reference, an allowlisted recurring
price matching Circle/interval/offer, complete line items with known additional
prices, completed Checkout and paid payment status. The expanded initial invoice
must be paid and belong to the same subscription. Unknown products, missing
expansions, wrong currency or malformed responses fail closed.

The amount is the initial invoice's `amount_paid` in cents, converted to dollars
only at the Meta boundary. It includes paid kit/tax amounts and reflects invoice
adjustments; it is not reconstructed from the six marketing prices or the
Checkout total before customer-balance adjustments. See Stripe's
[invoice amount fields](https://docs.stripe.com/api/invoices/object) and
[invoice schema change](https://docs.stripe.com/changelog/basil/2025-03-31/adds-new-parent-field-to-invoicing-objects).

The catalog comes from DPC billing at `087532cc7d08f4eb09e4c966a34bf3f64b8b746e`.
Update the verifier when billing adds/replaces a price. Prices are used to
identify the purchase, never to calculate its reported value.

Only status, Circle, billing interval, amount paid, currency, kit inclusion,
live/test mode and an opaque `eventId` leave the verifier. For a paid summary,
`eventId = base64url(HMAC-SHA256(WELCOME_EVENT_ID_SECRET, session.id))`: key and
message are UTF-8 strings, and the 32-byte digest uses unpadded base64url (43
characters). It returns no raw Checkout Session ID, names, email, customer IDs,
member IDs, invoice/subscription IDs or metadata. Errors are generic and do not
log the request or Stripe payload.

## Browser contract

The page removes the entire query and fragment before advertising loads.
`Referrer-Policy: no-referrer` protects initial resource requests, and local fonts
avoid third-party font requests. The session reference travels to the verifier
only in the POST body. The current history entry retains it for Reload/Back;
a fresh bare `/welcome` visit never reuses a previous purchase. The page contains
no GA4, first-party analytics beacon or checkout form.

Meta v5 is used only on `/welcome`; existing pages keep their immutable v4 asset.
It preserves production-host, path, referrer, URL-scrubbing, opt-out, GPC and SDK
revocation gates. Purchase additionally requires the validated paid response,
USD, an allowed Circle/interval, integer cents, live mode and a 43-character
base64url `eventId`; raw Stripe ID prefixes are rejected. Only `content_name`,
`value`, `currency` and the opaque `eventId` as Meta's `eventID` are sent. The
pixel no longer accepts `sessionId` as its identifier. No advanced matching or
member fields are added.

`sessionStorage['dpc_purchase:' + eventId]` is written immediately before SDK
dispatch, after privacy is rechecked. Queued, revoked and failed-SDK events do
not consume it. Unavailable storage suppresses Purchase. This guard prevents
repeat dispatch in the same tab across Reload/Back; it is not a durable global
deduplication ledger or a delivery acknowledgment. New tabs, cleared storage,
ad blockers, leaving early and network failure remain browser-event limits.
CAPI is a separate future slice. It must recompute the same HMAC on the server
from the Checkout Session ID and the same environment's `WELCOME_EVENT_ID_SECRET`
for browser/server deduplication. Never send the raw session ID to Meta. Secret
rotation changes event IDs and must be coordinated with any CAPI sender and
outstanding checkout returns.

Success does not fulfill membership, send an email or issue Pours. Those remain
backend webhook responsibilities. No-payment-required/unpaid sessions show a
pending state; invalid links and provider failures show help/retry guidance.

## Release sequence and remaining inputs

1. Review and merge this website PR; verify its Vercel deployment.
2. Before directing checkout traffic here, configure `WELCOME_EVENT_ID_SECRET`
   in Vercel for production and preview using separate strong random values,
   then redeploy to load them. Confirm restricted-key read permissions with a
   test checkout in preview. Configure a Vercel WAF rate
   limit for `POST /api/welcome-checkout` (20 requests/minute/IP). The included
   bounded per-instance limiter is only a secondary guard, not a distributed
   rate limit. It uses Vercel's trusted `x-vercel-forwarded-for` header.
3. In a separate independently reviewed DPC billing slice, change the constant
   in `src/modules/billing/internal/circleCheckoutRuntime.ts` to
   `https://www.downtownpourcollective.com/welcome?session_id={CHECKOUT_SESSION_ID}`.
   Keep the existing cancellation URL. Verify and deploy that backend change
   only after step 1. Existing open sessions retain their original return URL.
4. Nick tests actual Instagram checkout on iPhone/Android and checks Meta Test
   Events before Campaign 3 launches. This implementation used isolated fixtures;
   it has not asserted live SDK delivery or charged a card.

Public App Store/Google Play URLs and the current Tuesday venue list are not
provided. The page retains setup-email guidance and an Instagram link, rather
than inventing links/dates. It says Pours appear after setup and venue assignments
are ready. Kit pickup guidance appears only for an actual kit line item. No
Introduction, upsell, membership count or redemption-ready claim is added.

G4 wallet settings/attribution metadata, CAPI and the full campaign launch test
are outside this website slice.

## Verification

`npm test` includes offline verifier and pixel tests. The real Stripe SDK is
mocked at `node:https`; the test asserts GET-only retrieval and exact expansions.
HMAC tests cover known outputs, stable/different sessions, separate keys and
missing-secret 503s. Pixel and browser tests assert that raw `cs_live_`/`cs_test_`
values never reach `fbq` arguments or sessionStorage keys.
Browser tests in `tests/e2e/welcome.spec.mjs` cover paid/pending/error/invalid
states, real Reload/Back, per-history-entry sessions, retry, GPC, opt-out,
unavailable storage, delayed SDK revocation, test mode and 320–1280px layout.
The fixture intercepts every request and also uses a dead loopback proxy, so a
missed route cannot send fake purchases to production.
