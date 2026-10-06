# Meta Pixel activation — October 5, 2026

This release enables Meta Pixel `28569583012647858` on `/`, `/join`, and
`/subscription-success`, subject to the existing advertising opt-out controls.
The event scope is **PageView only**. It does not report verified subscriptions,
Purchase, Subscribe, Lead, value/currency, advanced matching, customer fields,
Conversions API, or App data. Subscription conversion measurement is a separate
release requiring a verified success signal; visiting a return URL is not proof
of a paid subscription.

## Notice and owner decisions

- Preparation [DPC-WEB #58](https://github.com/CrownLabs-LLC/DPC-WEB/pull/58)
  merged as `cb3cb562f3d0de8c7cf5ea8fd793d788e7c8e645` after Claude's round-2
  sign-off at `d4e24d8`. Its four switches were false.
- [DPC #434](https://github.com/CrownLabs-LLC/DPC/pull/434) merged as
  `f0e90f20db45897b5d5ce9e657f34ac49b79f058`. Decision #56 now requires fourteen
  full days from September 18, 2026 at 3:25:44.302062 PM America/Los_Angeles
  (`2026-09-18T22:25:44.302062Z`). Eligibility began October 2 at the same time
  (`2026-10-02T22:25:44.302062Z`), after 336 hours. The October 18 date in the
  preparation records is superseded.
- Brandi confirmed on October 5 that September 18 remains Day 0 despite the
  September 22 republication. The `284803e` policy diff changed the displayed
  date and Circle definition, leaving the advertising notice unchanged.
  Production still publishes Privacy Policy v4.9 and the September 18 notice.
- Brandi requested launch tonight and explicitly approved preserving Meta's
  click ID and restricted campaign tags before launch, with the existing
  GPC/opt-out protections, tests, and review. This replaces the preparation
  proposal to remove every campaign parameter. No legal version changes.

## Attribution and event scope

`assets/meta-pixel.v2.js` preserves only the following validated query fields.
Unknown fields, invalid values, duplicate keys and every fragment are removed
before requesting the SDK and rechecked before the loader's PageView.

| Field | Accepted values |
| --- | --- |
| `fbclid` | 20–500 ASCII letters, digits, `_` or `-` |
| `utm_source` | `meta`, `facebook`, `instagram`, `fb`, `ig` |
| `utm_medium` | `paid_social`, `cpc` |
| `utm_id`, `utm_campaign`, `utm_content`, `utm_term` | 1–32 digits; use platform campaign/ad/ad-set IDs |

No free-text campaign names or arbitrary customer values are accepted. Google
click IDs and other unlisted advertising parameters are removed. Retained tags
remain available to consented GA4 initialization. A valid `fbclid` lets the Meta
SDK create its `_fbc` click-attribution cookie; blocked visitors never load the
SDK, and their URLs remain unchanged. The format validation cannot establish
that a click ID is authentic; Meta supplies it on real ad-click arrivals.

For Nick's Meta ad URL-parameters field, use IDs instead of campaign names:

```text
utm_source=meta&utm_medium=paid_social&utm_campaign={{campaign.id}}&utm_content={{ad.id}}&utm_term={{adset.id}}
```

Meta adds `fbclid` on supported ad clicks; do not add a fake click ID to live ads.
This release supplies website visit signals for audience building. Nick must
still configure audiences/campaigns in Ads Manager. It does not automatically
create a campaign, guarantee audience matches, or optimize against verified
subscription events.

Same-origin referrers are accepted only from the three eligible paths, with
only the same validated attribution fields. Other query values fail closed.
External referrers must be a clean origin root. Arrivals from excluded paths,
including `/partners` and `/support`, therefore remain undercounted. Ad blockers,
GPC, and saved opt-outs also limit the observable audience.

## Privacy and cache controls

- The model remains advertising **opt-out**. The GA4 cookie banner's Accept
  action is separate and does not grant or revoke advertising permission.
- GPC and saved/in-page opt-out block the SDK and events. Unreadable preference
  storage fails closed. Cross-tab changes, focus and page restoration recheck
  privacy. A later block revokes SDK consent; this document never grants again.
- `fbq.disablePushState` suppresses SDK history/hash PageViews. Persisted
  `pageshow` revokes before the SDK's restore handler, keeping restored
  documents silent. A new full page load reevaluates privacy.
- Production HTTPS www/apex hosts and the three eligible paths are required.
  Preview/local hosts remain off. No noscript beacon, external preconnect,
  conversion event or loader on excluded pages is added.
- All four HTML launch switches are true: homepage, join, subscription success,
  and privacy choices. The choices page has no SDK; its switch controls status.
- Previously deployed `meta-pixel.v1.js` and `privacy-controls.v2.js` remain
  byte-for-byte unchanged. The new loader uses `meta-pixel.v2.js` because assets
  are cached immutable for one year.

## Verification and release record

The activation diff stands alone on website main `cb3cb562`. The PR description
records exact commit, command output, CI and review. No API or database code and
no cross-module imports change. TypeScript is not applicable to this JS-only
site (the required command prints compiler help, exit 1).

- Offline tests cover the four-switch invariant, validated attribution,
  removal of unsafe/duplicate values, eligible/referrer paths, race handling,
  opt-out revocation, deduplication and forbidden events.
- Browser tests use production-host fixtures but fulfill or abort all external
  requests. They exercise committed enabled HTML, rollback, independent GPC and
  opt-out contexts, campaign preservation and consented GA4 initialization.
- Manual real-SDK compatibility check:
  `META_PIXEL_SDK_PATH=/path/fbevents.js META_PIXEL_CONFIG_PATH=/path/pixel-config.js node scripts/test-meta-pixel-sdk.mjs`.
  Both files are separately captured public responses, not vendored assets.
  All browser requests are intercepted. The check verifies `_fbc`, one initial
  PageView, no later navigation/restore events, cross-tab opt-out and GPC on
  Chromium and mobile WebKit. The normal Desktop Chrome profile is explicit:
  Meta's unchanged production config suppresses HeadlessChrome user agents.
  Six production-config scenarios passed against SDK SHA256
  `89a2a82574d35ba44820a985fff208cb50bbe810307f7ee069f97fd391c9a131`
  and config SHA256
  `c197ab3417081551212ed868583372727b47149aa20aac0340bbd468c1b5f4b8`.
  A missing config path uses a minimal local stub;
  that cannot establish production configuration behavior.
- Production deployment ID, source readback and event verification belong in
  the PR release record after merge. Production is not declared live solely
  because a local test or preview is green.

## Meta account and final release checks

Brandi's October 5 screenshot confirms Pixel ID `28569583012647858` and
Automatic website matching OFF; she separately confirmed Track events
automatically without code OFF. Existing Event Setup Tool rules must not add
conversion events. Verify the current configuration and actual event readback;
repository code alone cannot prove account settings.

After tests and review, deploy through the approved Git merge. Verify source,
allowed/excluded paths, saved opt-out, GPC, cross-tab behavior, sanitized URLs,
click attribution and PageView-only events. Use clean browser profiles and
synthetic non-personal parameters. Nick can confirm receipt in Events Manager
→ DPC Founding Pixel → Test events. Do not submit a paid checkout for a pixel test.

## Off switch and rollback

Set **all four** HTML switches to false in an emergency release, with the
matching static test expectation. Verify zero Meta requests on fresh eligible
page loads and tracking-off status on privacy choices. Or roll Vercel back to
preparation deployment `cb3cb562`, whose switches are false. This does not recall
previously received events or unload old open documents. Later asset behavior
changes need another versioned filename; never overwrite immutable assets.
