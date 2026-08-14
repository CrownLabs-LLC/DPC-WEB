# DPC-WEB launch checklist

A single, ordered runbook to get the site live. Do these in order — every step
has acceptance criteria you can verify before moving on.

---

## 1. Resend — Founding Partner Interest audience

1. Sign in to <https://resend.com> with the DPC account.
2. **Domains** → add `downtownpourcollective.com` if not already verified.
   Add the DNS records Resend gives you to the domain registrar.
   Acceptance: domain shows "Verified".
3. Verify `partners@downtownpourcollective.com` (and `nick@`) as senders, or
   confirm the domain-level verification covers them.
4. **Audiences** → "Create audience" → name it `Founding Partner Interest`.
   Copy the audience UUID — that's `RESEND_PARTNER_AUDIENCE_ID`.
5. **API keys** → "Create API key" → name `DPC-WEB partner-intake (prod)`,
   permissions = full access (or restricted to Audiences + Emails:send if
   available). Copy the key — that's `RESEND_API_KEY`. You will not see it again.

Hold on to both values for step 5.

---

## 2. Stripe — $49 founding deposit Payment Link

You said walk through this part. Here it is:

1. Sign in to <https://dashboard.stripe.com>. **Make sure you're in the right
   account / mode** (Live, not Test) when you create the production link.
2. **Products** → "Add product".
   - Name: `DPC Founding Membership Deposit`
   - Description: `$49 deposit to reserve your founding spot. Refundable if you
     don't convert at launch.`
   - Price: `$49.00 USD`, one-time.
3. Save the product. Open it.
4. Under the price, click **"Create payment link"**.
   - Quantity: fixed 1, customers cannot adjust.
   - Collect: customer email (required), name (required), phone (optional).
   - **Metadata** (required for the webhook): `product_type` = `founding_deposit`,
     `source` = `dpc-web`. Setting this on the **Product** (Stripe Dashboard
     "Update a product" → Metadata) is fine — the webhook expands line-item
     products to read it, so it does not have to be link-level metadata.
   - After payment: **"Don't show confirmation page — redirect"** →
     `https://www.downtownpourcollective.com/reserved-confirmation`.
   - Promotion codes: off.
   - Tax: leave automatic tax off for a deposit unless your accountant says
     otherwise.
   - Receipts: on.
5. Click **Create**. Copy the resulting URL (looks like `https://buy.stripe.com/abc123`).
6. Replace `data-stripe-url="https://buy.stripe.com/REPLACE_ME"` in `index.html`
   (two occurrences) with the live URL.

Acceptance: clicking either "Reserve My Founding Spot" CTA opens Stripe-hosted
checkout. After paying with a Live test card on a Live deployment, you land on
`/reserved-confirmation`.

### 2b. Stripe webhook — founding deposit welcome email

The site sends the Founding Slot Deposit welcome email from
[`/api/stripe-webhook`](api/stripe-webhook.js) when Stripe fires
`checkout.session.completed` for a paid $49 USD session marked as a founding
deposit. The webhook accepts `product_type = founding_deposit` from **either**
the Payment Link / session metadata (which Stripe copies onto the session) **or**
the Product metadata on a line item (which it does not copy, so the webhook
expands `line_items.data.price.product` to read it). Setting it in the Stripe
Dashboard "Update a product" panel is sufficient.

**Important:** `api/stripe-webhook.js` exports `config.api.bodyParser = false`
so Vercel passes the raw request body to Stripe signature verification. Do not
remove that export or signature checks will fail in production.

1. **Resend** → Audiences → create `Founding Members` → copy the audience UUID
   (`RESEND_FOUNDING_AUDIENCE_ID`).
2. **Stripe** → Developers → API keys → copy the **Secret key**
   (`STRIPE_SECRET_KEY`). Use the same mode (Test/Live) as the Payment Link.
3. **Stripe** → Developers → Webhooks → **Add endpoint**
   - URL: `https://www.downtownpourcollective.com/api/stripe-webhook`
   - Events: `checkout.session.completed` only
   - Copy the **Signing secret** (`STRIPE_WEBHOOK_SECRET`).
4. **Vercel** → Environment Variables (Production + Preview):
   - `RESEND_FOUNDING_AUDIENCE_ID`
   - `STRIPE_SECRET_KEY`
   - `STRIPE_WEBHOOK_SECRET`
   - (`RESEND_API_KEY` is already required for partner intake)
5. Redeploy after env vars are set.

Acceptance: complete a test deposit → welcome email arrives within 60 seconds,
contact appears in the Founding Members audience, and `nick@` / `hello@` receive
the internal deposit notification. Stripe session metadata gets `welcome_sent=1`
so webhook retries do not resend.

