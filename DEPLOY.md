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
subscriber health, action-needed billing states, Member Setup Fee
reconciliation, membership mix, anonymous
website and checkout-handoff signals, undelivered Stripe webhook events,
webhook errors, and health checks that verify the Stripe/Resend/Supabase keys
actually work (not just that they're set — this is the check that catches a
rotated key).

Setup (one time):

1. **Supabase** → open the project → SQL Editor → paste the contents of
   [`db/setup.sql`](db/setup.sql) → Run. Creates or updates `site_events` (anonymous
   funnel beacons; anon key can only append) and `webhook_logs` (service-role
   only).
2. **DPC database migration prerequisite** → before deploying this web change,
   apply `20260821160000_ops_subscription_overview.sql` and
   `20260902013000_ops_member_setup_fee_overview.sql` from the DPC app repo to
   staging and then production. Confirm `public.ops_subscription_overview` and
   `public.ops_member_setup_fee_overview` exist and execute remains granted
   only to `service_role`. These RPCs are owned by the DPC billing module and
   are intentionally not duplicated in
   `db/setup.sql`. If PostgREST initially returns `PGRST202`, allow its schema
   cache to reload and verify the RPC again before continuing.
3. **Supabase** → Project Settings → API: copy the **Project URL**, the
   **anon public** key, and the **service_role** key (keep the last one secret).
4. **Vercel** → Environment Variables (Production):
   - `SUPABASE_URL` — the project URL
   - `SUPABASE_ANON_KEY` — anon public key (append-only funnel writes)
   - `SUPABASE_SERVICE_ROLE_KEY` — service role key (dashboard reads, webhook log)
   - `DASHBOARD_TOKEN` — any long random string; this is the dashboard password
     (e.g. run `openssl rand -hex 24`). Store it in 1Password.
5. Configure Preview with the staging project's `SUPABASE_URL` and
   `SUPABASE_SERVICE_ROLE_KEY`, then deploy to Preview. Open `/dashboard` and
   confirm subscriber health, action-needed, Member Setup Fee reconciliation,
   and membership-mix data populate without an RPC error; a "not configured"
   state does not pass this check.
   Then deploy to Production.

Acceptance: visit `/dashboard`, enter the token → KPI tiles, charts, and every
health row green, including **Stripe key can read subscriptions**. Start a
membership checkout attempt → the attempt appears in Acquisition signals
within a minute. The dashboard page still loads without Supabase variables in
a local or preview environment, but subscriber and acquisition sections show
"not configured" until steps 2–4 are complete.

Privacy note: the funnel beacons store event name, page, path, and referrer
hostname plus a sanitized join failure code and HTTP status only — no cookies,
IPs, or identifiers — matching the privacy policy's "aggregated,
de-identified analytics".

### 2d. Five-minute checkout and provider health alert — /api/health-check

A Vercel Pro cron (see `vercel.json` → `crons`) hits `/api/health-check` every
five minutes. It runs a non-transactional checkout canary, checks recent
browser handoff signals, runs the same live checks as the dashboard, and
emails SEV-0 and SEV-1 alerts directly to the approved Crown Labs operational
recipient. Subjects identify severity, Production, affected capability, and a
fixed plain-language verdict. SEV-2 results remain visible without immediate
email. Checks cover required configuration, provider access, checkout
contracts, undelivered sensitive Stripe events, recent webhook errors, and
checkout handoff signals. Every probe has a bounded timeout so the checker
survives the outages it exists to detect.

The operational route is intentionally separate from partner-intake and
founding-deposit email. `ALERT_TO` is required in Production and has no
fallback; a missing or prohibited recipient makes the health check unhealthy
and blocks delivery. `ALERT_FROM` and `ALERT_REPLY_TO` are also required for a
green check, but their defects do not block delivery. A missing or prohibited
sender uses the verified `support@downtownpourcollective.com` fallback. A
missing or prohibited reply-to is reported as unhealthy and omitted. The check
never inherits a business-notification recipient or sender. Exact, plus, and
dotted aliases of prohibited DPC mailboxes are rejected.

