# Plan: DPC Operations Alert Routing and Escalation

> Source: Brandi's September 2, 2026 request to remove Nick from operational
> alert triage, followed by Codex and Claude architecture review.
>
> Status: Revised draft after Claude review. This plan does not authorize a
> production deployment, provider configuration, PagerDuty activation, or a
> synthetic production page.

## Executive summary

The current DPC-WEB `/api/health-check` detects useful production problems
every five minutes, but combines every paging problem into one generic email,
sends it to Nick and `hello@downtownpourcollective.com`, and suppresses an
unchanged problem set for six hours. `hello@downtownpourcollective.com` routes
to Nick. This requires Nick to interpret and forward alerts, provides no
acknowledgement or escalation, and makes silence ambiguous.

Replace that path in stages:

```text
Vercel health check
  -> classify each stable problem key
  -> record opened / repeated / escalated / recovered transitions
  -> page SEV-0 through PagerDuty Events API v2
  -> email Brandi directly for SEV-1
  -> include SEV-2 and warnings in one conditional daily digest

Independent Sentry Cron monitor
  -> page through PagerDuty when the health check itself stops reporting
```

Nick and `hello@downtownpourcollective.com` must not receive operational
alerts, escalations, recoveries, or digests. Brandi is the primary operational
recipient. Her approved Crown Labs address may be stored as a Vercel
operational-recipient setting and in PagerDuty. Her SMS number must be stored
only as a verified PagerDuty contact method and, if needed, in the approved
password manager; it must never appear in source control, Vercel settings,
logs, Sentry, PagerDuty event payloads, screenshots, tickets, or test fixtures.

Accepted residual: `hello@downtownpourcollective.com` remains a sender or reply
identity for some member-facing mail, including founding-deposit welcome paths.
Member replies about an outage may therefore still reach Nick. This plan
removes Nick from technical triage, classification, forwarding, and operational
escalation; it does not remove him from every form of business awareness.

## Goals

- Remove Nick from operational detection, triage, forwarding, and escalation.
- Tell Brandi whether an alert requires immediate action without requiring her
  to open the dashboard first.
- Deliver urgent incidents by PagerDuty SMS, with acknowledgement and repeated
  escalation until acknowledged.
- Distinguish new, continuing, escalated, acknowledged, and recovered incidents.
- Detect a stopped, overlong, or misconfigured health-check cron.
- Reduce benign interruptions without hiding prolonged or worsening failures.
- Preserve DPC's privacy and financial-integrity constraints.

## Non-goals

- Changing partner-intake, founding-deposit, member-welcome, or other business
  notification recipients. Those paths require a separate business decision.
- Automatically replaying Stripe events or changing Stripe, membership, credit,
  ledger, payout, legal-version, or other production business state.
- Building a general incident-management application inside the DPC dashboard.
- Sending member contact data, payment details, raw provider payloads,
  credentials, tokens, or arbitrary database error text to notification vendors.
- Treating one transient dependency timeout as proof of a member-facing outage.
- Monitoring the in-app member experience. This checker observes the marketing
  site and checkout path only; redemption, Pour visibility, issuance, and app
  authentication monitoring remain separate, currently unscheduled work.

## Current-state findings

- `/api/health-check` runs from a Vercel cron every five minutes.
- Operational recipients fall back to `NOTIFY_DEPOSIT_TO` and then to a literal
  Nick-plus-`hello@` list, coupling escalation to a business notification.
- `ALERT_FROM` also defaults to `hello@downtownpourcollective.com`, so replies,
  bounces, and complaint mail can reach Nick even when `ALERT_TO` is corrected.
- Problems already have stable keys, while human-readable text carries
  run-specific detail.
- The current fingerprint hashes the complete active key set rather than
  assigning one identity to each problem key.
- An identical combined fingerprint is suppressed for six hours.
- The subject reports only a problem count and contains no severity, affected
  capability, or action deadline.
- Warnings appear in the health-check response and dashboard but are not sent
  in a digest.
- No recovery notification is sent.
- Two Supabase subqueries, for `webhook_logs` and `site_events`, end in
  `.catch(console.error)` and push no result. Because the collector builds its
  result by pushing failures, a thrown subquery is indistinguishable from a
  healthy result.
- The `webhook_errors` query uses `limit=5`, so its reported count saturates at
  five and cannot support a count-based threshold. It also filters only on
  `level='error'`, not the Stripe-webhook source, so unrelated operational
  bookkeeping could poison the signal.
- If the Vercel cron stops, the deployment loses `CRON_SECRET`, or execution
  fails before monitoring completes, the existing email path cannot reliably
  announce that monitoring is blind.
- Resend is both a checked dependency and the only notification path, so a
  Resend credential or provider failure can disable its own alert.
- Sentry is not currently used by DPC-WEB: this repository has no Sentry
  dependency, DSN setting, or Sentry code. DPC uses Sentry in the Expo app and
  Cloudflare OTP monitor. Using it for DPC-WEB Cron check-ins is new repository
  scope, though not a new DPC vendor.

