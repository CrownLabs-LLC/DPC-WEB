Method: dual-agent (A: `/root/final_design_review` · B: `/root/final_evidence_review`)

# Final UI/UX review: Home, Events and Join

October 20, 2026. Local preview on `codex/homepage-rebuild`.
Targets: `index.html`, `events.html`, `join.html`.

**Verdict: keep the design; correct Join accessibility before launch.**
Home and Events now explain and demonstrate a community people can join.
Join is the weakest point of the journey because its information and controls
are quieter than the pages that lead into it. No P0 navigation, selection or
responsive-layout defect was confirmed. Publication still has content and
hosted-verification gates in the [launch checklist](website-launch-checklist.md).

This was a review and checklist update. No UI, checkout behavior, backend
configuration or production state was changed.

**Subsequent correction:** Join's contrast and membership-context findings
were addressed later on October 20 at Brandi's request. See the
[fix and verification record](join-accessibility-clarity-2026-10-20.md).
The findings and scores below remain the original review snapshot.

## Design health: 30/40, Good

Scores describe the connected discovery-to-enrollment journey, not independent
page scores. All ten heuristics apply because Join is an operational form.

| Heuristic | Score / 4 | Finding |
| --- | --- | --- |
| Visibility of system status | 3 | Selected choices, order summary and retry state are visible. |
| Match with the real world | 4 | Local people and places, defined Pours and understandable beverage choices. |
| User control and freedom | 3 | Editable selections, Home link, disclosures and Escape dismissal. |
| Consistency and standards | 3 | Shared identity and icons; Join has weaker contrast and denser typography. |
| Error prevention | 3 | Billing choices, prepaid wording, summary and terms/security gates. |
| Recognition rather than recall | 2 | Direct Join visitors lack a benefits/rules recap; event directions need lookup. |
| Flexibility and efficiency | 3 | Keyboard radio operation and preselected membership links work. |
| Aesthetic and minimalist design | 3 | Distinctive photographs and restrained layout; subdued Join controls need attention. |
| Error recovery | 3 | Actionable failure/retry text; hosted success still requires verification. |
| Help and documentation | 3 | Home FAQ and contact links are useful; Join needs nearby membership context. |
| **Total** | **30/40** | **Good foundation, with a specific accessibility correction before release.** |

## Specificity and strengths

This feels authored for DPC: actual Livermore gatherings, known independent
businesses, local artwork and the established navy/cream/gold identity do the
persuasive work. The full-logo app screenshots and beverage progression
reinforce the product explanation. Preserve the original logos, partner roster,
approved photos/captures and existing design direction.

- Home explains community first, then makes assigned venues, eligibility,
  expiry and redemption timing available before purchase.
- Events provides credible past activity and a concrete upcoming gathering.
  Calendar download, photo disclosures and membership navigation work.
- Home's plan links preserve the chosen Circle and billing interval on Join.
  Radio keyboard selection and mobile-menu Enter/Escape were verified.

## Priorities

### P1: Correct Join contrast

**Impact:** Low-vision and keyboard visitors receive weak visual cues at the
point where they select a plan and enter personal details.

Evidence in `join.html`:

- Circle and billing radio focus outlines at lines 203 and 285 use 50% gold.
  Against the panel their computed contrast is approximately **2.61:1**.
- Input borders at line 345 composite to approximately **1.7–1.8:1**.
- The selected Circle's annual price note, defined at line 249, measures
  approximately **4.03:1** at 12px.
- Small footer copyright text measures approximately **3.48:1**.

Use an opaque, contrasting focus ring and more legible field boundaries;
target 3:1 for necessary non-text cues. Raise normal small text to 4.5:1.
Validate selected and unselected cards, not only the default page.
Suggested command: `$impeccable harden join.html`, followed by a focused
`$impeccable polish join.html`.

### P2: Carry membership clarity into Join

**Impact:** A visitor arriving directly at Join sees beverage categories and
prices without the context that makes the purchase understandable.

At `join.html:694` onward, add a compact recap of up to five Membership Pours
per membership month at assigned venues, with easy access to the approved
eligibility, expiry and redemption-time details. Reuse existing Home language.
The Open Graph and Twitter descriptions at lines 18 and 22 also need the
qualified “up to five” wording.

The annual amount is correct in the order summary, but the Circle cards still
emphasize monthly prices while annual billing is selected by default. Making
the chosen interval's amount clearer is a useful follow-up, not evidence of
incorrect charging. Suggested command: `$impeccable clarify join.html`.

### P2: Make event attendance self-contained

**Impact:** Members unfamiliar with Wood Family Vineyards must search elsewhere
for directions, and the generic event-format text sends them to announcements
for cost/RSVP instructions that this announcement does not provide.