Resend paging distinguishes credential failures from provider noise. Missing,
invalid, and restricted API keys remain paging problems. A timeout, provider
5xx, or `rate_limit_exceeded` response from `domains.list` is returned in the
health-check JSON as a warning and remains red on the dashboard, but does not
send an alert email.

The checkout canary only fetches the production join page, sends an `OPTIONS`
request, and sends malformed JSON that must be rejected with `INVALID_REQUEST`.
It never sends a valid challenge or member details and cannot create a checkout
intent or Stripe Checkout Session.

Alerts are throttled **per incident**: the set of alertable problems is
fingerprinted. The same SEV-1 fingerprint stays quiet for 6 hours; an active
SEV-0 reminds every 30 minutes. A different problem set alerts immediately.
Throttle records live in `webhook_logs`, so without Supabase every five-minute
run emails while a problem persists.

Each authenticated Production run also writes one allowlisted observation row
to `webhook_logs` when Supabase is reachable. It records every stable key as
`healthy`, `unhealthy`, or `unknown`, plus integer phase timings and comparable
total runtime through the bounded notification phase. This evidence is
independent of email and throttling. Preview and Development return results but
write no Production evidence and send no operations email.

If reads work but observation inserts fail, an otherwise healthy invocation
sends one stateless evidence-failure email. A run that already sent its main
incident email does not send a second email for the evidence failure. Because
the write fault also prevents a durable throttle marker, the stateless warning
may repeat on the next five-minute invocation until writes recover.

Setup (required):

1. **Vercel** → Environment Variables (Production): add `CRON_SECRET` — any
   long random string (`openssl rand -hex 24`). Vercel automatically sends it
   as a Bearer token on cron invocations; the endpoint **fails closed** with
   503 when the secret is missing and 401 for any caller without it (the
   dashboard token also works, for manual runs).
2. Add these Production-only operational email settings before merging:
   - `ALERT_TO=brandi@crownlabsllc.com`
   - `ALERT_FROM=Downtown Pour Collective Operations
     <support@downtownpourcollective.com>`
   - `ALERT_REPLY_TO=brandi@crownlabsllc.com`
3. Confirm the `downtownpourcollective.com` domain is verified in Resend so the
   operations sender is authorized. Do not add these settings to Preview or
   Development; those environments suppress operational alert delivery.
4. Redeploy. Reading values in the Vercel UI does not prove the running
   function sees them. After the deploy, invoke `/api/health-check` with its
   bearer token and confirm the authenticated response has no `ALERT_*`
   configuration problems. In Vercel, Project → Settings → Cron Jobs should
   list the five-minute job. Five-minute schedules require the Pro plan.
5. Run a controlled delivery test and inspect the Resend delivery record.
   Confirm the message reaches only the approved Crown Labs recipient, uses the
   operations sender and explicit reply-to above, and does not reach any
   business-notification recipient. Record recipient roles and delivery result,
   but no credentials or private phone number.

To test it: `curl -H "Authorization: Bearer $CRON_SECRET" https://www.downtownpourcollective.com/api/health-check`
returns `{"ok":true,...}` when everything is green. The response includes an
`observations` array. Non-paging results return `ok: false` with a `warnings`
array and an empty `problems` array.

Known limitations:

1. If `RESEND_API_KEY` itself breaks, the alert email cannot send. The failure
   still shows on the dashboard, in observation evidence when writable, and in
   Vercel logs.
2. The Stripe probes cover **read** capabilities only. The webhook also needs
   Checkout Session **write** to stamp `welcome_sent` metadata, which has no
   safe probe. A restricted key needs Checkout Sessions read and write,
   Subscriptions read, and Events read.
3. SEV-2 conditions have no email path before the Phase 6 digest. In
   particular, `undelivered-list-failed` is dashboard and evidence only during
   the observation window.
4. Five-minute evidence adds roughly 15 MB per month at the current row size.
   Retain it through the 30-day gate, then approve retention or archival before
   Phase 4 adds more operational writers.