## Resolved architectural decisions

- **Severity vocabulary:** Reuse DPC's `SEV-0`, `SEV-1`, and `SEV-2`
  vocabulary, with SEV-0 most urgent. Do not introduce a parallel P1/P2 scale.
- **Incident identity:** Each stable problem key is independent and namespaced,
  for example `dpc-web:production:checkout-canary:cors`.
- **State-independent deduplication:** A PagerDuty `dedup_key` is derived only
  from the literal system name, environment, and stable problem key. Computing
  it must not read Supabase or mutable incident state.
- **Impact-aware classification:** A reviewed policy registry supplies the
  default severity, title, capability, runbook, thresholds, and route. Aggregate
  checks may change severity using count, age, event type, consecutive failures,
  and genuinely independent corroboration.
- **Dependency classes:** Corroboration requires agreement from different
  dependency classes: (1) Vercel HTTP edge, (2) Supabase REST, (3) Stripe API,
  or (4) member-signal tables. Legal-version, join-page, and checkout canaries
  are not mutually independent merely because they use different URLs; all use
  the Vercel/HTTP path, and multiple probes share the Supabase Functions host.
- **Observation state:** Every check returns `healthy`, `unhealthy`, or
  `unknown`. Absence of a pushed problem is never evidence of health. An
  unknown observation cannot resolve the underlying business incident.
- **Sustained unknown:** After the reviewed number of consecutive unknown
  results, open a separate SEV-1 `monitoring:<key>:unknown` degradation
  incident. Keep the underlying business incident open. Include both in the
  daily digest until recovery or disposition.
- **State:** Maintain small, service-role-only mutable state for each incident's
  observations and transitions. Continue using `webhook_logs` as an append-only
  operational timeline, not acknowledgement state.
- **State-store failure:** When incident state cannot be read or written,
  degrade to stateless immediate delivery. Duplicate alerts are acceptable;
  silence is not. Emit no recoveries and open/log
  `monitoring:state-store-unavailable`. A Supabase outage therefore produces
  the underlying SEV-0 observation, the stateless-delivery path, and the
  monitoring-degradation observation. The existing `supabaseDown` short-
  circuit around the throttle read is the precedent: do not spend the runtime
  budget consulting a dependency already known to be unavailable.
- **Table ownership:** The incident-state migration belongs in the DPC
  repository's `supabase/migrations/` ledger, not DPC-WEB `db/*.sql`, so
  migration drift checks cover it. RLS is deny-all and DPC-WEB writes with the
  service role only. Document the table in `DPC_Schema_RLS_Spec.md` as an
  operational table explicitly outside the 15-module business-table map. The
  schema/spec change and DPC-WEB consumer change ship as separate repository
  slices; the consumer must not deploy before the schema slice is merged and
  applied.
- **Concurrency:** Reconcile each key through one conditional upsert carrying a
  compare-and-swap guard on current state. Notify only when that invocation wins
  the transition. Do not add advisory locks or a general reconciliation RPC.
  PagerDuty deduplication is a second defense.
- **Vendor boundary:** Keep the existing Sentry account and add only plain HTTP
  Cron check-ins from DPC-WEB; do not add `@sentry/node`. The dashboard and
  `webhook_logs` remain the business-health evidence surfaces. Use PagerDuty
  Events API v2 directly for health-check incident trigger/update/resolve, so
  lifecycle follows observed health rather than Sentry issue state. Use the
  native Sentry-to-PagerDuty integration only for the Cron monitor, whose signal
  Sentry owns.
- **Vendor choice:** Use Sentry plus PagerDuty rather than introduce Better
  Stack or healthchecks.io. This reuses DPC's Sentry account and satisfies
  Brandi's requirement for SMS and acknowledgement. Revisit consolidation only
  if operating cost or reliability evidence warrants it.
- **Delivery:** PagerDuty is the source of truth for SEV-0 delivery and
  acknowledgement. Resend carries SEV-1 email and the conditional SEV-2 daily
  digest. Sentry is load-bearing only for Cron liveness and max-runtime alerts.
- **Recipients:** Operational email goes directly to Brandi's approved Crown
  Labs address. Nick, `hello@`, and business-recipient variables are prohibited
  from the operational route.
- **Sender and replies:** `ALERT_FROM` and explicit `reply_to` values are
  ops-only identities. Neither may default or resolve to Nick or `hello@`.
- **Contact privacy:** Brandi's SMS number exists only as a verified PagerDuty
  contact method; it is not a repository or Vercel value.
- **Escalation:** Nick is not an escalation target. Until a technical backup is
  appointed, PagerDuty repeats unacknowledged SEV-0 notifications to Brandi.
  This accepts that an overnight incident may remain unhandled until she
  responds. Codex is not an escalation target because it has no guaranteed
  persistent presence.
- **No dangerous remediation:** Automation may classify, collect allowlisted
  evidence, notify, deduplicate, acknowledge, and resolve. Business or financial
  mutation remains explicitly authorized, runbook-driven work.

