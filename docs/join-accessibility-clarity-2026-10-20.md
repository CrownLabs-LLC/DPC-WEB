# Join accessibility and clarity corrections

October 20, 2026. Local `codex/homepage-rebuild` preview.

Brandi authorized the Join fixes from the final Home/Events/Join review and
asked to preserve the current design. This pass changes Join CSS, explanatory
copy and search/share descriptions. Its original logo, Circle icons, panel
layout, typography, prices and checkout script blocks are preserved.
Home and Events UI files were not edited in this pass.

## Corrections

- Added a compact membership recap before the form: up to five Membership
  Pours per membership month at assigned venues, an eligible standard drink
  definition, venue-specific availability and monthly expiry without rollover.
- Added a native disclosure for redemption hours, blackout dates and excluded
  premium/specialty selections, plus a link to the existing Home FAQ.
- Qualified the search, Open Graph and Twitter descriptions with “up to five.”
- Replaced faint control boundaries with a muted gold token and faint focus
  outlines with cream. Keyboard focus remains visually distinct from gold
  selection borders and the selected background.
- Improved annual-price notes and footer copyright contrast. Input focus no
  longer suppresses its visible keyboard outline.

The language reuses the approved Home rules. No new membership benefit or
cancellation mechanism is asserted.

## Verification

| Check | Result |
| --- | --- |
| Text-field and Circle/billing borders | At least **4.32:1** against adjacent surfaces, above the 3:1 target |
| Circle, billing and text-input keyboard focus | **13.56:1** against their panel; visible cream outline |
| Selected Circle annual price note | **5.68:1**, above the 4.5:1 target; unselected **6.84:1** |
| Footer copyright | **7.07:1**, above the 4.5:1 target |
| Responsive layout | No document overflow at **320, 390, 768 and 1280px**, including the open disclosure |
| Keyboard | Enter opens/closes details; arrows change Circle/billing selection; Tab reaches fields with visible focus |
| Eligibility explanation | Visible before personal-data fields; Home FAQ destination exists |
| Existing automated browser suites | **96/96 passed**, desktop Chromium, mobile Chromium and mobile WebKit, one worker |
| Repository offline checks | `npm test` passed all 15 configured scripts |
| Static checks | Release-readiness check and `git diff --check` passed |

Contrast values come from rendered computed styles with ancestor alpha
compositing. Evidence includes selected/unselected cards, a hovered unselected
Circle, annual/monthly focus, text-field focus and expanded disclosure states.
This is a focused correction verification, not a claim of full WCAG conformance.

Commands:

```sh
npm test
npx playwright test tests/e2e/optional-welcome-kit.spec.mjs tests/e2e/checkout-navigation.spec.mjs --workers=1 --reporter=line
node scripts/test-release-readiness.mjs
git diff --check
```

The 96-case run passed on its first attempt. It does not explain or erase the
earlier review's intermittent WebKit failures under three workers. Final CI,
hosted integration, physical-device testing, VoiceOver and 200% text resizing
remain in the launch checklist.

Impeccable's source detector returned the same **29 advisories** as the prior
Join review: 26 type-size and 3 color entries. Its HTML parser dependencies
remain unavailable, so the run exited 2 in degraded regex mode and did not
compute contrast. Existing Join typography and SVG logo styling were retained;
browser measurements above provide the contrast evidence. No dependencies
were installed for this correction.

Evidence directory: `.impeccable/review/join-fixes-2026-10-20/`

- `browser-evidence.json`
- `join-desktop.jpg`, `join-mobile-top.jpg`, `join-mobile.jpg`,
  `join-320.jpg`, `join-circle-focus.jpg`
- `checkout-tests.log`, `npm-test.log`, `detector.json`

Final `join.html` SHA-256:
`5e2841858f4eda7303536109a4385721193c172e463bdad2d151ac357b41812b`.

The local static server cannot load `/api/legal-versions`; the visible
fail-closed message is expected here. Automated checkout tests mock provider
responses. No real payment, membership cancellation, email send or deployment
occurred.

## Nick's updates

The [launch checklist](website-launch-checklist.md) and
[photo manifest](homepage-assets.md) now record the October 20 ribbon-photo
delivery and Meli Miller's website permission with attribution. Attachment
matching/inspection, image replacement and separate Chamber confirmation
remain open. The originals and photographer permission should not be
requested again.

Subsequent update: Brandi authorized photo replacement later on October 20.
Both clean originals are now installed with credit; the current status is in
the photo manifest and launch checklist. The paragraph above records the
state at the conclusion of the Join correction.

Nick's separate forwarded membership feedback identifies cancellation
discoverability and venue eligibility confusion. Join's clearer explanation
addresses purchase expectations; verifying the cancellation route and venue
guidance remains an app/support follow-up. Personal member details were not
copied into the website or this record.