5. Persisted `total_ms` ends immediately before the bounded observation insert.
   For conservative 30-second-cap headroom, add the 2-second insert budget; the
   row timestamp minus `checked_at` also measures time through database arrival.
6. An unset or unrecognized `VERCEL_ENV` alerts as an ambiguous environment but
   writes no row labeled Production. Explicit Preview and Development remain
   suppressed.

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

### 2f. Support dashboard — /admin/support

A triage view for member **support tickets** and **feedback submissions** at
`https://www.downtownpourcollective.com/admin/support`. Until this existed,
nothing notified anyone when a member filed a ticket — the only surface was
the in-app `AdminScreen` in the mobile build, refreshed by hand.

This is a different system from `/dashboard`. It does **not** use
`DASHBOARD_TOKEN`; it signs in against **Supabase Auth** with a real admin
account, because the two Edge Functions it calls (`admin-support-queue` and
`admin-support-triage`, both deployed from the `DPC` repo) authorize on
`app_metadata.role === 'admin'` in the caller's JWT.

Setup (one time):

1. **Supabase** → Project Settings → API: copy the **Project URL** and the
   **anon public** key. The DPC app project is `ebiuspbgzggrdiaswpcc`
   (production) or `hohbsqkmrlhkstojfdgx` (staging).
2. **Vercel** → Environment Variables (Production):
   - `ADMIN_SUPABASE_URL` — the project URL
   - `ADMIN_SUPABASE_ANON_KEY` — anon public key
   Both fall back to `SUPABASE_URL` / `SUPABASE_ANON_KEY` if unset, so set
   them explicitly whenever the support dashboard should point at a different
   Supabase project than the marketing funnel does.
3. Redeploy.

Never put the **service_role** key in `ADMIN_SUPABASE_ANON_KEY`.
`/api/admin-config` serves this value to the browser, so a service-role key
there would hand full, RLS-bypassing database access to every visitor. The
endpoint detects the privileged key shapes (`sb_secret_*` and JWTs claiming
`role: service_role`) and refuses to serve them, but don't rely on that.

Admin accounts are provisioned out-of-band — `app_metadata.role` can only be
set with the service-role key, which this repo does not hold. Today
`brandi@crownlabsllc.com` is the only admin in production. Add more via the
Supabase dashboard or Admin API.

Acceptance: visit `/admin/support`, sign in with an admin account → the ticket
queue loads. Sign in with a non-admin member account → "Not an admin account"
rather than a generic error. The page shows which Supabase project it's
pointed at on the sign-in screen, which is the fastest way to catch a
staging/production mixup.

Known limitations, all inherited from the Edge Function contract: there is no
total count for either collection, so the dashboard shows "Showing 1–25" and
infers a next page from a full one rather than claiming a total; the
`status`/`severity`/`owner` filters are server-side but the feedback category
filter only narrows the page already loaded; and the related venue, credit,
and redemption columns come back as bare UUIDs, so the dashboard shows them
with a copy button instead of expanding them into names.

The queue refreshes every 60 seconds and on window focus. There's no realtime
trigger on ticket creation — that would be a Supabase Realtime change in the
backend repo.

---

### 2g. Live legal versions — /api/legal-versions

`/join` and `/depositor-confirmation` no longer carry a hardcoded legal-version
tuple. They read it from this endpoint at load and revalidate it immediately
before submitting.

**Why.** The tuple is consent evidence: `circle-checkout` forwards whatever the
page submits into `record_pre_payment_legal_acceptance`, which writes it to
`member_legal_acceptances` with IP and user agent. Hardcoding it meant every
legal-version bump was a synchronized-deploy problem, and any cached page or
still-open tab kept submitting a version the server had moved past — checkout
then failed with `LEGAL_VERSIONS_NOT_CURRENT`. That is what took `/join` down on
2026-08-17. Letting the server silently stamp the current version instead would
be worse: it would record consent to a document the member was never shown.

**How it works.**