## Notification payload allowlist

Outbound Resend, Sentry, and PagerDuty payloads are built from an allowlist,
not by redacting arbitrary input. They may contain only:

- policy-supplied title and capability;
- integer counts;
- ISO-8601 durations and timestamps;
- reviewed, enumerated Stripe event types;
- runbook identifier;
- dashboard URL; and
- provider identifiers matching
  `^(evt|cs|sub|cus|pi)_[A-Za-z0-9]{6,}$`.

No free-text passthrough from provider responses, caught exceptions, database
messages, or `webhook_logs.message` reaches Resend, Sentry, or PagerDuty. Such
text may remain in access-controlled Vercel logs, `webhook_logs`, and the
dashboard under their existing retention and access controls. In particular,
the current interpolation of `recentErrors[0].message` into alert text must be
removed before structured routing ships.

## Execution budget

The current function documents an approximately 12-second bounded worst case in
a 30-second Vercel `maxDuration`. Per-key notification fan-out must not multiply
serial wall time by the number of active incidents.

The health-check execution contract is:

1. authenticate the production cron invocation;
2. launch the in-progress Cron check-in with a short timeout, without blocking
   observation gathering;
3. gather explicit observations concurrently;
4. append the Phase 2A per-run observation record;
5. from Phase 4 onward, reconcile incident state;
6. send the OK Cron check-in;
7. fan out transition notifications concurrently with `Promise.allSettled`;
8. return a diagnostic response.

Before Phase 4, there is no reconciliation step. The OK check-in follows
gathering and the attempted Phase 2A observation append. From Phase 4 onward,
it follows gathering and reconciliation. The OK check-in attests that the
checker ran; it does not attest that email or PagerDuty delivery succeeded. A
delivery failure opens/logs its own monitoring incident and invokes the
alternate delivery path.

The in-progress check-in exists to enable max-runtime detection. It is
best-effort and off the critical path: Sentry slowness or failure cannot delay
gathering or fail the health-check invocation. The OK check-in remains the
liveness signal.

| Phase | Maximum budget |
| --- | ---: |
| Authentication plus in-progress check-in launch | 0.25 seconds |
| Concurrent observation gathering | 5.5 seconds |
| Per-run observation append | 2 seconds |
| Incident-state reconciliation, reserved until Phase 4 | 2.5 seconds |
| OK/error check-in | 1.5 seconds |
| Concurrent notification fan-out | 4 seconds |
| Final logging and response | 1.5 seconds |
| **Immediate-tranche bound** | **14.75 seconds** |
| **Phase 4 planned bound** | **17.25 seconds** |

Outbound transitions are prioritized by severity, capped per run, and overflow
is represented by one allowlisted summary transition. The cap must never drop a
SEV-0 open/escalation in favor of a lower-severity update. A published budget
table, per-call timeouts, and a worst-case wall-clock test with multiple
simultaneous incidents are release gates. Without this constraint, a multi-key
outage could exceed `maxDuration`, skip the OK check-in, and add a false
monitoring-blind page to the real incident.

## Initial severity policy

Threshold changes after staging are reviewed policy changes.

### SEV-0 — urgent access, money, integrity, or monitoring failure

- Live Stripe key missing, rejected, or test-mode.
- Stripe webhook signing secret missing.
- Production checkout contract deterministically invalid: incomplete legal
  tuple, wrong checkout validation response, or invalid CORS contract.
- Checkout surface unavailable on two consecutive runs, or one run plus
  corroboration from a different dependency class.
- Multiple checkout handoffs stalled and a different-class signal corroborates
  member impact.
- Supabase is unreachable. This is treated as an app-wide member outage because
  authentication, redemption, Pour visibility, and issuance depend on it even
  if website checkout canaries pass.
- Undelivered access-changing or money-sensitive Stripe events beyond their
  reviewed grace period.
- Broad webhook failure or evidence of incorrect membership/payment projection.
- Cron monitor missed, error, or max-runtime alert.
- Possible ledger, audit, payout, or financial-document integrity loss. The
  checker pages but never attempts repair.

The initial access-changing/money-sensitive Stripe allowlist is:

- `checkout.session.completed`
- `checkout.session.async_payment_failed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.payment_failed`
- `invoice.paid`
- `charge.refunded`
- `charge.dispute.created`

Any event type outside this list is SEV-2 by default. Changing the list requires
review of the Stripe subscriptions configured for the production endpoint and
a recorded policy update.

Target: acknowledge within 10 minutes and begin the linked runbook.

### SEV-1 — degraded production capability requiring same-day action

- First uncorroborated network timeout for a checkout-critical probe, before it
  meets the SEV-0 consecutive-failure threshold.
- One confirmed webhook processing error without broad impact. Until the
  underlying query returns an exact count, presence—not count—drives SEV-1.
- Sustained Resend credential rejection or missing Resend API key.
- Missing Supabase configuration required for operational evidence but not the
  production app itself.
- Repeated checkout stalls below the cross-class SEV-0 threshold.
- Sustained unknown observations for any authoritative check.

