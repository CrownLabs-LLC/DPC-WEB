---
name: Downtown Pour Collective
description: The existing DPC web identity, extended by the glass pickup form.
colors:
  navy: "#0D1B2A"
  liquid: "#1E3A5A"
  gold: "#C4A35A"
  gold-hover: "#D4B370"
  gold-press: "#B0915C"
  gold-deep: "#9C7E50"
  cream: "#F5F0E8"
  white: "#FFFFFF"
  ink-soft: "#38506A"
typography:
  display:
    fontFamily: "Playfair Display, Georgia, serif"
    fontSize: "56px"
    fontWeight: 700
    lineHeight: 1.08
  pickup-display:
    fontFamily: "Playfair Display, Georgia, serif"
    fontSize: "clamp(2.5rem, 4.8vw, 4.25rem)"
    fontWeight: 700
    lineHeight: 1.12
    letterSpacing: "-0.025em"
  pickup-headline:
    fontFamily: "Playfair Display, Georgia, serif"
    fontSize: "clamp(1.9rem, 3vw, 2.7rem)"
    fontWeight: 700
    lineHeight: 1.12
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Barlow, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.65
  pickup-body:
    fontFamily: "Barlow, sans-serif"
    fontSize: "18px"
    fontWeight: 400
    lineHeight: 1.55
  pickup-label:
    fontFamily: "Barlow Condensed, Barlow, sans-serif"
    fontSize: "20px"
    fontWeight: 700
    lineHeight: 1.3
  pickup-note:
    fontFamily: "Barlow, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  control: "4px"
  incumbent-card: "6px"
spacing:
  small: "12px"
  compact: "16px"
  medium: "24px"
  large: "32px"
  generous: "40px"
components:
  button-primary:
    backgroundColor: "{colors.gold}"
    textColor: "{colors.navy}"
    rounded: "{rounded.control}"
    padding: "18px 36px"
  button-primary-hover:
    backgroundColor: "{colors.gold-press}"
  button-primary-active:
    backgroundColor: "{colors.gold-deep}"
  pickup-button:
    backgroundColor: "{colors.gold}"
    textColor: "{colors.navy}"
    rounded: "{rounded.control}"
    padding: "16px 20px"
    width: "100%"
  pickup-button-hover:
    backgroundColor: "{colors.gold-hover}"
  pickup-button-active:
    backgroundColor: "{colors.gold-press}"
  pickup-input:
    backgroundColor: "{colors.white}"
    textColor: "{colors.navy}"
    rounded: "{rounded.control}"
    padding: "12px 16px"
    width: "100%"
  pickup-text-button:
    textColor: "{colors.liquid}"
    padding: "12px 0"
---

# Design System: Downtown Pour Collective

## Overview

**Creative North Star: "A clear invitation to return"**

DPC's existing web identity pairs a deep navy and warm cream foundation with aged gold, substantial serif headlines, and direct condensed controls. The pickup surface carries that identity into a brief counter-side task: an open cream form, a compact existing brand mark, and a navy information section.

This record describes the incumbent identity and the completed pickup extension. It does not replace the landing-page composition or establish a new brand direction. `index.html` and `DESIGN_HANDOFF.md` remain the incumbent visual authority; the new surface is evidenced by `glass-pickup.html`, its styles and script, and the four screenshots in `.impeccable/review/`. Product rules remain in `PRODUCT.md`.

**Key Characteristics:**

- Navy and cream section fields with aged gold action accents.
- Playfair Display hierarchy, Barlow reading text, Barlow Condensed controls.
- Flat surfaces, restrained outlines, and modest control corners.
- A compact form that becomes an equally legible confirmation.

## Colors

Warm cream and aged gold soften the deep navy foundation; liquid blue supports controls and quieter structural detail.

### Primary

- **Navy:** dark section backgrounds and readable text on cream.
- **Aged Gold:** primary action fill and selected section headings; its hover and pressed shades belong to the documented component variants.

### Secondary

- **Liquid Blue:** incumbent card fills and pickup focus, checkbox, confirmation mark, and secondary action color.

### Neutral

- **Cream:** light section backgrounds and text on navy.
- **White:** the pickup email field surface and incumbent emphasis.
- **Soft Ink:** pickup helper text, availability, privacy notes, and courtesy copy on cream.

**The Section Contrast Rule.** Use navy text on cream and cream text on navy. Keep helper colors appropriate to their section; pickup's dark information section explicitly lightens its secondary text.

## Typography

**Display Font:** Playfair Display with Georgia and serif fallbacks.
**Body Font:** Barlow with the surface's existing sans-serif fallbacks.
**Control Font:** Barlow Condensed with the surface's existing sans-serif fallbacks.

The pairing combines a substantial editorial heading with efficient labels and relaxed reading text. Frontmatter names beginning with `pickup-` are scoped extensions, not replacements for the incumbent hierarchy. The pickup page serves these three families from same-origin font files in `assets/glass-fonts.v1.css`; the incumbent page loads its fonts through Google Fonts.