- The endpoint calls the `membership/`-owned `SECURITY DEFINER` RPC
  `current_checkout_legal_versions()` with `SUPABASE_SERVICE_ROLE_KEY`. It does
  not read `member_legal_current_versions` directly — that table is RLS-enabled
  with privileges to `postgres` only, and a direct read fails closed.
- Success returns `{tos, privacy, memberTerms, autoRenewalTerms}` with
  `Cache-Control: public, max-age=0, s-maxage=10, stale-while-revalidate=50`.
- `?fresh=1` returns `no-store` and always hits the RPC. Pages use the plain URL
  on load and `?fresh=1` at submit and after a server rejection.
- **Every failure returns 503 with `no-store` and no tuple** — RPC error,
  permission denied, `legal_currentness_unavailable`, or a structurally
  incomplete success. There is deliberately no fallback tuple; a fallback is the
  original bug. When it is down, both pages disable checkout and say so.

**Cache scope and its limits.** `s-maxage` is load-bearing: Vercel caches a
Function response only when `s-maxage` is present, so a regression to a bare
`max-age` would silently disable the whole mitigation (`npm test` asserts on
`s-maxage=10` specifically). The cache is segmented per Vercel region, so the
floor is roughly one RPC per 10s window *per region*, not globally. A cached
tuple can be up to ~60s stale; that is safe because every submit revalidates
uncached and the transactional DB gate remains authoritative.

**Vercel Firewall contract.** The route is unauthenticated and reachable
before Turnstile by necessity. Production rate-limits the exact
`/api/legal-versions` request path per source IP, including requests carrying
`?fresh=1`, while the cache further reduces repeated reads on the default
path. Keep live rule identifiers, thresholds, validation evidence, and
residual-exposure analysis in the private DPC operations note:
`docs/operations/legal-versions-firewall.md`. The completed rollout evidence
remains immutable and is not the live configuration source.

The fail-closed checkout trade-off applies to the firewall too: a `429` means
the pages cannot confirm the live legal tuple, so submission stays blocked.
Both pages show “Too many attempts. Please wait a moment and try again,” keep
the retry action disabled for the response's `Retry-After` interval (or a
bounded exponential cooldown when the header is absent), and make the retry
read `?fresh=1`. Repeated clicks and form submissions during that wait spend no
additional requests. A successful retry never auto-submits: it either safely
re-enables checkout for another fresh submit-time read or, if the tuple changed,
clears consent and requires re-acceptance. Non-`429` failures retain the
unavailable state. There is still no fallback tuple.

**Monitoring.** The five-minute health cron (§2d) probes the endpoint with
`?fresh=1` — deliberately bypassing the CDN, since a cached 200 would keep
reporting healthy straight through a grant regression or a missing singleton
row. It pages on a non-200 and on a structurally incomplete tuple, because an
incomplete tuple blocks checkout exactly as hard as an outage does.

**Deployment order.** The DPC-side RPC migration
(`20260820120000_current_checkout_legal_versions_rpc.sql`, PR #335) must be
applied to production before this site deploys — the endpoint has nothing to
call otherwise. **Rollback runs in reverse:** once this is live, restore the
previous site deploy *first* and confirm `/join` and `/depositor-confirmation`
are healthy before touching the RPC. Never revoke the grant out from under a
live caller; leaving the RPC in place as a compatibility shim costs nothing.

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

## 5. Vercel — Git-integrated deploy

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

After the initial project import, production deployments come only from
Vercel's Git integration: merge a reviewed change to GitHub `main`, then verify
the deployment created for that exact commit. The repository intentionally has
no local production-deploy npm script. Do not run `vercel --prod` from a local
checkout; it uploads the invoking directory and can bypass GitHub `main`.
Pull-request previews remain the pre-merge verification path.

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
  and column_name in ('error_code', 'http_status', 'flow_id')
order by column_name;

select pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'public.site_events'::regclass
  and conname = 'site_events_event_check';
```

The first query must return all three columns. The second must include
`join_submit`, `join_checkout_redirect`, `join_checkout_ready`,
`join_checkout_departed`, `join_checkout_fallback_clicked`,
`join_checkout_stalled`, `join_error`,
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