Target: direct notification to Brandi, acknowledgement during DPC operating
hours, and resolution or documented disposition that business day.

### SEV-2 — informational, isolated, or nonurgent degradation

- One isolated checkout-stall signal with healthy canaries.
- Resend timeout, provider 5xx, or rate limit below its sustained threshold.
- Missing audience-sync configuration while member-facing delivery remains
  healthy.
- Diagnostic subquery unavailable while its authoritative business canary is
  healthy, before the sustained-unknown threshold.
- Undelivered Stripe event type not on the reviewed sensitive-event allowlist.
- Staging-only failures and expected unsupported-event noise.

Target: dashboard visibility and a conditional daily digest; no page.

## Immediate delivery order

The first production change set is intentionally smaller than the full design:

1. Phase 1 — remove Nick/`hello@` and decouple operational recipients.
2. Phase 2A — add explicit per-run evidence, severity-led subjects, and
   30-minute-or-faster SEV-0 reminders to the existing direct email path.
3. Phase 2B — detect stale observation evidence and close the write-only fault
   blind spot without adding mutable incident state.
4. Phase 3 — add the independent Sentry Cron dead-man's switch.

This removes Nick and closes monitoring blindness without waiting for
PagerDuty procurement or per-key state. After 30 days of real incident data,
review frequency, false positives, and actual key distribution before building
the stateful PagerDuty and digest phases. PagerDuty account setup and contact
verification may proceed during the observation period, but do not implement
speculative thresholds without the review.

## Phase 1: Decouple and correct operational recipients

**User stories:** Brandi receives DPC operational notices directly. Nick no
longer interprets or forwards technical alerts.

### What to build

Separate operational recipients from founding-deposit and other business-email
recipients. Remove hardcoded operational addresses and the fallback from the
ops recipient variable to the deposit recipient variable. Configure Brandi's
approved Crown Labs email as the sole initial operational email recipient in
Vercel Production. Configure an ops-only sender and explicit reply-to identity.

Update deployment documentation, environment examples, and tests so a later
deployment cannot silently restore Nick or `hello@`. Scope readiness assertions
to operational variables only: legitimate partner-intake values such as
`NOTIFY_TO` or `AUTOACK_REPLY_TO` are outside this plan and must not fail the
ops-recipient test.

### Acceptance criteria

- [ ] Production `ALERT_TO` contains Brandi's approved Crown Labs email only.
- [ ] Operational code does not reference or fall back to
      `NOTIFY_DEPOSIT_TO`.
- [ ] Setting only `NOTIFY_DEPOSIT_TO` cannot activate operational delivery.
- [ ] No operational default contains Nick or `hello@`.
- [ ] `ALERT_FROM` and explicit `reply_to` are ops-only; neither resolves to
      Nick or `hello@`.
- [ ] Missing production ops-recipient configuration is a release-readiness
      failure and cannot silently select a business recipient.
- [ ] Deployment docs no longer describe Nick plus `hello@` as the health-alert
      default, and environment examples do not imply an ops/deposit fallback.
- [ ] A test ops email reaches Brandi and reaches neither Nick nor `hello@`.
- [ ] Founding-deposit and partner-intake recipient behavior is unchanged.
- [ ] Repository, test output, and deployment evidence contain no SMS number.

---

## Phase 2A: Add evidence, verdicts, and urgent reminders

**User stories:** Brandi can understand urgency and affected capability from
the subject without opening the dashboard. Operators can measure every check,
including throttled and unknown results, during the scope-gate period. An
active SEV-0 cannot remain silent for six hours.

### What to build

Convert each check to return an explicit `healthy`, `unhealthy`, or `unknown`
observation. Replace the two swallowed Supabase subquery failures so a thrown
query records `unknown`, never an implied healthy result. Add the policy-
supplied severity, capability, and verdict to the current email path without
yet adding mutable incident-state persistence:

```text
[SEV-0][PROD][CHECKOUT] Legal-version contract invalid — acknowledge now
[SEV-1][PROD][WEBHOOK] Webhook processing error — review today
[SEV-2][PROD][EMAIL] Resend provider timeout — dashboard only
```

When simultaneous problems have different severities, the subject leads with
the highest severity and states that additional findings exist. The body groups
allowlisted findings by severity. It never interpolates arbitrary provider,
exception, or database text.

On every authenticated production invocation, write exactly one append-only
`webhook_logs` row when Supabase is reachable, independent of alert delivery
or throttling. Pin this evidence row to
`source='health-check-observation'` and `level='info'`. Use a constant message
and an allowlisted `detail` payload containing the checked-at timestamp,
environment, each stable key with observation state and severity, and integer
phase timings. Write the row after the bounded notification phase so
`total_ms` is comparable across healthy, throttled, alerted, and alert-failed
runs; the database row timestamp captures time through arrival at the insert.
Calculate conservative 30-second-cap headroom from `total_ms` plus the bounded
observation-write allowance; the row timestamp delta is the arrival-time
cross-check.
One row contains the invocation's observation array; do not insert once per
key. A failed insert becomes visible as an explicit monitoring observation and
a coverage gap; it must not be mistaken for a successful sample. Persist any
coverage-gap bookkeeping under
`source='health-check-observation-gap'` and `level='info'`, never as a webhook
error. If the invocation already sent an incident email, do not send a second
email for its evidence-write failure. Otherwise notify statelessly; the alert
may repeat every five minutes while writes remain unavailable because the same
fault prevents a durable throttle marker.

