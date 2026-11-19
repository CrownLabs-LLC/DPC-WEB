# The Introduction — November 25 release cutover

Candidate publication only. Production deployment, WEB main merge, public app distribution and feature activation require Brandi’s final release approval. November 19 edits are not evidence of publication. Set the displayed update date to the actual publication date before the approved production deploy.

## Approved content

Nick’s November 18 launch package supplies the copy, ToS §11.1 and Member Terms §2.7 amendments, privacy coverage and retention schedule. Brandi retains two one-time Introductions, December 31 eligibility/claim/redemption expiry, guest offering selection and selected-Circle reimbursement. Do not import Nick’s January, quarterly or highest-rate proposals. No drink-preference field is introduced. The normal member Check-In remains separate from paired redemption.

Canonical `/terms` becomes 3.1 with the targeted §11.1 amendment; `/privacy` becomes 4.10. Existing separate Member Terms and auto-renewal versions remain 3.0: this release does not silently replace those entire documents with Nick’s separately supplied 7.4/8.3 files. The targeted Member Terms §2.7 amendment is incorporated explicitly by ToS §11.1 for this Giving offering. `introduction-member-terms-replacement.md` preserves the replacement text for Nick’s source-document maintenance. We are not publishing unrelated provisions from his separate full-document attachments.

The claim requires ToS §11.1 plus Privacy and the separate 21-or-older checkbox. Marketing remains optional and initially unchecked. Introduction acceptance revisions are `introduction-giving-2026-v1`, `4.10`, `introduction-marketing-2026-v1`. The browser refuses mismatched revisions; checkout refuses a tuple other than ToS 3.1 / Privacy 4.10. No old acceptance rows are rewritten.

## Coordinated staging rehearsal, then approved production window

1. Verify exact target: staging `hohbsqkmrlhkstojfdgx`; production `ebiuspbgzggrdiaswpcc`. Record the current legal tuple, Introduction gates/revisions and exact Auth acceptance RPC ACL. Capture reviewed source/deployment revisions and recovery artifacts.
2. Pause new Introduction claims and the existing `accept_member_tos()` acceptance grant during publication. Do not change existing claims, guest Pours, deadlines or ledger history. Preserve the exact original ACL for restoration.
3. Publish the reviewed web deployment, including terms and privacy. Verify rendered pages, document versions, required/optional checkbox behavior, guest withdrawal and private views. With the old backend tuple, checkout must return `policy_version_mismatch`, not silently accept the wrong version.
4. After the reviewed membership migrations are installed, call `publish_introduction_legal_versions()` using the authorized server role. It requires claims paused, recognizes only the expected starting tuple, records one publication audit, updates the exact consent revisions, preserves the deadline, and does not enable the feature.
5. Verify checkout tuple 3.1 / 4.10 / 3.0 / 3.0 and matching browser revisions. Restore the captured acceptance ACL promptly. Brandi approved notice-only treatment: existing ToS 3.0 acceptance remains sufficient for access to this 3.1 amendment. Verify that existing members remain current; new affirmative acceptance must still record 3.1. Do not manufacture acceptance on anyone’s behalf. Preserve compatible old privacy versions and all historical acceptance evidence.
6. Re-enable only the previously authorized gates after the complete web and app experience is available. Production activation is a separate final approval step.

## Email and expiry operations

Staging has automatic `introduction-email-every-minute` and `introduction-expiration-five-minutes` jobs. The latter calls `expire_introduction_credits(500)` every five minutes; deadline eligibility is enforced by the server even between ticks. The email worker authenticates its scheduler secret and permits only approved staging recipients. Keep production disabled until activation. Do not resend completed jobs to test new copy.

Deploy the reviewed shared Auth code template deliberately after verifying actual OTP expiry is 900 seconds. Keep code-only verification and existing sender configuration. Claim/inviter emails and the guest receipt use the reviewed email worker; only the receipt includes a plain membership link. Test provider delivery without inventing new guest identities or resetting consumed Introduction slots.

