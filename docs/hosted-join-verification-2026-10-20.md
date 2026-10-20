# Hosted Join verification — October 20, 2026

## Staging preview setup in progress

Brandi authorized an isolated Git-integrated preview and sandbox checkout
verification, with production unchanged. The earlier read-only findings below
remain historical baseline evidence; they are not the result of this follow-up.

Prepared changes:

- Join selects the production checkout endpoint only on the two production
  domains. Approved team preview hosts select a dedicated staging QA function;
  unknown hosts fail closed. Production host behavior is unchanged.
- Preview legal lookup rejects a production Supabase URL before making a call.
  The preview branch requires its own staging server-only credentials.
- The dedicated `circle-checkout-homepage-preview` entrypoint accepts only the
  exact configured preview Origin and synthetic `example.com` QA identities.
  It rejects a production project, live Stripe key, or non-test Turnstile mode.
- The billing handler/runtime/RPC files are unchanged from staging v47 and were
  independently compared byte-for-byte with reviewed DPC commit
  `7bd9142abea342deb9063f22397a8ca7e084a8e1`. The source manifest records their
  hashes. Only the isolated entrypoint adds guards and preview return URLs.
- The exact reviewed Privacy 4.9 data migration was applied to staging under
  original version `20260918210346`. The current tuple now reads
  `3.0 / 4.9 / 3.0 / 3.0`; the existing-member access allowlist retains both
  `4.2` and `4.9`. No production legal setting or acceptance record changed.

Local checks: `npm test`, `npm run test:db`, staging policy guards and
`deno check` passed. The checkout/legal/optional-kit browser suite passed all
219 cases with one worker and no retries; Home/Events/header regression passed
27 more cases. `git diff --check` passed. This JavaScript website has no
TypeScript project, so the app slice `npx tsc --noEmit` gate is not applicable;
the isolated Deno entrypoint check passed. No app module source changed.
Git preview setup is in progress.
Vercel's saved CLI session expired; Safari's saved passkey is waiting for the
account owner's Touch ID. No hosted QA checkout has been submitted yet.

Implementation and deployment instructions:
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
