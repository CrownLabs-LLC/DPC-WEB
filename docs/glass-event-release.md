# The Glass Comes Back: public event page

This independent slice adds `/glass-comes-back` for LDI to share. It explains the
five 2026 tasting dates, four restaurants, dining/glass requirements, separate
pickup and tasting check-ins, optional marketing, and paper fallback. It links to
the already-live `/glass-pickup` flow. Guest content works without JavaScript.

The approved fixed restaurant routes remain:

- `/glass-comes-back/demitris-taverna`
- `/glass-comes-back/swirl-on-the-square`
- `/glass-comes-back/calamari-bistro-bar`
- `/glass-comes-back/l-campo`

Those forms belong to the next slice. This page names the restaurants and
explains at-table QR use; it does not link guests to unimplemented routes.

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
  tasting check-in. Its dated content can remain as an archive after the event.
- Existing member-count disclosure checks include the new page. CI path filters
  include both its HTML and versioned stylesheet.

## Review and release

Review this slice independently from main after pickup PR #60. It needs no
database setup or production credentials. Run the repository offline checks,
applicable desktop/phone browser checks, and `git diff --check`. The required
TypeScript invocation is not applicable to this JavaScript repository without a
tsconfig; report its real result. DB-backed code is unchanged, so no new database
verification is required for this slice (CI still runs its existing DB job).

Obtain Brandi's required approval before opening the PR, then human review/merge
and the corresponding release authorization. Do not publish locally. The
already-completed pickup release approvals do not authorize this page's release.
After authorized deployment, verify `/glass-comes-back`, its pickup link, and
privacy/support links on the public domain. Do not create production test data.