Constrain the webhook-error probe to `source='stripe-webhook'` in Phase 2A.
Make the Stripe webhook writer set that source explicitly instead of relying
on the database default, and keep the dashboard query on the same boundary.
Treat this as a reviewed allowlist: adding another `webhook_logs` error writer
requires updating the writer, health probe, dashboard query, and contract test
together.
Phase 4 replaces its capped query with an exact count while retaining that
source boundary. Health-check evidence and coverage bookkeeping must never
feed the production-webhook error signal.

Keep the existing fingerprint suppression for SEV-1. Exempt any result set
containing SEV-0 from the flat six-hour window: send the first SEV-0 email
immediately and remind at least every 30 minutes while it remains observed.
This is an interim reminder policy, not the Phase 4 incident lifecycle.

### Acceptance criteria

- [ ] Every existing problem/warning key has a reviewed default severity or a
      safe SEV-1 fallback.
- [ ] Every check returns `healthy`, `unhealthy`, or `unknown`; a throwing
      subquery records unknown and cannot be interpreted as healthy.
- [ ] Every authenticated production run writes exactly one allowlisted
      observation row when Supabase is reachable, including healthy, throttled,
      and alert-failed runs.
- [ ] A failed observation append is explicitly reported and counted as a
      coverage gap, never as a successful sample.
- [ ] Evidence failure sends at most one email per invocation, including when
      the main incident path already sent but could not persist its marker.
- [ ] The record contains only timestamp, environment, stable key, observation
      state, severity, and integer timings; it contains no arbitrary text.
- [ ] Observation and coverage-gap rows use their pinned sources and
      `level='info'`; the webhook-error probe includes only
      `source='stripe-webhook'`.
- [ ] A regression test proves observation and coverage-gap rows cannot be
      counted by the webhook-error probe.
- [ ] The Stripe webhook writer sets `source='stripe-webhook'` explicitly, and
      tests keep it aligned with both readers.
- [ ] Thirty-day frequency, observed duration, unknown counts, and runtime
      percentiles are derivable from the per-run rows and recorded coverage.
- [ ] An unknown runtime environment fails noisy but cannot write evidence
      labeled as Production.
- [ ] Subjects contain severity, production environment, capability, and
      plain-language verdict.
- [ ] Mixed-severity alerts lead with the highest severity.
- [ ] An isolated checkout stall with healthy canaries does not claim checkout
      is unavailable.
- [ ] An active SEV-0 alerts immediately and repeats no more than 30 minutes
      after the previous successful alert while it remains observed.
- [ ] SEV-1 retains the existing suppression policy during the interim.
- [ ] Notification payload tests enforce the allowlist.
- [ ] The old generic `DPC ops alert: N problems detected` subject is absent,
      and a test proves it cannot be selected.

---

## Phase 2B: Detect observation coverage staleness

**User stories:** Operators can detect missing per-run evidence after a partial
database fault. An unrelated incident cannot consume the invocation's only
email while observation coverage silently disappears.

### What to build

On authenticated Production runs, query the newest prior row scoped to
`source='health-check-observation'` and `level='info'` before appending the
current invocation's evidence. The level filter uses the existing
`(level, ts DESC)` index. Treat a prior observation less than 15 minutes old as
healthy. Treat one at least 15 minutes old as a SEV-1
`monitoring:observation-stale` problem. This tolerates two missed five-minute
writes while detecting a sustained coverage gap.

Treat a failed freshness query or the absence of any prior observation as
SEV-2 `unknown`, never healthy or stale. A successful current invocation
establishes the first baseline without a false paging email. Keep the stale
verdict policy-supplied and allowlisted. When another incident is present,
include the stale finding in that single email instead of sending a second
message for the invocation.

Preview, Development, and unrecognized runtime environments must not query or
write Production observation evidence. Remove the implicit Production default
from the email helper and require every send path to pass its environment label
explicitly.

### Acceptance criteria

- [ ] The freshness query is scoped to `health-check-observation` rows at
      `level='info'` and can use the existing level/timestamp index.
- [ ] A prior row less than 15 minutes old records healthy and sends no email.
- [ ] A prior row at least 15 minutes old records a SEV-1 problem.
- [ ] A failed freshness query records SEV-2 unknown, never healthy or stale.
- [ ] No prior row records bootstrap unknown and a successful run writes the
      baseline without sending a stale alert.
- [ ] A write-only fault plus another incident sends at most one email, and a
      stale coverage finding is included when the prior row is old.
- [ ] Preview, Development, and unknown environments do not query Production
      observation history.
