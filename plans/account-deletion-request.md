# Account deletion request — smallest release

Brandi approved November 6, 2026: a Profile action and dedicated verified web
request form, with manual fulfillment preserving required ledger/payment records.
Offer deletion now or at paid-period end; stop future renewals in both cases.
Production deployment, activation and store submission remain held.

The outcome is a member who can submit an authenticated deletion request and
receive confirmation of billing cancellation and completed deletion. Request
receipt is not completion. No automated purge system or new billing engine is
included. Existing Supabase Auth and the support queue provide identity and intake.

The website form uses an email OTP for an existing Auth account (`create_user:
false`), including inactive members. It does not use the app's active-member-only
email-code gate. Identity is revalidated by the server using Auth `/user`; client
member IDs/emails are rejected. The server records a high-priority `app_account`
ticket assigned to Brandi. Auth-only accounts can submit with a null member ID.
Canonical JSON preserves timing, verified email, Auth ID and explicit renewal-stop
consent. A stable request UUID makes retry idempotent; conflicting reuse is refused.
No OTP/session token is stored, logged, put in a URL or sent to analytics.

The page is an Operate surface extending the existing navy/cream/gold invitation
page. It uses the same type, spacing and button system, native form controls,
explicit choices, readable retention details and accessible status/error states.
No redesign or product-marketing interview is needed for this approved extension.

## Acceptance and release gates

- Profile link reachable on a loaded profile and profile-load failure; no session
  or identity in the URL. Browser failure has a useful recovery message.
- Existing-account email verification, optional timing with no preselection,
  explicit confirmation, duplicate retry, unknown receipt and expired auth states.
- Support queue receives the exact verified identity/choice; no billing/data
  mutation happens merely by viewing or verifying the form.
- Operator walkthrough of the fulfillment procedure, using synthetic staging
  accounts, including both timings and multiple Circles. Required before activation.
- Reconcile the privacy request link; final app builds and exact device walkthrough.
- Website environment `DPC_ACCOUNT_DELETION_ENABLED=true` only in the separately
  authorized target, with existing SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY.
  Preview must point to staging. No production merge/deploy or flag change now.

Estimate: approximately one working session for intake/UI/review; fulfillment
qualification and replacement builds depend on staging/device access. No promise
of tomorrow's submission until those gates and the existing cutover gates pass.

## Manual fulfillment — Brandi's queue

1. Review each high-priority Account deletion request promptly. Verify the canonical
   description against its authenticated identity and ticket. Treat free-form
   support tickets as unverified until separately verified. Preserve the receipt.
   Do not wait until the 45-day privacy response limit to stop an upcoming renewal.
2. Retrieve every membership and its Stripe subscription. Confirm current provider
   state, paid-through boundaries and any shared/source billing relationship.
   Stop future renewals for all of this member's subscriptions first, preserving
   a paid interval for `paid_period_end`. For `now`, use the existing supported
   cancellation route after confirming the requested loss of remaining access.
   Do not cancel another member's subscription or invent prorations/refunds.
   Confirm Stripe readback plus signed-webhook reconciliation; capture evidence
   privately. An unknown provider outcome requires reconciliation, not blind retry.
3. Email the member the billing confirmation and deletion date. For multiple
   Circles, scheduled account deletion waits until the latest remaining paid-access
   boundary; each subscription's renewals stop now. Annual paid-through dates are
   not the current monthly Pour period end. If no paid access remains, process now.
   Track the future date in the existing operations queue; do not close the ticket.
4. At the chosen time, reconcile linked memberships, unused entitlements and pending
   provider work through their existing owner operations. Preserve the other
   member's paid access and adopted-calendar/renewal evidence. Never directly
   delete credit, ledger, payment, redemption or financial-statement rows.
5. Inventory identity and personal data in Auth, the member profile, storage,
   support, analytics/error providers and email systems. Delete or anonymize
   unneeded personal data; retain only the documented legal/financial exceptions
   and applicable holds. Document each retained category, reason and expiry. The
   ordinary 24-month cancellation retention is not a blanket exception to an
   explicit deletion request. Consult the current privacy retention schedule.
6. **Do not click Delete user in Supabase first.** `members.auth_user_id` has an
   ON DELETE CASCADE foreign key. Use a reviewed transaction to terminate access,
   detach `auth_user_id`, replace unnecessary identifying profile fields with
   non-identifying values, revoke outstanding claims and write an audit record.
   Preserve member UUIDs needed by required ledger/payment records. Verify foreign
   key effects before deleting Auth. Revoke sessions; existing JWTs must no longer
   resolve to a member after detachment. Then remove the Auth identity and any
   unneeded Storage objects with its ownership. No ad-hoc cascade or mass deletion.
