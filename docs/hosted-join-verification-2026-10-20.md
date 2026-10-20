# Hosted Join verification — October 20, 2026

## Completed staging checkout verification

Result: **pass for the hosted visual/navigation gate.** All six membership
plans reached real Stripe sandbox checkout with the correct membership-only
totals. Monthly and annual kit add/remove, browser Back/retry and Stripe
cancel/Return to Join passed. No payment details were entered and no payment
was submitted. Physical-device/accessibility checks and clean final CI remain
separate release gates.

- [Hosted preview](https://dpc-web-git-codex-homepage-rebuild-brandis-projects-65a11cb6.vercel.app)
- [Draft DPC-WEB #74](https://github.com/CrownLabs-LLC/DPC-WEB/pull/74)
- Implementation source: `9572762fa52c71348e27764d39ea63c580994422`;
  hosted checkout-tested Git revision:
  `664eeac2152bc464043adcde94fb2b638ac4b769` (documentation-only successor).
- Configured Vercel deployment `dpl_BkxXMnjsRn6xLPTPrbH1erhmEEhy`, created
  October 20 at 2:52 PM Pacific, **target Preview / Ready**. Its stable branch
  alias is the preview link above. This rebuilt the existing Git deployment;
  no local source upload or production deployment was performed.
- Subsequent cancellation-copy correction removes the retired founding-hold
  statement without changing checkout, layout, prices or backend behavior.

### Isolation and current configuration

| Check | Result |
| --- | --- |
| Vercel authentication | Completed through Safari's saved passkey with Brandi's Touch ID. Normal CLI login completed; no password/recovery method changed. |
| Branch variables | Staging `SUPABASE_URL` and the existing server-only `SUPABASE_SERVICE_ROLE_KEY` added to **Preview / codex/homepage-rebuild only**. Key marked sensitive. Readback confirmed branch scope. Temporary credential files removed. |
| Fresh legal lookup | HTTP 200, `Cache-Control: no-store`, tuple `3.0 / 4.9 / 3.0 / 3.0`. The preview rejects live-project configuration. Earlier 503 is resolved. |
| Staging legal migration | Exact reviewed Privacy 4.9 migration applied under original version `20260918210346`; existing-member access retains 4.2 and 4.9. No acceptance history rewritten. |
| Dedicated QA endpoint | `circle-checkout-homepage-preview` **v1**, ACTIVE in `hohbsqkmrlhkstojfdgx`; bundle `26da3d4ce7705db330c6f37a43476a5fe241f4a1610c380c75c0959b21c488ec`. Hosted source exactly matches the submitted five files. |
| Guards | Requires staging project, test Stripe key, official test Turnstile mode, exact preview Origin and synthetic QA identities. Approved OPTIONS 204; production-origin OPTIONS 403; non-QA identity POST 403 before billing. |
| Reviewed billing implementation | Handler/runtime/RPC reused unchanged from staging v47, byte-compared with DPC `7bd9142abea342deb9063f22397a8ca7e084a8e1`; hashes pinned in the source manifest. Existing staging and production checkout functions unchanged. |
| Production isolation | Only production domains route to live checkout; unknown hosts fail closed. Production main, public Join and checkout v26 remain the unchanged baseline below. |

### Actual Stripe sandbox results

These were real hosted form submissions with synthetic identities, current
legal consent and Cloudflare's official test verification. No provider response
was mocked. Stripe displayed **Sandbox**, and its read-only order-summary tool
returned `livemode: false` for every recorded scenario.

| Circle | Monthly default | Annual default | Default items |
| --- | --- | --- | --- |
| Tap | $59 | $590 | Membership only |
| Cellar | $69 | $690 | Membership only |
| Reserve | $79 | $790 | Membership only |

| Scenario | Result |
| --- | --- |
| Monthly kit | Tap $59 → **$108** with one $49 Member Welcome Kit → **$59** after Remove / Confirm remove. Stripe states subsequent renewal is **$59/month**. |
| Annual kit | Tap $590 → **$639** with one $49 kit → **$590** after removal. Stripe states subsequent renewal is **$590/year**. |
| Browser Back and retry | Returned to Join with the selected plan and entered synthetic form details intact; Continue recovered and reached sandbox checkout at $59. No duplicate durable Tap-monthly intent was created. |
| Stripe cancel | Stripe's Back-to-merchant link returned to the preview's `/subscription-cancelled`, not production. Return to Join opened the preview form with consent unchecked; a new annual selection then reached $590 test checkout. |
| Cancel copy | Removed obsolete “founding reservation…24 hours” wording discovered during this path. Existing design and return links retained. Static release-readiness regression updated and passed. |
| Durable staging evidence | Six synthetic member rows, six open checkout intents (one per Circle/interval), all six `cs_test_` sessions; zero completed checkouts, zero subscription IDs and zero Circle memberships for these fixtures. Open sessions are unpaid QA evidence. |

No payment completion, new webhook/onboarding delivery, real member renewal
cancellation, or mobile physical-device proof is claimed. Previously accepted
paid sandbox evidence remains recorded below. This check does not resolve
Nick's separate member-support/venue-eligibility report.

### Local and CI verification

- `npm test`: passed locally and in both initial CI attempts.
- `npm run test:db`: all three suites passed locally in disposable containers,
  including concurrency/transaction/RLS checks.
- Checkout/legal/optional-kit browser regression: **219 passed**, one worker,
  no retries; Home/Events/header regression: **27 passed**. These are separate
  mocked Chromium/WebKit checks, not substitutes for the hosted results above.
- Deno entrypoint check and `git diff --check`: passed. Calendar CRLF is
  preserved in `.gitattributes`. No DPC app module source or cross-module
  internal import changed; app `npx tsc --noEmit` is not applicable here.
- Cancellation-copy follow-up: `node scripts/test-release-readiness.mjs` passed.
- [Initial CI run 39500079926](https://github.com/CrownLabs-LLC/DPC-WEB/actions/runs/39500079926)
  failed twice before DB execution because the registry rejected the pinned
  `public.ecr.aws/supabase/postgres:17.6.1.167` download with
  `toomanyrequests: Data limit exceeded`. Browser CI was skipped after setup
  failure. The final clean CI gate stays open until the final revision passes.

Sanitized `orders.json`, database counts, legal responses, deployment/source
readbacks and screenshots are under
`.impeccable/review/staging-join-2026-10-20/`. No credentials, payment details or
Checkout URLs are included in the saved order evidence. Configuration details:
[staging QA harness](../staging/homepage-checkout/README.md).

## Earlier read-only baseline

Result: **partial pass; rebuilt candidate's end-to-end checkout gate remains
blocked.** The current public Join page passes the legal-version and six-plan
display checks. The rebuilt Home/Events/Join revision has no hosted preview yet.
The latest existing PR preview cannot load legal versions because its server
configuration is unavailable. No Checkout Session, membership, payment, consent
record or onboarding email was created by this verification.

## Targets and identity

| Target | Identity | Scope |
| --- | --- | --- |
| [Current public Join](https://www.downtownpourcollective.com/join) | Web main `a4b4e0b9e613dc7058f142f1b290908bb4f6fc43`; GitHub production deployment `7106878322`, successful October 16 | Existing live page, before the new design |
| [Latest existing PR preview](https://dpc-web-git-codex-reminder-app-6830af-brandis-projects-65a11cb6.vercel.app/join) | [DPC-WEB #73](https://github.com/CrownLabs-LLC/DPC-WEB/pull/73), head `797a2ee3bcc97beb6ed4f7d1fd246589049fe910` | Older app-download-page preview; not this rebuild |
| Rebuilt candidate | Local `codex/homepage-rebuild`, uncommitted work above `a4b4e0b`; GitHub branch PR search returned no results | Home, Events, Join fixes and new assets are not hosted |
| Production checkout | Supabase `ebiuspbgzggrdiaswpcc`, `circle-checkout` **v26**, ACTIVE; updated October 16 at 19:53:39 UTC | Read-only deployed-source inspection |

Public Join, PR #73 preview Join and `a4b4e0b:join.html` are byte-identical:
SHA-256 `7202dcd7118673d48bd56626763e96a476c352fcec15830e94f80626217376a4`.
The local rebuilt Join differs:
`5e2841858f4eda7303536109a4385721193c172e463bdad2d151ac357b41812b`.
Passing the existing live page therefore does not sign off the rebuilt UI.

## Checks performed

| Check | Result | Evidence / limit |
| --- | --- | --- |
| Production legal lookup | **Pass** | Both `/api/legal-versions` and `?fresh=1` returned HTTP 200. Tuple: Terms `3.0`, Privacy `4.9`, Member Terms `3.0`, automatic renewal `3.0`. Fresh response has `Cache-Control: no-store`. |
| Production terms UI | **Pass** | Consent control enabled after load and remained unchecked throughout all six selections. No terms were accepted. |
| Six displayed plan totals | **Pass** | Real hosted browser interactions selected each Circle and interval; exact matrix below. Membership-only total excludes the optional kit. This does not prove Stripe line items. |
| Empty details validation | **Pass** | Continue with empty name/email and unchecked consent displayed “Enter your first and last name.” No personal information was entered. |
| Production policy readback | **Pass, configuration only** | Hosted v26 source has `PRODUCTION_CIRCLE_CHECKOUT_ENABLED=true` and `PRODUCTION_OPTIONAL_WELCOME_KIT_ENABLED=true`, and uses the dedicated production kit Price `price_1UGRnCCtQ9S99QuEA7IcpJzM`. This is not a fresh catalog or session readback. |
| Existing preview legal lookup | **Blocked** | HTTP 503, `X-DPC-Failure-Kind: configuration`, `Cache-Control: no-store`, body `{"error":"legal versions unavailable"}`. Browser shows the terms error and disables Continue. Clicking Try again returns the same error. |
| Security check completion and server validation | **Not verified end to end** | Production loads the Cloudflare widget resources without a visible security error. No challenge was manually solved and no token was submitted to checkout. Preview uses the published client test key, which is not proof of a sandbox backend. |
| Stripe handoff, six session totals, Back/cancel/retry | **Blocked for candidate** | No configured hosted candidate exists. No live checkout was substituted for a staging test. Preview's terms retry was tested and remains blocked; Stripe retry/return was not exercised. |
| Optional kit add/remove and recurrence | **Prior staging proof retained; fresh candidate check pending** | Existing paid sandbox evidence covers membership-only and kit purchase scenarios. No payment or kit selection was repeated in this pass. |
| Physical iPhone/Android, VoiceOver, text resizing | **Still open** | Desktop in-app-browser observations are not physical-device evidence. |

Production browser selection matrix:

| Circle | Monthly due today / recurring | Annual due today / recurring |
| --- | --- | --- |
| Tap | $59 / month | $590 / year |
| Cellar | $69 / month | $690 / year |
| Reserve | $79 / month | $790 / year |

All six displayed the selected Circle and billing interval correctly, kept
consent unchecked and showed no form error during selection. The page discloses
the optional Member Welcome Kit as $49 once, with no added kit tax.

## Existing release evidence reconciled

- [DPC-WEB #55](https://github.com/CrownLabs-LLC/DPC-WEB/pull/55) is **merged**,
  merge `ab3936d04810bad243129d8d6f6b5a92cd4f27ba`. Historical HOLD MERGE notes in
  the optional-kit web document are not the current release status.
- The backend's [September 16 staging proof](https://github.com/CrownLabs-LLC/DPC/blob/9a48eb15f22224b4716c334fd8f4ce47f11a8d2f/docs/optional-welcome-kit-operations.md#staging-proof--september-16-2026)
  records Cellar monthly at $69 by default, $118 with the kit and $69 after
  removal; a paid membership-only case; and Tap annual paid at $639 with the
  optional kit while recurring membership remains $590/year. It also records
  webhook, durable-record and onboarding outcomes. These are historical
  sandbox results, not new October 20 payment tests.
- The [October 16 source reconciliation](https://github.com/CrownLabs-LLC/DPC/blob/9a48eb15f22224b4716c334fd8f4ce47f11a8d2f/docs/optional-welcome-kit-production-price.md)
  describes the previously deployed v25. Today's actual version is **v26**, with
  both flags still true. Provider bundle SHA-256:
  `852d9787875d2b515313d4e61726021ebf0ce36bb64346d1d324d53ff3635784`.
  [DPC #452](https://github.com/CrownLabs-LLC/DPC/pull/452) is merged at
  `2dd33b6e56cb7864cdcb96773941ff4a92710e77`; the hosted runtime now has the
  `/welcome?session_id={CHECKOUT_SESSION_ID}` success return. No full runtime
  file-to-commit attestation or new welcome/payment flow is claimed here.

## Required to finish this gate

1. Prepare and approve a reviewable Git-integrated preview for the rebuilt
   revision, following the repository's PR/release process. Keep production
   unchanged while this gate is open.
2. Bind that preview's legal lookup and checkout to the approved staging
   Supabase/Stripe sandbox together. **The current Join source hardcodes the
   production checkout URL on every host**, while preview hosts use a test
   Turnstile key. Merely fixing preview legal environment variables does not
   establish sandbox isolation. Verify the intended staging function/origin,
   legal tuple, security verification and Stripe mode before any test submission.
   Keep service credentials server-side and preserve production behavior.
3. With an approved synthetic staging identity, verify all six selected plans
   through Stripe handoff, the membership-only default, the removable one-time
   $49 kit, recurring membership-only amounts, and cancel/Back/retry. Record the
   exact preview revision and backend versions. Payment completion is not needed
   for this visual/navigation gate; reuse accepted paid sandbox proof where valid.
4. Finish physical-device/accessibility checks and final CI on that revision.
   Neither the old preview's configuration failure nor local static-server API
   absence is evidence that production checkout is down.

The missing preview/configuration work belongs to implementation/release,
not Nick. Nick's two requested photo confirmations are now complete in the
[launch checklist](website-launch-checklist.md).

## Evidence retained

`.impeccable/review/hosted-join-2026-10-20/` contains the sanitized legal endpoint
responses/headers, hosted source identities, production backend readback,
six-plan browser matrix, required-field and preview-retry accessibility snapshots,
and screenshots of the live Join and preview error state. No credentials,
Turnstile tokens, Checkout URLs or member personal information are included.

This pass changes documentation/evidence only. `git diff --check` passed.
Earlier local mock-suite results remain in their original reports; they were
not rerun or relabeled as hosted tests. No deployment, backend setting change,
PR creation, production payment or external email occurred.
