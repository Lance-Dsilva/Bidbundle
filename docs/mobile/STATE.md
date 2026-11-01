# Resumable mobile checkpoint

Date: 2026-11-01 (America/New_York).
Branch: `codex/mobile-foundation` in attached `bundleen-mobile` managed worktree.
Baseline current main: `fb4a245721ffdd69dd0255c0ef021e6b6fbb08ed`.
Verified implementation commit: `01ae4bb8acdc7a592458bc513e5eceda6f1f50c7` (subsequent checkpoint commits are documentation/evidence only unless recorded).
Draft PR: [42](https://github.com/Lance-Dsilva/Bidbundle/pull/42), attached to mobile chat. No merge/deployment/distribution authorized. Primary checkout remains unchanged at `0c462d2`.

## Manager decision

Accept the independently reviewed local foundation milestone. **Phase 1 live auth feasibility and Phase 2 authenticated-slice gates remain OPEN.** Phase 3 business-write/product parity and Phases 4–5 have not started. This is a native Flutter scaffold with real SDK/API code, not a completed mobile product. No mocked response is shipped as backend integration.

Accepted scope/contracts: existing HTTPS backend, profile/context/homeowner dashboard read, server-authoritative identities/roles/community grants. Official native Clerk iOS1.6.2 and Android1.3.0 adapters selected for this compile-tested foundation; live lifecycle/security approval remains conditional. iOS minimum17 and provisional app IDs need product/release confirmation. Full inventory/backlog: PARITY.md, API_CONTRACT.md, PLAN.md.

## Evidence

- Source inventory:126 API routes,57 web pages; internal admin explicitly deferred, jobs excluded, AI/support/amenities/notifications inventoried.
- Flutter3.47.9/Dart3.13.7 pinned; formatter and analyzer pass;41 independent unit/widget/contract/capture tests pass after the bounded native-channel follow-up (8 new behavioral cases; see TEST_RESULTS.md).
- Android debug APK and iOS unsigned simulator builds pass. Artifact hashes and actual tool versions: TOOLCHAIN.md.
- iPhone17/iOS26.4 and Android API36 emulator launch-only smoke pass. Both display configuration-required screen without sign-in or backend calls; screenshots under evidence/. Test simulators returned to stopped state.
- Four fake widget screenshots reviewed, including200% text. They use synthetic data and substitute typography; not live/device product UX evidence.
- Independent review resolved award-authority wording, workspace authority wording, failed logout recovery, forced token refresh, response deadline cancellation and true native initialization retry. REVIEW.md records acceptance and remaining gates.
- PR head `d9fc53ad92cf065426a688f2b1a94cb98a1bdd79` CI reverified on 2026-11-01: [Mobile checks run 41363119530](https://github.com/Lance-Dsilva/Bidbundle/actions/runs/41363119530) passed on ubuntu-24.04 and macos-26, including Android debug and iOS simulator compilation. Check IDs 125017827557 and 125017827313 both report success. Original run 41362990527 was superseded/cancelled; the stale pending note is resolved. Vercel preview checks also report success; this is not a production release.
- No existing web/backend source, database data or production configuration changed. No migration/build script touching production was run. No new Android license acceptance command was used.

## External blocker and exact next task

Parent Engineering Manager now owns investigation/escalation of the approved non-production backend URL, matching Clerk development instance/Native API callback registration, and safe test identities via secure configuration. The earlier direct-to-human asynchronous staging question is superseded and its contents transferred to the parent; no duplicate direct question remains actionable. ENVIRONMENTS.md lists required names and negative-test identities. Root .env.local is not an approved staging environment.

Once supplied: configure separate environment app identifiers/callbacks; run official SDK sign-in → GET /api/profile → GET /api/me/context → GET /api/homeowner/dashboard → sign-out on both platforms; prove expiry/renewal/revocation, wrong-instance denial, role/community isolation and callbacks. Record actual device screenshots and secure storage/backup behavior. Fix failures before closing gates or starting dependent mutations. Native compile/fake tests cannot substitute.

Completed bounded independent task: eight behavioral tests now exercise the real Dart NativeAuthSession over a fake binary messenger, covering cancellation/error recovery, actual replacement-token retry, failed logout recovery and late native completion after logout. Independent review required sign-in vs sign-up dispatch assertions; these were tightened. Existing tests already cover initialization failure/retry and late HTTP responses, so they were not duplicated. These are adapter/state tests, never SDK/runtime/live-auth proof. The concrete staging checklist is in ENVIRONMENTS.md. Next dependency is parent Engineering confirmation of safe staging and agreed identifiers; do not start repeated unchanged wait/report loops. Final launcher art, brand font fidelity, nested navigation and all other feature rows remain explicit backlog. No mobile scheduler or unattended continuation has been configured; specialists are idle after assigned tasks finish. Recreate ownership from TEAM.md and resume at this checkpoint rather than restarting discovery.

## Coordination handoff

First point of contact: **Engineering team**, chat `01a174fd-bf0c-7973-a93a-1319bfe66547`, host `local`. Original human instruction verified; full routing/authority contract is in TEAM.md. Mobile retains implementation ownership. Send meaningful phase/decision reports to the parent; parent handles necessary consolidated human escalation. No merge or deployment approval was received.

Staging request transferred: isolated HTTPS API plus database/limiter/storage, matching Clerk development publishable configuration, approved Native API/registered app IDs and callbacks, enabled auth methods, safe homeowner/incomplete-profile/verified-and-unverified-provider/manager-A/resident/community-B identities and test-only revocation/demotion capability. Provisional callbacks are `com.bundleen.bundleen://callback` (iOS) and `clerk://com.bundleen.bundleen.callback` (Android); final environment IDs must be agreed before registration. Secrets remain in approved secure configuration.

Coordination commit 1bed1f0 is included with the reviewed tests/checklist follow-up on the next scoped push. Application/native/server source is unchanged. CI evidence above is explicitly for the previous PR head; the exact resulting-head run and outcome are recorded in the PR handoff after push. Do not infer a new-head CI pass from the earlier run.