- [ ] Every alert send path supplies an explicit environment label; the helper
      has no default Production label.

---

## Phase 3: Add the independent Cron dead-man's switch

**User stories:** Brandi is notified when monitoring stops, even if the checker
cannot send ordinary alerts.

### What to build

Create an environment-scoped Sentry Cron monitor for the five-minute
production health check using Sentry's current Relay HTTP ingestion endpoint.
Store the complete generated endpoint as a Production-only environment value;
reject non-HTTPS, off-domain, query-bearing, or legacy endpoint shapes. Do not
add a Sentry SDK dependency. Upsert a five-minute UTC schedule with a 10-minute
post-schedule margin, one-minute max runtime, one-failure issue threshold, and
one-success recovery threshold. This tolerates two missed runs and detects the
gap 15 minutes after the last expected cadence.

After authenticating a real production cron invocation, launch the in-progress
check-in concurrently and retain its promise, but do not await it before
gathering. Give it a short timeout, handle its rejection, and settle it before
return so Sentry latency cannot consume the gathering budget or fail the run.
Before Phase 4, send OK after gather and the Phase 2A observation-append
attempt. From Phase 4 onward, send OK after gather and reconciliation. Send
error only when gather or the applicable reconciliation cannot complete.
Business problems do not make Cron execution itself erroneous.

Derive environment scope before sending any check-in. Preview and Development
send no Sentry Cron check-ins at all and never enter a PagerDuty workflow. The
existing email-only `alertSuppressed` guard is insufficient because it occurs
too late to protect check-ins. A Production request authenticated only with the
manual dashboard token also sends no check-in; it cannot manufacture liveness.

Initially notify Brandi directly from the Sentry workflow. After PagerDuty is
configured, route missed/error/max-runtime monitor alerts through Sentry's
native PagerDuty integration.

### Acceptance criteria

- [ ] Normal five-minute production runs appear as successful check-ins.
- [ ] Start and finish use the same client-generated check-in ID and only the
      current Relay ingestion endpoint.
- [ ] A completed run with business problems still reports successful Cron
      execution.
- [ ] Gather failure, or reconciliation failure after Phase 4, reports an error
      check-in.
- [ ] A slow or failed in-progress check-in neither delays observation gathering
      nor fails the run.
- [ ] No check-in within the reviewed grace window creates one monitor alert.
- [ ] Exceeding the reviewed runtime creates an alert.
- [ ] Missing or mismatched `CRON_SECRET` cannot make the monitor appear
      healthy.
- [ ] Preview and Development send no check-ins and cannot page.
- [ ] Dashboard-token and unknown-environment requests send no Production
      check-in.
- [ ] Missing, malformed, legacy, or off-domain ingestion URLs are rejected and
      surface through the direct operations route without making a request.
- [ ] Check-in payloads contain only ID, status, Production environment, fixed
      monitor configuration, and duration.
- [ ] Monitor recovery closes or clearly resolves the existing alert.
- [ ] Staging proves missed, error, overlong, success, and recovery before any
      controlled production miss is approved.

---

## Thirty-day observation and scope gate

Before the stateful phases, summarize 30 days of sanitized Phase 2A observation
rows, using the Phase 2B freshness signal to identify sustained gaps. Report
expected-run coverage and investigate gaps before using the data for the gate.
Derive:

- frequency and duration by stable key;
- false positives and unknown observations;
- number of mixed-key emails;
- any continuously observed incident lasting longer than its suppression or
  reminder window;
- sensitive Stripe event types actually observed as undelivered; and
- checker/runtime latency percentiles and headroom.

Retain Phase 2A evidence through this gate. Before adding the Phase 4 writers,
approve a retention or archive policy for observation and coverage-gap rows so
five-minute evidence does not grow without an explicit lifecycle.

Brandi then confirms the severity registry, consecutive-failure thresholds,
notification cap, reminder cadence, and whether the remaining phases retain
their proposed scope. This is a scope/calibration gate, not permission to put
Nick back into the interim route.

## Phase 4: Promote observations into per-key incident lifecycle

**User stories:** Brandi receives one coherent incident per problem and knows
when that exact problem recovers.

### What to build

Build on the Phase 2A explicit per-run observations. Replace the limited,
source-filtered webhook-error query with an exact count before assigning any
count-dependent threshold. Retain `source='stripe-webhook'` in the exact query.
Promote observations into durable per-key lifecycle state; do not reuse the
append-only evidence rows as acknowledgement state.

Add the DPC-owned incident-state migration and spec update as a separate schema
slice. After it is merged and applied, make DPC-WEB reconcile each key through a
conditional compare-and-swap upsert that returns whether the caller won an open,
escalation, repeat, or recovery transition. Require two consecutive healthy
observations before recovering network-prone incidents. A recovery is emitted
only if an opening notification was successfully delivered.

Suggested state includes incident key, severity, status, first/last observation,
consecutive healthy/unhealthy/unknown counts, last notification, notification
success, repeat count, resolved time, allowlisted summary, and runbook ID.