## Recovery

Before backend publication, roll back the web deploy to the matching old documents and restore the original acceptance ACL; leave claims paused until consistency is verified. After publication, prefer a forward fix. If rollback is necessary, use an audited compensating tuple/control update coordinated with the matching old web deployment; preserve the new privacy compatibility row, historical consent and all financial history. Restore acceptance grants even if another launch check is delayed. Disable new claims/redemption through feature gates if the member experience fails; retain links and claims without extending December 31.

Never run the old scheduler hold script that assumes exactly eleven jobs: staging now includes additional independently authorized jobs. Requalify inventory-specific tools rather than modifying unrelated schedules.

## Prepared member launch announcement

Adapted from Nick’s launch package §3.1. Do not send before the paired app experience is live and Brandi approves the release communication.

Subject: Give a friend a Pour
Preview: Something new for the season. Two to share, on the Collective.

Hi [First name],

The holidays are when people bring someone along. Family in town, a friend you keep meaning to catch up with, the neighbor who has asked about DPC twice.

So we built The Introduction. You can bring a friend who has never been a member to a participating DPC venue, and their first drink is on the Collective. You use one of your Pours like any visit. Theirs is separate.

For this one-time Giving offering, you have two Introductions in total to share. Claim and use them together by December 31, 2026, Pacific time.

Open Pours in the app and choose Share an Introduction to share a link. Your friend claims it with their verified email. When you are out together at a Partner venue, open an available monthly Pour, tap Use an Introduction, choose your friend and their eligible beverage offering, and redeem together.

Sunday through Thursday any time the venue is open. Friday and Saturday before 4 PM. Your friend brings a photo ID. Venue blackouts apply.

We updated the Introduction rules in Terms §11.1 and the Privacy Policy for this Giving offering. Existing members do not need to re-accept.

Button: Share an Introduction → https://www.downtownpourcollective.com/introduction?view=member
Terms: https://www.downtownpourcollective.com/terms#sec-11-1
Privacy: https://www.downtownpourcollective.com/privacy

Cheers,
Nick

Downtown Pour Collective · A Table & Town LLC community
2601 Horseshoe Ct, Livermore, CA 94551
support@downtownpourcollective.com

If only one platform is released, add the exact supported-platform sentence before sending. Confirm the app CTA matches the final app copy. Campaign delivery/recipient eligibility remains a separate approved send; this document does not send it or enroll guests.

## Pinned release inventory

The production app source currently shipped is `1d245316feae11b75ee341aff21f572fbc227bb9`, runtime 1.0.5 on both platforms (update group `3fddc88c-6fa8-4540-b669-f2ab066d2077`). The Introduction client candidate is built from that baseline rather than unrelated current-main app changes. Its verification and final source revision must be recorded before public distribution. Preserve the existing production backend and public flags when exporting; enable the new Introduction flag only in the approved release window. Use the existing bundle-host guard and distribute its verified artifact without rebundling.

Production currently has none of the Introduction migrations. Install the reviewed feature migrations in this order, checking each target and preserving shared data:

1. `20261118215223_introduction_claims.sql`
2. `20261118224954_introduction_guest_verification.sql`
3. `20261118234045_introduction_guest_ledger.sql`
4. `20261119013500_introduction_paired_redemption.sql`
5. `20261119020251_introduction_reimbursement.sql`
6. `20261119023026_introduction_member_reads.sql`
7. `20261119034134_introduction_transactional_emails.sql`
8. `20261119040723_introduction_admin_contacts.sql`
9. `20261119042820_introduction_expiration.sql`
10. `20261119202056_introduction_marketing_withdrawal.sql`
11. `20261119202247_introduction_legal_publication.sql`

Do not use a broad migration push to silently deploy unrelated staging-only work. The last two migrations prepare privacy controls and the explicit publication operation; they do not publish legal versions or activate claims by themselves. Staging already has the first nine migrations. Recheck this inventory at the final approved cutover rather than assuming the November 19 snapshot is still current.
