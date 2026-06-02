# Handoff: Downtown Pour Collective — Interim Site (Member + Partner)

## Overview
This bundle contains the **finished, production-ready static pages** for Downtown Pour
Collective's interim website, ahead of the full WordPress launch. Two public landing pages
plus their supporting pages:

| File | Route | Purpose | Indexing |
| --- | --- | --- | --- |
| `index.html` | `/` | Member placeholder landing page. Founding Membership signup. | index |
| `partners.html` | `/partners` | Founding Partner landing page. Operator intake → call with Nick. | index (Nick can flip to noindex) |
| `privacy.html` | `/privacy` | Privacy Policy (Bend Law Group). | — |
| `terms.html` | `/terms` | Terms of Service (Bend Law Group). | — |
| `reserved-confirmation.html` | `/reserved-confirmation` | Post-signup confirmation for members. | **noindex, nofollow** |
| `favicon.svg` | — | Wax-seal favicon, referenced by every page. |

## About the Design Files
**These are not throwaway prototypes — they are the actual static site.** The brief
explicitly calls for a static HTML/CSS/JS build (Option A: Netlify or Vercel). All styling,
copy, responsive behavior, fonts, logos (inline SVG), and client-side form UX are complete
and final. Your job with Claude Code is **not** to rebuild the UI in a framework. It is to:

1. Stand the files up on a host,
2. Wire the two forms to a real backend (they currently stub success client-side), and
3. Add the live analytics + assets + redirects that can't be hardcoded into static files.

If you do choose to port into a framework later, treat the HTML as the pixel-perfect source
of truth for layout, tokens, and copy.

## Fidelity
**High-fidelity / production.** Final colors, typography, spacing, copy, and interactions.
Recreate nothing; ship as-is and connect the backend.

---

## What Still Needs Wiring (the real work)

### 1. Partner intake form (`partners.html`)
- Currently: client-side validation only, then `wrap.classList.add('is-submitted')` to show
  the confirmation. Look for the `/* ── Intake form ── */` script block near the bottom.