`events.html:107–115` has the confirmed venue name, date, time and member
audience, calendar action and email-question link. Add a verified street
address/directions link. Ask Nick or Brandi for any attendance cost and the
actual arrival/RSVP instruction. No RSVP URL is missing: Brandi explicitly
said there is none. Do not equate that with no RSVP requirement, free admission
or guest permission. Suggested command: `$impeccable clarify events.html`.

## Cognitive load and emotional journey

Home and Events have low cognitive load. Home's six plan actions are grouped
into three Circles with two billing alternatives, rather than six unrelated
decisions. Five FAQ rows and six footer links exceed four choices, but are
secondary and grouped. Events has a clear upcoming/past split and progressive
photo disclosures.

Join has moderate load: visitors must recall membership benefits and reconcile
monthly card emphasis with the default annual choice. The four numbered
sections and three-Circle/two-interval choices otherwise work well.

Home establishes belonging, Events shows it in action, and Join asks for
commitment. The main emotional drop is the transition to the smaller, subdued
Join form. A brief benefits recap and stronger controls would connect that step
to the rest of the experience. The successful payment/onboarding ending was
not exercised against production.

## Persona red flags and smaller observations

- **First-time visitor:** Direct Join traffic lacks the membership explanation.
- **Keyboard/low-vision visitor:** Controls operate, but focus and some small
  text do not meet the measured contrast targets.
- **Distracted mobile visitor:** The layout fits; price emphasis and missing
  event directions require unnecessary extra attention.

Join's small Home link is approximately 22.5px high. Enlarging its hit area is
useful polish; that measurement alone is not a confirmed WCAG failure because
spacing exceptions also matter. Source-defined validation uses a common alert;
field association and actual VoiceOver announcements remain a closeout check.

Useful design questions for the next implementation pass: can Join explain the
membership in two short sentences, make the selected total unmistakable, and
can a member arrive at the next gathering using only its event card?

## Technical evidence

- `npm test`: **passed**, all configured offline suites.
- Seven relevant browser suites: **246 passed, 3 failed** across desktop
  Chromium, mobile Chromium and mobile WebKit. Home, Events, menus, plan
  selection, consent, legal-version recovery and checkout recovery were covered.
- All three failures were in mobile WebKit: restored-page departure telemetry,
  Cellar annual via pricing link, and Reserve annual via form.
- The same three tests, unchanged, repeated three times with one worker:
  **9/9 passed**. This did not reproduce the failures; it does not establish a
  root cause or make the initial full run green. Keep the clean final CI gate.
- Both independent reviews observed no horizontal overflow in sampled desktop
  and 390px layouts; A also checked Home/Join at 320px. B confirmed one main
  landmark and h1 per page, form labels, and no missing image alternatives.
- Calendar checks verified November 18, 5–8 PM Pacific as November 19,
  01:00–04:00 UTC. Real calendar-app import remains untested.
- Detector ran once per target: **35 advisories** total, Home 3, Events 3,
  Join 29. Rules: 32 font-size and 3 color advisories. Home/Events' six items
  are typography inside preserved SVG logos, not reasons to alter those logos.
  Join advisories identify incumbent source literals, not 29 verified defects.
- The detector used degraded regex parsing because its optional HTML/CSS
  parser packages are absent. It cannot establish computed contrast. Contrast
  findings above come from independent CSS/DOM compositing.

The local server does not implement the live legal-version endpoint. Join's
clear terms-error/retry state is a preview limitation, not evidence of a
production outage. Automated checkout uses mocked providers, with no real
member submission or payment. No formal accessibility certification, physical
device, VoiceOver, 200% text-resize, hosted payment/onboarding, current field
performance or production-configuration claim is made.

## Launch disposition

Before publication: fix Join contrast, reconcile its explanation/share copy,
confirm event attendance details, obtain clean ribbon assets and permissions,
confirm Ron Essex attribution, verify the hosted/device journey, and complete
the final release gate. Then update the sitemap and remove only the public
preview notices/indexing restrictions. Brandi retains the final approval gate.

The app screenshots, beverage icons, original logos, partner roster, Bruno's
treatment, supplied press links and confirmed event date/time are complete.
Press logos, member quotes, video, podcast episode and affiliation links are
optional. See the [owner-by-owner checklist](website-launch-checklist.md).

## Evidence files

Screenshots, detector JSON and initial test failures are in
`.impeccable/review/final-2026-10-20/`. The `A-join-320-keyboard.jpg` capture
documents the focus treatment; `A-home-circles-desktop.jpg` documents the clear
membership explanation and preserved icons. Some full-page captures contain
offscreen lazy-image blanks; they do not establish missing assets.
