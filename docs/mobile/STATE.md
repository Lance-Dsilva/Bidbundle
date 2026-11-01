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
- Flutter3.47.9/Dart3.13.7 pinned; formatter and analyzer pass;33 independent unit/widget/contract/capture tests pass.
- Android debug APK and iOS unsigned simulator builds pass. Artifact hashes and actual tool versions: TOOLCHAIN.md.
- iPhone17/iOS26.4 and Android API36 emulator launch-only smoke pass. Both display configuration-required screen without sign-in or backend calls; screenshots under evidence/. Test simulators returned to stopped state.
- Four fake widget screenshots reviewed, including200% text. They use synthetic data and substitute typography; not live/device product UX evidence.
- Independent review resolved award-authority wording, workspace authority wording, failed logout recovery, forced token refresh, response deadline cancellation and true native initialization retry. REVIEW.md records acceptance and remaining gates.
- Remote Mobile checks run41362990527 for implementation commit started; final outcome must be recorded after completion. Local passes do not imply remote CI pass.
- No existing web/backend source, database data or production configuration changed. No migration/build script touching production was run. No new Android license acceptance command was used.

## External blocker and exact next task

Owner must identify/provide approved non-production backend URL, matching Clerk development instance/Native API callback registration, and safe test identities via secure configuration. An asynchronous question is pending in this chat; do not paste passwords/tokens. ENVIRONMENTS.md lists required names and negative-test identities. Root .env.local is not an approved staging environment.

Once supplied: configure separate environment app identifiers/callbacks; run official SDK sign-in → GET /api/profile → GET /api/me/context → GET /api/homeowner/dashboard → sign-out on both platforms; prove expiry/renewal/revocation, wrong-instance denial, role/community isolation and callbacks. Record actual device screenshots and secure storage/backup behavior. Fix failures before closing gates or starting dependent mutations. Native compile/fake tests cannot substitute.

Remaining local follow-up: review remote CI outcome, resolve any runner-specific failures and update this checkpoint. Final launcher art, brand font fidelity, nested navigation and all other feature rows remain explicit backlog. No scheduler or unattended continuation has been configured; specialists are idle after assigned tasks finish. Recreate ownership from TEAM.md and resume at this checkpoint rather than restarting discovery.