- Needed: POST to a **server endpoint** (never client-side — the API key must stay server-side).
  Stack is **Resend** (already part of DPC's tooling). On submit the endpoint must:
  - Add the contact to the **Founding Partner Interest** audience in Resend.
  - Set custom fields: `first_name`, `last_name`, `venue_name`, `phone`, `circles_interest`,
    `q1_answer`, `q2_answer`, `source` (= `partner-landing-june2026` in Phase 1,
    `partner-waitlist-2026` in Phase 2 — already swapped by the phase script), `signup_date`.
  - Send a notification email to `nick@downtownpourcollective.com` **and**
    `partners@downtownpourcollective.com` with the venue name and both answers.
  - Log the lead into the CRM / War Room tracker (field mapping confirmed with Brandi pre-launch).
- Error copy is already in the code as comments — on API failure show:
  *"Something stuck on our end. Try once more or email partners@downtownpourcollective.com directly."*
  in `.form__error` (Aged Gold), keeping the operator's input.
- The form `<input type="hidden" name="source">` value is set by the phase script — don't hardcode it.

### 2. Member form (`index.html`)
- Has its own signup flow. Inspect its form script for the same pattern (client-side stub →
  needs a real endpoint + Resend audience). Note: per the brief the **member** page uses Stripe
  for a deposit/checkout; the **partner** page takes **no payment** (no Stripe, no checkout —
  do not add one to `partners.html`).

### 3. Analytics (GA4)
- Both pages call `window.gtag(...)` defensively (`if (window.gtag)`). There is **no GA4 snippet
  installed** — add the GA4 loader with DPC's existing measurement ID to the `<head>`.
- Events to confirm fire: `form_submit` (intake success), `button_click` (primary CTA),
  `scroll_depth` (50% / 75% / 100%) on the partner page.

### 4. Referenced assets that must exist on the server
These are referenced by **absolute production URLs**, so they need to be present at deploy:
- `/assets/og-partner.jpg` — 1200×630 OG image (Navy bg, primary lockup, "FOUNDING PARTNERS · LIVERMORE").
- `/assets/dpc-primary-lockup.png` — referenced in `partners.html` schema.org `logo`.
- `index.html` likely references its own OG image — grep `og:image` and confirm those files ship too.
- `favicon.svg` is included in this bundle and referenced relatively (works as-is). Brief also wants
  32×32 and 192×192 PNG favicons from the Wax Seal monogram — add if desired.

### 5. Hosting, SSL, redirects
- Deploy to Netlify or Vercel (static). Routes should be clean (`/partners`, `/privacy`, `/terms`).
- SSL required. WWW redirect consistent with the member page direction.
- At full WordPress launch: 301 `/partners`, `/privacy`, `/terms` to the new site, export GA4 data,
  and migrate the Founding Partner Interest list to production before decommissioning.

### 6. Cookie consent
- `partners.html` ships a minimal analytics-cookie banner (stored under
  `localStorage['dpc_partner_cookie_consent']`). It shows until accepted. Keep it if GA4 sets cookies.

---

## The Partner Page Phase Toggle (important)
`partners.html` ships **both states** of the page and flips between them with a single line:

```js
var DPC_PARTNER_PHASE = 1;   // ← change to 2 when the founding cohort fills
```

(or set `<html data-phase="2">` directly). Phase 2:
- Hero label → `FOUNDING COHORT FULL · WAITLIST OPEN`, CTA → "Join The Partner Waitlist".
- Section 5 founding-cost block → "The founding cohort is full… Founding pricing is closed."
  (The founding **fee is hidden** in Phase 2.)
- Intake form headline → "Join the partner waitlist.", confirmation → "You're on the list.",
  hidden `source` field → `partner-waitlist-2026`.

CSS classes `.phase-1` / `.phase-2` show/hide content based on the `data-phase` attribute on `<html>`.
For a real deploy, drive `DPC_PARTNER_PHASE` from an env var / single build-time edit.

Also: the partner page honors a **`#start` deep link** (from the print QR code) — `/partners#start`
scrolls to the intake form and focuses the first field. Keep `id="intake"` and the `#start` handling intact.

---

## Design Tokens (defined as CSS custom properties at the top of each page)
| Token | Hex | Role |
| --- | --- | --- |
| `--navy` | `#0D1B2A` | Primary background |
| `--liquid` | `#1E3A5A` | Card fills, button hover, form fields (never page bg) |
| `--blue-ring` | `#2A4F70` | Seal/depth ring |
| `--gold` | `#C4A35A` | Accent, buttons, rules (aged, never bright/yellow) |
| `--gold-hover` | `#D4B370` | Link hover |
| `--gold-press` | `#B0915C` | Button hover |
| `--gold-deep` | `#9C7E50` | Button active |
| `--cream` | `#F5F0E8` | Body text on dark, light section bg |
| `--white` | `#FFFFFF` | Emphasis only |
| `--muted-gray` | `#5A6475` | Tagline / location text |

- **Type:** Playfair Display (700/900) display & headlines · Barlow Condensed (600/700) labels/buttons ·
  Barlow (400/500) body. All from Google Fonts (loaded in `<head>`). No substitutions.
- **Spacing:** 4-based scale. Max content width `1100px`. Generous vertical whitespace; sections
  alternate Navy / Cream.
- **Radii:** 4–6px (buttons 4px). **Buttons:** gold bg, navy text, Barlow Condensed 700 uppercase,
  0.15em tracking, 18×36px padding, hover `#B0915C`, active `#9C7E50` + scale(0.98).
- **Breakpoints:** desktop ≥1024, tablet 768–1023, mobile ≤767. Touch targets ≥44px, inputs ≥56px.

## Copy / Voice Guardrails (enforce on any future edits)
Partner copy follows strict rules — if you regenerate any text, do not reintroduce:
- **Forbidden words:** discount, deal, savings, promo, sale, coupon, comp, commission, "cut",
  "percentage of sales" (as a benefit), VIP, credit/balance, unlock/claim/redeem (as *marketing*
  verbs — descriptive "a Pour a member redeems" is fine), free, sign up / subscribe, loyalty
  program, "don't miss out / limited time / hurry".
- **No em dashes, no en dashes, no exclamation points** anywhere on the partner page.
- **Pricing firewall:** the only dollar figures allowed on `partners.html` are **$399, $4,788, $149**.
  Never print per-Pour reimbursement rates or any percentage that lets an operator back into the
  confidential rate. Reimbursement is named only as "an agreed rate for each Pour" / "agreed category rates".
- **Terminology:** "The Introduction" = the quarterly guest Pour (the retired terms Handoff / Plus-One /
  Bring a Friend must appear nowhere). Phone always formatted `(925) 488-4889`. Use "house" (not "room")
  when referring to the operator's venue.

## Files in this bundle
- `index.html`, `partners.html`, `privacy.html`, `terms.html`, `reserved-confirmation.html`, `favicon.svg`
- Everything is self-contained (inline CSS + inline SVG logos; fonts via Google Fonts CDN). No build step.