### Acceptance criteria

- [ ] Every Phase 2A observation participates in per-key lifecycle state.
- [ ] A throwing subquery yields unknown, never healthy, and cannot resolve an
      incident.
- [ ] Sustained unknown opens a separate SEV-1 monitoring-degradation incident
      while leaving the underlying incident open.
- [ ] `A -> A+B -> A -> healthy` preserves independent A and B lifecycles.
- [ ] Adding/removing one problem cannot reset another problem's throttle.
- [ ] State-store failure notifies statelessly, emits no recovery, and
      opens/logs `monitoring:state-store-unavailable`.
- [ ] Exactly one invocation wins each transition under overlapping runs.
- [ ] Recovery follows the configured healthy threshold.
- [ ] An incident that was never successfully notified emits no all-clear.
- [ ] Operational history remains append-only while current state is mutable.

---

## Phase 5: Page SEV-0 through PagerDuty Events API v2

**User stories:** Brandi receives an urgent SMS, can acknowledge it, and is not
repeatedly interrupted after acknowledgement.

### What to build

Create a DPC production-operations PagerDuty service. Brandi is the primary
responder. Configure her approved Crown Labs email and verified SMS number
directly in PagerDuty, never in the repository or event payload. Until a
technical backup is appointed, repeat unacknowledged pages to Brandi; Nick is
not a fallback.

Send health-check trigger/update/resolve actions directly to PagerDuty Events
API v2. Compute `dedup_key` deterministically from the system, environment, and
stable problem key without consulting Supabase or mutable incident state.
Mirror lifecycle in the dashboard and operational log, not Sentry. Mid-
incident SEV-1-to-SEV-0 escalation retains the same key and updates the
existing incident.

When Supabase is unreachable, the checker observes the underlying SEV-0,
enters stateless delivery, and emits
`monitoring:state-store-unavailable`. Local reads cannot deduplicate those
five-minute retries. PagerDuty's state-independent `dedup_key` is therefore the
authoritative page-storm control: retries update the same PagerDuty incident
instead of opening new ones. The monitoring-degradation key is separately
stable and does not replace or resolve the underlying Supabase incident.

If PagerDuty delivery fails, attempt the direct-to-Brandi operational email,
record/open `monitoring:pagerduty-delivery-failed`, and expose it on the
dashboard. Notification failures are processed without recursive fan-out.

### Acceptance criteria

- [ ] Synthetic staging SEV-0 creates one PagerDuty incident.
- [ ] Brandi receives SMS and can acknowledge through PagerDuty.
- [ ] Acknowledgement stops configured repeats.
- [ ] Repeated observations update/deduplicate the existing incident.
- [ ] With Supabase unavailable, each retry computes the same `dedup_key`
      without state and does not create another PagerDuty incident.
- [ ] Recovery resolves that same incident.
- [ ] Mid-incident SEV-1-to-SEV-0 escalation reuses the same `dedup_key`.
- [ ] PagerDuty API failure falls back to direct email and becomes visible as
      its own monitoring incident.
- [ ] Resend failure does not block the PagerDuty path.
- [ ] Nick and `hello@` receive no page, update, fallback, or recovery.
- [ ] Payload inspection contains only allowlisted data and no private contact
      information.
- [ ] One production test requires Brandi's explicit approval and is labeled
      clearly as a test page.

---

## Phase 6: Deliver SEV-1 and digest SEV-2

**User stories:** Brandi receives actionable degradation notices while benign
warnings are summarized rather than interrupting her.

### What to build

Send SEV-1 open/escalation email directly to Brandi with severity, impact,
duration, action deadline, dashboard URL, and runbook ID. Repeat only at the
reviewed active-incident cadence.

Add one Pacific-time daily digest for active SEV-2/unknown conditions and prior-
day recoveries. Send no digest when there are no active items or recoveries;
the dead-man's switch, not a daily all-clear email, proves checker liveness.
Implement Pacific self-gating so daylight-saving transitions do not shift the
operator-facing delivery time.

### Acceptance criteria

- [ ] SEV-1 reaches Brandi directly with allowlisted actionable context.
- [ ] Unresolved SEV-1 repeats only at the reviewed cadence.
- [ ] Acknowledged/recovered SEV-1 does not send stale reminders.
- [ ] SEV-2 and warnings do not create immediate email or PagerDuty incidents.
- [ ] One daily digest summarizes active SEV-2/unknown conditions and recent
      recoveries.
- [ ] Empty digest sends nothing, and this behavior is tested.
- [ ] A fixed-clock test crosses the November 1, 2026 Pacific DST transition.
- [ ] Digest recipients exclude Nick and `hello@`.
- [ ] Digest failure is visible but cannot recursively use the same failed path.

---

## Phase 7: Documentation, verification, and cutover

**User stories:** Operators can safely test and change alerting without
restoring the forwarding chain.

### What to build

Update deployment documentation with severity policy, ownership, contact-
storage rules, Sentry Cron configuration, PagerDuty service, environment
variables, execution budget, proof steps, recovery behavior, and runbook links.
Cut over through offline tests, staging lifecycle proof, production recipient
change, dead-man activation, and controlled production routing tests.

