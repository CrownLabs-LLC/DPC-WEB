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
   - Metadata (click "Add metadata"):
     - `product_type` = `founding_deposit`
     - `source` = `dpc-web`
3. Save the product. Open it.
4. Under the price, click **"Create payment link"**.
   - Quantity: fixed 1, customers cannot adjust.
   - Collect: customer email (required), name (required), phone (optional).
   - After payment: **"Don't show confirmation page — redirect"** →
     `https://www.downtownpourcollective.com/reserved-confirmation`.
   - Promotion codes: off.
   - Tax: leave automatic tax off for a deposit unless your accountant says
     otherwise.
   - Receipts: on.
5. Click **Create**. Copy the resulting URL (looks like `https://buy.stripe.com/abc123`).
6. Replace `data-stripe-url="https://buy.stripe.com/REPLACE_ME"` in `index.html`
   (two occurrences) with the live URL.
7. Stripe webhook for downstream credit ledger / founding deposit conversion is
   owned by the **mobile app backend**, not this site. Per `DPC/CLAUDE.md`, the
   `founding-deposits/` module wires that up. Nothing to do here.

Acceptance: clicking either "Reserve My Founding Spot" CTA opens Stripe-hosted
checkout. After paying with a Live test card on a Live deployment, you land on
`/reserved-confirmation`.

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
- `/partners`, `/privacy`, `/terms`, `/reserved-confirmation` all load without
  the `.html` suffix.
- `/partner` (singular) 301-redirects to `/partners`.
- `/reserved-confirmation` returns `X-Robots-Tag: noindex, nofollow`.

---

## 6. End-to-end test on production

**Stripe**
- Click both "Reserve My Founding Spot" CTAs → opens Stripe Checkout.
- Test purchase (use a real card and refund yourself, or run Stripe in a
  staging-mode link first).
- Redirect lands on `/reserved-confirmation`.

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