### Hierarchy

- **Display:** the incumbent landing hero's large serif role.
- **Pickup display:** fluid serif sizing for the page purpose and post-submit headline.
- **Pickup headline:** a smaller fluid serif role for confirmation and the return-visit section.
- **Body:** the incumbent reading baseline; **pickup body** is slightly larger for the short task.
- **Pickup label:** condensed field labels and information-section headings.
- **Pickup note:** subordinate explanations that remain readable beside form controls.

Paragraphs use bounded line lengths. Pickup body paragraphs cap at 70 characters; the desktop introduction narrows to 31 characters. The legal privacy strip preserves its existing system-sans treatment as a shared utility, not a new brand display face.

**The Three Roles Rule.** Use Playfair Display for hierarchy, Barlow for reading, and Barlow Condensed for task labels and actions.

## Layout

The incumbent site uses centered content containers, generous vertical space, and alternating navy and cream sections. Its recurring maximum content width is 1100px, with spacing predominantly on a four-pixel rhythm.

The pickup extension uses that 1100px maximum with 32px desktop side padding. Its purpose and form occupy equal columns separated by 80px. The masthead has a 1160px maximum; its extra width frames the same content. The return-visit section follows the same two-column alignment.

At 767px and below, pickup stacks purpose before form, uses 24px side padding and a 24px section gap, and stacks the return-visit content. Form controls keep full available width. This compact mobile arrangement is specific to the pickup task; it does not replace the incumbent full-height landing hero. Footer navigation wraps naturally.

## Elevation & Depth

The inspected landing and pickup styles use tonal sections and fine borders instead of box shadows. Liquid-blue cards separate content on the incumbent landing page. Pickup keeps its form directly on cream rather than adding a floating card. Fine masthead and schedule rules organize content without simulated elevation.

**The Flat Surface Rule.** Preserve the existing flat surfaces and use contrast, spacing, and fine rules to establish hierarchy.

## Shapes

Controls have modest rounded corners, as recorded in frontmatter. Incumbent content tiles commonly use the slightly larger card radius; individual legacy components retain their own source values. Pickup uses rectangular fields and buttons, a native square checkbox, and a thin circular SVG success mark. The existing DPC seal remains an identity asset, not a reason to make form controls circular.

## Components

### Buttons

Gold actions are clear and substantial. The incumbent primary button uses uppercase condensed text with tracked lettering and a small active-state scale. Pickup's full-width primary action uses sentence case and larger condensed text, with a 56px minimum height. Its hover and active colors differ from the incumbent variant and are recorded separately.

Pickup's secondary actions are underlined text buttons with a 44px minimum height. Its keyboard focus is a 3px liquid-blue outline offset by 5px; the footer switches that outline to gold on navy. Disabled submission uses a muted fill and visible progress wording.

### Cards / Containers

Incumbent cards use liquid-blue fills or fine gold-toned borders, generous padding, and no shadow. Preserve their existing local variants. Pickup's form and confirmation use an open section without a card wrapper; the tasting schedule uses ruled rows with tabular numerals.

### Inputs / Fields

Pickup's email field is white with a visible single-pixel border, 56px minimum height, and the shared control radius. The label sits above it and helper text below. Keyboard focus uses the page outline. Optional marketing uses the browser checkbox with liquid-blue accent and a directly adjacent explanation. A native disclosure holds the earlier-preference explanation.

Form errors appear in a bordered inline notice. Loading, unavailable, submitting, and successful states use explicit text; color alone does not communicate the result.

### Navigation

The pickup masthead pairs the existing seal and condensed DPC wordmark with an underlined assistance link. A keyboard-visible skip link precedes it. The navy footer uses wrapping, underlined legal and support links and the existing privacy strip.

### Confirmation

After the successful durable submission response, the form is replaced by a thin circular check, a serif confirmation heading, and a prominent next action. The heading receives focus. A short opacity/clip reveal lasts 400ms with `cubic-bezier(.16,1,.3,1)`; reduced-motion preferences remove it. This is a functional result state, not a decorative badge system.

## Do's and Don'ts

### Do:

- **Do** extend the existing navy, cream, aged-gold, and three-family identity.
- **Do** preserve distinct incumbent and pickup component variants.
- **Do** keep labels, helper text, keyboard focus, and progress states visible and readable.
- **Do** use the existing brand assets and source-grounded imagery.

### Don't:

- **Don't** use this pickup layout as a mandate to redesign existing landing pages.
- **Don't** substitute invented event-glass photography for an unavailable source asset.
- **Don't** promote legacy decorative kickers or eyebrow labels into reusable guidance.
- **Don't** turn campaign-specific content or timing into global design rules.

Not canonized: incumbent decorative eyebrows and kickers are legacy craft-floor defects to avoid carrying forward. One-off border colors, individual card radii, and campaign dates remain local implementation details. No global typography or layout redesign is implied by this record.
