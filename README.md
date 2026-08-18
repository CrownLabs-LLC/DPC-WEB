# DPC-WEB

Interim Downtown Pour Collective website — two member-facing landing pages plus
supporting pages, deployed to Vercel.

| Route | Source | Purpose |
| --- | --- | --- |
| `/` | `index.html` | Member founding signup (Stripe Checkout link) |
| `/partners` | `partners.html` | Founding Partner intake (Resend) |
| `/privacy` | `privacy.html` | Privacy Policy |
| `/terms` | `terms.html` | Terms of Service |
| `/depositor-confirmation` | `depositor-confirmation.html` | Private historical-depositor conversion (noindex; token in scrubbed URL fragment) |
| `/reserved-confirmation` | `reserved-confirmation.html` | Post-deposit confirmation (noindex) |
| `/stripe-connect/refresh` | `stripe-connect/refresh.html` | Stripe Connect Account Link expired/invalid (noindex) |
| `/stripe-connect/return` | `stripe-connect/return.html` | Stripe Connect Account Link return (noindex) |

## Stack
- Static HTML/CSS/inline JS (no build step). Fonts from Google CDN.
- Vercel Node serverless functions:
  - [`/api/partner-intake`](api/partner-intake.js) — partner form → Resend
  - [`/api/stripe-webhook`](api/stripe-webhook.js) — Stripe deposit → welcome email + Founding Members audience
- Resend for partner intake and founding deposit welcome email.
- Stripe Payment Link (hosted) for the $49 founding deposit.

## Local dev
```sh
npm install
npx vercel dev
```
Then open <http://localhost:3000>.

## Configuration

### Env vars (Vercel project settings)
See [`.env.example`](.env.example). Required:
- `RESEND_API_KEY`
- `RESEND_PARTNER_AUDIENCE_ID` (partner intake)
- `RESEND_FOUNDING_AUDIENCE_ID` (deposit welcome email)
- `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` (deposit webhook)

Optional (have sensible defaults):
- `NOTIFY_TO` — comma-separated recipients
- `NOTIFY_FROM` — verified Resend sender

### Things to swap in the HTML before launch
1. **Stripe Payment Link** — replace `data-stripe-url="https://buy.stripe.com/REPLACE_ME"` in `index.html` (two occurrences) with the live link.
2. **GA4 measurement ID** — replace `G-XXXXXXXXXX` in the loader block at the bottom of each page's `<head>` in `index.html` and `partners.html`.
3. **Assets** — drop OG images + primary lockup into [`/assets`](assets/README.md).

### Partner page phase toggle
`partners.html` ships both states. To flip to waitlist mode when the founding
cohort fills, change `var DPC_PARTNER_PHASE = 1;` to `2` (search for it near the
bottom of the file).

See [`DEPLOY.md`](DEPLOY.md) for the full launch checklist (Stripe, Resend, GA4,
DNS, Vercel).

## Source of truth
The handoff brief that produced these files is preserved in
[`DESIGN_HANDOFF.md`](DESIGN_HANDOFF.md). Treat it as authoritative for copy,
tokens, and partner-page voice guardrails.
