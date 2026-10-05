# The Glass Comes Back: public event page

This independent slice adds `/glass-comes-back` as advance information for LDI to share. It explains the
five 2026 tasting dates, four restaurants, dining/glass requirements, universal
glass pickup, optional marketing, and paper fallback. Nick's September 25 update
lets tasting guests receive a glass from their server after only the restaurant
check-in, without a separate pickup submission. It links to
the already-live `/glass-pickup` flow. Guest content works without JavaScript.

The approved fixed restaurant routes remain:

- `/glass-comes-back/demitris-taverna`
- `/glass-comes-back/swirl-on-the-square`
- `/glass-comes-back/calamari-bistro-bar`
- `/glass-comes-back/l-campo`

Those forms belong to the next slice. A visible readiness notice says restaurant
check-in is being prepared, and instructions are explicitly for a tasting date.
The page does not link guests to unimplemented routes. The notice is also visible
without JavaScript; the live pickup link is available now.

## Boundaries

- No pickup code, data contract, migration, server endpoint, environment flag or
  existing shared asset changes. The page reuses the unchanged local brand fonts,
  pickup base CSS and privacy controls; additional CSS is scoped to `gc-*` classes.
- No contact collection, analytics, Meta activation, automatic email or membership/
  financial mutation. No cross-module imports are introduced by the feature.
- Dates are static, explicitly labeled 2026, so the invitation remains readable
  without JavaScript or a backend. Browser checks compare its machine-readable
  dates to the server campaign schedule and verify weekdays, preventing drift.
  The event page does not determine eligibility; that belongs to server-enforced
  tasting check-in. A local script derives the last date from the calendar and
  shows an ended message after October 14 in America/Los_Angeles. It hides tasting
  instructions and preserves pickup, historical dates and restaurants. It uses
  the visitor's clock, makes no requests and reads no contact or storage data.
  Without JavaScript, the explicit 2026 dates remain readable.
- Existing member-count disclosure checks include the new page. CI path filters
  include its HTML and versioned assets. Shared-link metadata uses the existing
  DPC image, not a third-party image or tracking request.

## Release checklist

1. After review and release approval, merge and confirm the main-branch deployment
   is Ready. No migration, new environment flag or database setup is required.
2. Verify `/glass-comes-back` on the public domain at desktop and phone widths:
   readiness notice, five dates, four restaurants, pickup link and privacy/support
   links. Check the shared-link image resolves. Do not create production test data.
3. Before the first tasting on September 29, verify all four restaurant check-ins
   are live, their exact QR cards are printed and at the restaurants, and staff
   have the paper fallback. Paper readiness has not yet been demonstrated.
4. Remove the preparation notice only after those checks pass. Tasting release
   checks must cover one normalized email per restaurant per eligible Pacific
   date, optional initially checked marketing, unchecked submission, preserved
   prior opt-out, no email verification, and a server-provided glass during the
   same tasting visit without a separate pickup submission. The public rule is
   once per person, restaurant and eligible day; unverified email cannot prove
   personhood or whether staff already served a tasting.
5. After the last tasting, verify the ended state and continuing glass pickup.
   Update the static invitation to archival wording too, for guests without
   JavaScript and social previews that do not execute scripts.

Publishing this advance-information page does not establish that restaurant
check-in or paper operations are ready. Their release evidence belongs to the
tasting and restaurant-handoff slices.
