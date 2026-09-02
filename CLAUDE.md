# Claude session preferences

- When giving Brandi text meant to be copied and sent somewhere else (a reply
  to a reviewer, an email draft, a Slack/GitHub comment, a support message),
  always put the full text inside a fenced code block (```text) so the UI
  shows a one-click copy button. Prose around it is fine; the copyable payload
  itself goes in the block.

# Business rules (do not break)

- **The number of members is never published. Ever.** No active count, no
  remaining-spots figure, no "join N others", no founding-class size, on the
  site, in press, in social copy, or in anything drafted for external use.
  Membership size is an internal figure only. If asked to add social proof,
  use member quotes or partner count, never a headcount. Enforced by
  `scripts/test-release-readiness.mjs` across every public page.

# Project notes

- Static marketing site + Vercel serverless functions (`api/`). No framework,
  no build step. Node >= 20, ES modules.
- `npm test` runs the offline endpoint tests in `scripts/test-*.mjs` — no
  credentials or network needed (Stripe mocked at `node:https`,
  Resend/Supabase at `fetch`). Run it before pushing changes to `api/`.
- The Resend v4 SDK does not throw on API errors — it resolves with
  `{ data, error }`. Always check `result.error` explicitly.
- Ops/monitoring docs live in DEPLOY.md §2b–2d (webhook, dashboard, health
  cron). Business days are Pacific time (Livermore, CA).
