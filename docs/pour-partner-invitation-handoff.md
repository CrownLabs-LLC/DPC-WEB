# Pour Partner invitation handoff — local batch

Brandi approved this fix on November 5, 2026. No builds, internal updates, merges that publish, or deployments are authorized until she asks.

The app shares `https://www.downtownpourcollective.com/pour-partner#token=…`. The new static page validates the exact fragment shape and offers an explicit **Open in DPC** link to the existing native invitation route. It makes no invitation API calls and does not accept an invitation. The native app remains responsible for expiry, revocation, identity, eligibility, preview and explicit acceptance. Missing/malformed links show recovery guidance. The page does not include analytics; standard privacy controls may retain the user's advertising opt-out preference but never read or retain the invitation token.

Publish and verify the website route before distributing mobile changes that share this URL, only after explicit release authorization. Previously sent messages are unchanged. The dedicated mobile privacy-test variant retains its isolated custom scheme.

Local verification: mobile TypeScript and all 232 suites / 3,072 tests passed. All 21 invitation-page browser cases passed across desktop Chromium, mobile Chromium and mobile WebKit, including fragment-only requests, fixed native destination, malformed inputs, fragment changes and no invitation storage. The website offline suite passed through all preceding suites before its final privacy suite detected the missing standard footer; the footer and privacy-controls script were added and all 13 privacy checks plus all 21 browser cases then passed. Independent review found no blockers. No database changes.

Physical device checks remain: Android RCS and iOS Messages → browser → installed DPC, cold/warm app, signed-out continuation, no app installed, expired/revoked invitation. Browser tests prove the link destination and page behavior, not operating-system handoff. Automatic app-store/install continuation and verified universal/App Links are outside this small release.