Keep a rollback that preserves detection and sends actionable email directly to
Brandi. It must never restore Nick, `hello@`, deposit-recipient inheritance, the
generic subject, or a six-hour urgent-incident silence.

### Acceptance criteria

- [ ] Offline tests cover all current keys, severity boundaries, dependency-
      class corroboration, exact counts, unknown state, CAS transitions,
      throttles, notification caps, recovery, and payload allowlists.
- [ ] Worst-case wall-clock with multiple simultaneous incidents remains below
      the published bound and leaves margin under `maxDuration`.
- [ ] Resend `{ data, error }` results are checked explicitly.
- [ ] Release readiness fails if operational defaults contain Nick, `hello@`,
      or the deposit-recipient fallback, without flagging legitimate business
      notification settings.
- [ ] A test proves the old generic route is disabled.
- [ ] A rollback test proves direct delivery reaches Brandi and cannot select
      Nick, `hello@`, or the deposit fallback.
- [ ] `npm test` and `git diff --check` pass in DPC-WEB.
- [ ] Applicable DPC schema/RLS/database tests pass for the state-table slice.
- [ ] Production readback records recipient roles and tested delivery channels
      without recording the SMS number or secrets.

## Verification commands

Run in DPC-WEB before proposing each applicable web slice:

```bash
npm test
git diff --check
```

If browser-visible dashboard or status presentation changes:

```bash
npm run test:e2e
```

Run the DPC repository's required TypeScript, Jest, database, and diff checks
for the separately owned state-table slice.

Staging evidence must prove:

- each severity route;
- PagerDuty SMS receipt and acknowledgement by Brandi;
- a deduplicated repeat and mid-incident escalation;
- an all-clear/resolution for a previously notified incident;
- no all-clear for an incident never delivered;
- state-store and PagerDuty delivery failure fallbacks;
- Cron missed/error/overlong/success/recovery;
- no production-monitor check-in from Preview or Development;
- no delivery to Nick or `hello@`; and
- no private contact data, arbitrary error text, or credentials in outbound
  payloads.

## Rollout and rollback

### Immediate tranche

1. Ship recipient decoupling.
2. Ship explicit per-run observations, severity-led subjects, allowlisted email
   content, and 30-minute-or-faster SEV-0 reminders.
3. Configure the production Sentry Cron monitor through current Relay HTTP
   check-ins.
4. Verify direct-to-Brandi delivery and at least three healthy check-ins.
5. Confirm the deployed direct path cannot select the old generic subject or
   recipient fallback.

### After the 30-day scope gate

1. Merge and apply the DPC-owned incident-state schema/spec slice.
2. Deploy explicit observations and per-key reconciliation in DPC-WEB.
3. Configure PagerDuty service/contact methods and staging routing.
4. Prove trigger/update/acknowledge/escalate/resolve in staging.
5. Obtain Brandi's explicit approval for production PagerDuty settings and one
   labeled test page.
6. Activate SEV-0 PagerDuty delivery, then SEV-1 email, then the digest.

Rollback disables new outbound actions while retaining detection and incident
evidence, then sends urgent email directly to Brandi. It must not restore Nick,
`hello@`, deposit-recipient fallback, arbitrary error passthrough, or long
urgent-alert suppression.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Transient probes create wake-up pages | Require consecutive failure or truly independent corroboration for network-only failures. |
| Combined failures create alert storms | Track and deduplicate per key; fan out concurrently with a severity-prioritized cap. |
| A failed probe creates a false all-clear | Require explicit healthy/unhealthy/unknown observations; unknown never resolves. |
| State storage fails | Notify statelessly, suppress recoveries, and raise a state-store degradation incident. |
| Resend suppresses its own alert | Deliver SEV-0 through PagerDuty and Cron blindness through Sentry/PagerDuty. |
| PagerDuty API fails | Fall back to direct email and expose a delivery-failure incident without recursion. |
| Cron scheduling drifts | Use a 15–20 minute grace window and separate max-runtime alert. |
| Multi-key fan-out exceeds Vercel runtime | Enforce per-call timeouts, concurrency, transition cap, overflow summary, and wall-clock test. |
| Brandi is unavailable | Repeat until acknowledgement and appoint a technical backup later; never fall back to Nick implicitly. |
| Private contact data leaks | Store SMS only in PagerDuty and enforce outbound allowlists. |
| Ops changes alter business email | Decouple variables and scope readiness checks only to operational settings. |
| Automated response damages business state | Restrict automation to observation and incident lifecycle; require runbooks and approval for mutations. |

## Runbook calendar items

- Perform one synthetic delivery/lifecycle drill monthly.
- Review incident frequency, false positives, unknowns, runtime budget, and
  escalation effectiveness after the first 30 days and quarterly thereafter.
- Reconfirm operational recipients and PagerDuty contact verification after any
  ownership, domain-routing, or provider-configuration change.