**Troubleshooting webhook HTTP 500s** (Stripe emails "We've had some trouble
sending requests…"): the handler only returns 500 for problems that are fixable
on our side, and it logs the exact cause. In order of likelihood:

1. **Vercel → Project → Logs** (filter `/api/stripe-webhook`). The log line
   names the problem directly:
   - `missing env vars: …` — one of `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
     `RESEND_API_KEY` was removed or never set for Production. Re-add and redeploy.
   - `mode mismatch — received a live-mode event but STRIPE_SECRET_KEY is a
     test-mode key` — the Payment Link/webhook are Live but Vercel holds an
     `sk_test_…` key (or vice versa). Swap in the matching key and redeploy.
   - `handler failed … type: 'StripeAuthenticationError'` — the key was rolled
     or revoked in Stripe. Paste the current Live secret key into Vercel.
   - `welcome email send failed — …` — Resend rejected the send (revoked API
     key, unverified domain). Fix in Resend; Stripe retries deliver the email.
2. **Stripe Dashboard → Developers → Webhooks → the endpoint** shows each
   attempt's response body, which carries the same `error` / `missing` /
   `detail` fields.
3. After fixing, **resend the failed events** from that same Stripe webhook
   page (each event → "Resend") so affected customers still get their welcome
   email — dedup via `welcome_sent` metadata prevents doubles.

Note: a transient Stripe or Resend outage also produces 500s by design (so
Stripe retries and the email still gets delivered). A short burst of 500s that
self-resolves is not a configuration problem — only sustained failures need
the checklist above.

**Offline handler tests** (no credentials or network needed):

```sh
npm test   # runs scripts/test-stripe-webhook-paths.mjs
```

**Local webhook testing:** use the Stripe CLI:

```sh
stripe listen --forward-to localhost:3000/api/stripe-webhook
```

Copy the printed `whsec_…` into a local `.env` for `vercel dev`.

### 2c. Ops dashboard — /dashboard

A token-protected operations view at `https://www.downtownpourcollective.com/dashboard`:
site visits and deposit-CTA clicks (first-party, anonymous), deposits pulled
live from Stripe, undelivered Stripe webhook events, webhook error log, and
health checks that verify the Stripe/Resend/Supabase keys actually work (not
just that they're set — this is the check that catches a rotated key).

Setup (one time):

1. **Supabase** → open the project → SQL Editor → paste the contents of
   [`db/setup.sql`](db/setup.sql) → Run. Creates or updates `site_events` (anonymous
   funnel beacons; anon key can only append) and `webhook_logs` (service-role
   only).
2. **Supabase** → Project Settings → API: copy the **Project URL**, the
   **anon public** key, and the **service_role** key (keep the last one secret).
3. **Vercel** → Environment Variables (Production):
   - `SUPABASE_URL` — the project URL
   - `SUPABASE_ANON_KEY` — anon public key (append-only funnel writes)
   - `SUPABASE_SERVICE_ROLE_KEY` — service role key (dashboard reads, webhook log)
   - `DASHBOARD_TOKEN` — any long random string; this is the dashboard password
     (e.g. run `openssl rand -hex 24`). Store it in 1Password.
4. Redeploy.

Acceptance: visit `/dashboard`, enter the token → KPI tiles, charts, and every
health row green. Browse the homepage and click a deposit CTA → the visit and
click appear on the dashboard within a minute. The dashboard works without the
Supabase vars too (Stripe/health sections only) — funnel tiles show
"not configured" until step 3 is done.

Privacy note: the funnel beacons store event name, page, path, and referrer
hostname plus a sanitized join failure code and HTTP status only — no cookies,
IPs, or identifiers — matching the privacy policy's "aggregated,
de-identified analytics".

### 2d. Five-minute checkout and provider health alert — /api/health-check

A Vercel Pro cron (see `vercel.json` → `crons`) hits `/api/health-check` every
five minutes. It runs a non-transactional checkout canary, checks recent
browser handoff signals, runs the same live checks as the dashboard, and **emails
an alert** to `nick@` + `hello@` (override with `ALERT_TO` / `ALERT_FROM`)
when anything is wrong: a missing env var, a Stripe key that fails a
capability the app needs (reading Checkout Sessions, PaymentIntents, or
Events), a test-mode key, a rejected Resend key, Supabase unreachable, Stripe
events undelivered for over 30 minutes, or webhook errors logged in the last
75 minutes. Every probe has a bounded timeout so the checker survives the
outages it exists to detect.

The checkout canary only fetches the production join page, sends an `OPTIONS`
request, and sends malformed JSON that must be rejected with `INVALID_REQUEST`.
It never sends a valid challenge or member details and cannot create a checkout
intent or Stripe Checkout Session.

Alerts are throttled **per incident**: the set of problems is fingerprinted,
and the same fingerprint stays quiet for 6 hours while a *different* problem
alerts immediately (tracked in `webhook_logs`, so throttling needs the
Supabase vars; without them every hourly run emails while a problem persists).

Setup (required — the endpoint refuses to run without it):

1. **Vercel** → Environment Variables (Production): add `CRON_SECRET` — any
   long random string (`openssl rand -hex 24`). Vercel automatically sends it
   as a Bearer token on cron invocations; the endpoint **fails closed** with
   503 when the secret is missing and 401 for any caller without it (the
   dashboard token also works, for manual runs).
2. Redeploy. Vercel → Project → Settings → Cron Jobs should list the five-minute
   job after the deploy. Five-minute schedules require the Pro plan.

To test it: `curl -H "Authorization: Bearer $CRON_SECRET" https://www.downtownpourcollective.com/api/health-check`
returns `{"ok":true,...}` when everything is green.

Known limitations: (1) if `RESEND_API_KEY` itself is the thing that breaks,
the alert email can't send — the failure still shows on the dashboard and in
the Vercel cron logs; (2) the Stripe probes cover **read** capabilities only —
the webhook also needs Checkout Session **write** (it stamps `welcome_sent`
metadata), which has no safe probe. If you ever switch to a restricted key,
grant Checkout Sessions read *and* write, PaymentIntents read, and Events
read.

### 2e. Checkout release gate — automated and physical devices

Any change to join, checkout, analytics, or billing handoff code must pass all
of these before production:

1. Run `npm test`.
2. Run `npm run test:e2e`. The Playwright gate must pass in both mobile Chromium
   and mobile WebKit. It mocks the checkout API and Stripe destination, so it
   performs no transaction.
3. Confirm the pull request's **Checkout navigation gate** workflow is green.
4. On the Vercel Preview URL, test a physical iPhone in Safari and a physical
   Android phone in Chrome. Confirm the Turnstile check loads, the CTA hides,
   “Open Secure Checkout” is visible before handoff, and the page remains usable
   when returning with the browser Back button. Do not submit real member data
   or complete a Stripe payment during this visual check.
5. After production deploy, invoke `/api/health-check` with the cron bearer token
   and require `"ok":true`. Confirm the dashboard shows checkout attempts,
   handoffs, recovery-link uses, and stalls.

Deployment order: apply `db/20260814_checkout_handoff_observability.sql`, deploy
the site, run the production health check, then watch the dashboard and Vercel
logs for at least ten minutes. Roll back the site deploy if the canary fails;
the additive database migration can remain.

---

## 3. GA4 — measurement ID

1. <https://analytics.google.com> → **Admin** → **Create property** →
   `Downtown Pour Collective`.
2. Time zone: Pacific. Currency: USD.
3. Platform: **Web**. Stream name: `downtownpourcollective.com`. URL: the
   production URL.
4. Copy the **Measurement ID** (`G-XXXXXXXXXX`).
5. In this repo, search for `G-XXXXXXXXXX` and replace both occurrences (one in
   `index.html`, one in `partners.html`) with the real ID.
6. Configure events in GA4 admin if desired:
   - `form_submit` (partner intake success) — mark as conversion.
   - `deposit_button_click` (member CTA) — mark as conversion.
   - `button_click`, `scroll_depth` — already firing on partners page.

Acceptance: after deploy, GA4 Realtime shows your own visit within a minute.

---

## 4. Assets

Drop these into `/assets/` and commit:
- `og-image.jpg` (1200×630, member)
- `og-partner.jpg` (1200×630, partner)
- `dpc-primary-lockup.png` (transparent, partner page schema.org logo)

You said you have these — copy them in and commit.

---

## 5. Vercel — deploy

1. <https://vercel.com> → **Add New** → **Project** → import `CrownLabs-LLC/DPC-WEB`.
2. Framework preset: **Other**. Root directory: leave default. Build command:
   leave empty. Output directory: leave empty. (Static + serverless functions
   work out of the box.)
3. **Environment Variables** — add for **Production** (and ideally Preview):
   - `RESEND_API_KEY`
   - `RESEND_PARTNER_AUDIENCE_ID`
   - `RESEND_FOUNDING_AUDIENCE_ID`
   - `STRIPE_SECRET_KEY`
   - `STRIPE_WEBHOOK_SECRET`
   - `NOTIFY_TO` (optional)
   - `NOTIFY_FROM` (optional)
4. **Deploy**. Wait for the first build to complete.
5. From the Vercel project → **Settings** → **Domains**, add:
   - `downtownpourcollective.com`
   - `www.downtownpourcollective.com`
   Vercel will show DNS records — apply them at the registrar.
   Default behavior: Vercel redirects apex → www (or vice versa) consistently
   with the member site direction.
6. Test on the Vercel preview URL first, then after DNS propagates re-test on
   the real domain.

Acceptance:
- `https://www.downtownpourcollective.com/` loads.
- `/partners`, `/privacy`, `/terms`, `/support`, `/reserved-confirmation` all load without
  the `.html` suffix.
- `/partner` (singular) 301-redirects to `/partners`.
- `/reserved-confirmation` returns `X-Robots-Tag: noindex, nofollow`.

### 5a. Cloudflare Turnstile — membership checkout

The public production site key is committed in `join.html`; the secret remains
only in the production Supabase secret manager as `TURNSTILE_SECRET_KEY`.
Production is hostname-bound to `www.downtownpourcollective.com` and the action
`circle_checkout`. Preview and local hosts automatically use Cloudflare's
published always-pass test key so the client flow can be checked without
weakening the production widget.

1. Cloudflare → Turnstile → `DPC Production Membership Checkout`.
2. Confirm widget mode is Managed and the production hostname is
   `www.downtownpourcollective.com`.
3. Confirm Supabase production has `DPC_TURNSTILE_MODE=hostname_bound` and
   `TURNSTILE_SECRET_KEY`; never copy the secret into this repository.
4. On a Vercel preview, confirm the widget resolves and form submission reaches
   the backend's expected disabled response.
5. On production, confirm the real widget resolves. With the checkout backend
   still disabled, submission must not create a Stripe Checkout Session.
6. If the widget secret is rotated, update the Supabase secret, redeploy the
   checkout function, and run the production no-op smoke before retiring the
   previous secret. The public site key changes only when the widget itself is
   replaced.

Acceptance:
- a blocked or failed Turnstile script produces a visible support fallback and
  a `join_error` event with `error_code=turnstile_unavailable`;
- after disabling content blocking, **Try security check again** issues a fresh
  Turnstile script request without requiring a page reload;
- preview QA uses the test key; production uses the hostname-bound public key;
- no secret value appears in HTML, git history, analytics, or browser logs.

### Join-error observability deployment order

Before deploying the web commit that persists join failure details, run
[`db/20260730_join_error_observability.sql`](db/20260730_join_error_observability.sql)
against production Supabase. It widens the existing event allowlist and adds
the nullable, constrained `error_code` and `http_status` columns. The SQL is
idempotent.

Merging to `main` triggers the Vercel production deployment. Apply and verify
this SQL **before merging the PR**; there is no separate post-merge deployment
window.

Verify the database change before deploying the site:

```sql
select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'site_events'
  and column_name in ('error_code', 'http_status')
order by column_name;

select pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'public.site_events'::regclass
  and conname = 'site_events_event_check';
```

The first query must return both columns. The second must include
`join_submit`, `join_checkout_redirect`, `join_error`,
`membership_checkout_complete`, and `membership_checkout_cancelled`. Do not
deploy the matching web change until both checks pass.

---

## 6. End-to-end test on production

**Stripe**
- Click both "Reserve My Founding Spot" CTAs → opens Stripe Checkout.
- Test purchase (use a real card and refund yourself, or run Stripe in a
  staging-mode link first).
- Redirect lands on `/reserved-confirmation`.
- Welcome email arrives within 60 seconds; contact is in Resend **Founding Members**.
- Stripe Dashboard → Webhooks → endpoint shows `checkout.session.completed` delivered.

**Partner intake**
- Open `/partners`. Fill the form with a real-looking test entry.
- Submit. Confirmation block should render.
- Verify in Resend: contact appears in `Founding Partner Interest`.
- Verify in mailbox: `nick@` + `partners@` receive notification with both Q&A
  answers and reply-to pointing at the submitter.
- Try a failure: temporarily revoke the Resend key in Vercel and confirm the
  form shows: *"Something stuck on our end. Try once more or email
  partners@downtownpourcollective.com directly."*

**Analytics**
- GA4 Realtime shows your session, the `form_submit` event, the
  `deposit_button_click` event, and `scroll_depth` events on partners.

**Cookie banner**
- Banner appears on first visit, hides after Accept, stays hidden on reload
  (per `localStorage`).

---

## 7. Going to Phase 2 (when founding cohort fills)

Change one line in `partners.html`:
```js
var DPC_PARTNER_PHASE = 2;
```
Commit, push, Vercel auto-deploys. Hero label, CTA, founding-cost block, and
form headline + confirmation all swap automatically. The hidden `source` field
flips to `partner-waitlist-2026` so submissions are segmentable in Resend.

---

## 8. Eventual WordPress migration

When the full site launches:
- 301 `/partners`, `/privacy`, `/terms` to their new URLs.
- Export GA4 data.
- Export the Resend `Founding Partner Interest` audience to the production list
  before decommissioning this site.