7. Confirm sign-in/access is no longer usable, renewals are stopped, retained
   records remain intact and scheduled/linked work cannot recreate the deleted
   identity. Send a completion notice stating deletion date and retained exceptions.
   Resolve the ticket only after this evidence is recorded. The intake endpoint
   does not perform or certify these steps.

The exact anonymization transaction and provider deletion checklist still require
synthetic fulfillment qualification before this flow is production-ready. This
runbook explicitly avoids presenting a request button as a completed deletion.

## Independent fulfillment review — concrete qualification cases

The request intake is reviewed; the following operator steps are **not yet
qualified**, so neither the form nor a replacement app is release-ready.

- A subscription already marked `cancelled` locally can still have future paid
  access. `handleSubscriptionDeleted` returns `already_terminal` for that state.
  For delete-now, read back every Circle's `access_ends_at`; if needed use the
  existing audited `apply_circle_membership_patch` operation to terminate it at
  the verified cancellation time. That operation invokes the ledger owner's
  forfeiture operation atomically. A Stripe webhook receipt alone is insufficient.
  Do not write `credits`, counters or ledger rows directly.
- Preserve the member UUID but use `account_status='terminated'`, not `inactive`.
  Checkout activation permits inactive → active. Detach `auth_user_id`, replace
  the email with a unique normalized non-identifying address, clear unnecessary
  profile fields, expire unclaimed claim tokens and append the operator audit in
  the reviewed transaction. Legacy token binding checks email but not terminal
  account status; changing only the status or Auth link is insufficient.
- Before that transaction, drain targeted open Checkout intents, in-flight
  finalization/webhooks and onboarding deliveries. Deliveries may retain encrypted
  names, emails and claim URLs; expiring tokens does not retract an already leased
  send. Reconcile leased/ambiguous delivery outcomes before claiming completion.
- Ending access records linked eligibility loss. Complete the existing service
  workflow `reconcile_pour_partner_lifecycle(1, cursor)` until the affected
  generation is ended and participants released. A deferred result is unfinished.
  The member-only `unlink_pour_partner` is not an operator substitute after Auth
  detachment. Preserve the surviving member's billing and retained paid calendar.
- Keep period → membership → credit/member lock ordering. Do not lock the member
  first and then invoke financial operations. The profile transaction follows
  reconciled owner operations; it does not implement new financial mutations.

Synthetic operator walkthrough must cover: now; end-of-paid-period; multiple
Circles with different paid boundaries; scheduled-cancel → delete-now; stale claim
reuse; delayed Checkout/webhook/onboarding delivery; and deletion of one linked
partner. Verify durable financial rows, denial of old JWT/member access, no future
renewals, and no resurrection of the old identity. This is an execution gate,
not a new product decision and not permission to use real member records.

## Provider checklist references

Use Stripe Dashboard's subscription cancellation action for each verified owned
subscription and choose the requested timing. Review any subscription schedule,
pending invoice items and final-invoice/refund options before confirmation. Do not
create a refund or final charge merely to fulfill deletion. Read the result back:
period-end cancellation can be represented by `cancel_at`, not only
`cancel_at_period_end`, depending on billing mode. These are existing provider
controls, not a new automatic billing integration.

Sources checked November 6, 2026:
[Stripe cancellation](https://docs.stripe.com/billing/subscriptions/cancel) and
[billing-mode differences](https://docs.stripe.com/billing/subscriptions/billing-mode/compare).

After operational reconciliation, inventory Stripe personal data for redaction
without erasing required financial evidence. Stripe's
[deletion-request guidance](https://docs.stripe.com/privacy/deletion-requests)
distinguishes redaction from object deletion and retains legally required data;
issued invoices are not covered by its Redaction API. Do not use Customer deletion
as a shortcut for scheduling account deletion or blanket-delete payment records.
Record the required exceptions and completion outcome in the restricted ticket.

## Verification recorded for the intake slice

- Full website `npm test` passed, including 19 synthetic API cases; no live emails,
  billing actions or member mutations occurred.
- Twelve browser cases passed across desktop Chromium, mobile Chromium and mobile
  WebKit: both choices, lost receipt/expired auth with stable retry, wrong-identity
  refusal, no browser token persistence and no horizontal overflow.
- Mobile and desktop form renders inspected. Existing site typography retained;
  the design detector's Arial warning is the incumbent system, not a new font.
- Preview config refuses any project other than DPC staging; production config
  refuses any project other than DPC production. Privileged keys are never returned
  as browser configuration. The enable flag defaults off.
- Hosted email delivery, real support-queue readback, operator fulfillment and
  replacement device builds remain unverified. Local transport mocks do not prove
  these release gates. No production deployment, activation or submission occurred.
