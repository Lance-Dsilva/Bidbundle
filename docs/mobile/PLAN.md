# Mobile phased delivery plan

Baseline: fetched origin/main fb4a245 on 2026-11-01. Existing homepage PRs [40](https://github.com/Lance-Dsilva/Bidbundle/pull/40) and [41](https://github.com/Lance-Dsilva/Bidbundle/pull/41) are merged. Connected GitHub open issue/PR search returned no results on discovery; mobile has direct authorization independent of that queue.

## Phase gates
1. Discovery: source-backed parity and contract matrix, auth feasibility decision, native UX, pinned toolchain/setup, environment prerequisites, test strategy, independent architecture/security/UX review. Gate remains open until evidence identifies a feasible real authenticated slice.
2. Foundation and live slice: Flutter app, environment validation, design tokens, navigation, typed transport/repositories, secure SDK session boundary, CI. Prove sign-in → live server profile/context → homeowner dashboard → sign-out/expiry. Require formatter/analyzer/unit/widget/contract checks, Android build, iOS compile, runtime evidence and independent security/code review. Mocks cannot close this gate.
3. Product parity: reviewed homeowner onboarding/coverage/request participation, provider onboarding/verification/discovery/bidding/service areas/scheduling, authorized HOA flows, messaging/notifications/profile/support/amenities/surveys/reviews/AI per PARITY. Each slice gets contracts, authority checks, screenshots and tests. Explicitly defer internal admin and unsupported device features; no silent omissions.
4. Hardening: full scoped regressions, cross-role/community isolation, both platform integration, accessibility/text scaling, background/resume/expiry, network and upload failures, duplicate submissions, performance, reproducible release builds/licenses/privacy/deletion/store checks. Independent test/UX/code evidence plus manager signoff.
5. Beta handoff: exact verified artifacts, instructions/screenshots/notes, signing/account owner checklist, rollout/rollback. Stop before external distribution, agreements, production deployment or public publication unless separately authorized.

## Ordered issue-sized work
| ID | Task | Owner | Dependency / acceptance |
| --- | --- | --- | --- |
| M01 | Source route and screen inventory | Backend | Actual methods/auth/errors; admin and AI inventoried |
| M02 | Auth adapter feasibility and threat review | Security | Primary docs, maintenance/license, lifecycle and callback requirements |
| M03 | Toolchain and architecture | Lead | Actual installed tools, pinned version, reproducible commands |
| M04 | Native UX plan and independent discovery review | UX/reviewer | Role navigation, accessibility, phase gate findings |
| M05 | Staging identity/backend readiness | Manager/security | Non-production API and Clerk instance, safe role identities |
| M06 | Flutter scaffold and typed read-only client | Lead/application | M01–M04; local formatting/analyzer/tests/builds |
| M07 | Native auth adapter and live slice | Security/application | M05/M06; real both-platform sign-in/context/dashboard/sign-out/expiry |
| M08 | Homeowner onboarding and coverage | Application/backend | Phase 2 passed; actual location/coverage contract |
| M09 | Requests and participation lifecycle | Application/backend | M08; authority and duplicate-submit tests |
| M10 | Provider onboarding/verification and marketplace | Application/backend | Phase 2 passed; server eligibility, bids and scheduling |
| M11 | HOA manager/resident journeys | Application/backend | Verified grants; community isolation tests |
| M12 | Shared communications and account/support | Application | Contracts, notifications distinct from push |
| M13 | Amenities/surveys/reviews/AI remaining parity | Application | Explicit PARITY dependencies and evidence |
| M14 | Cross-platform hardening | Test/UX/security/reviewer | Complete declared parity; fix and retest findings |
| M15 | Beta artifacts and handoff | Release operations | Phase 4 accepted; signing readiness |

After every task: implement → independent verification/review → fix → rerun → record evidence. Progress automatically when dependencies and gates pass. If blocked, continue independent work; never relabel an unrun mandatory gate as passed.

## Milestone status

M01 inventory and first-slice contracts recorded; later-slice payload expansion explicitly pending. M02 exact SDK/source audit plus native bridge compile completed, live staging feasibility pending. M03 toolchain installed/pinned and both native targets compiled. M04 independent architecture/code/fixture-UX review accepted draft prerequisite milestone after F1–F4 fixes. M05 blocked on owner-provided staging/Clerk/test identities. M06 read-only scaffold, typed client, state screens, native bridges and CI implemented; 33 tests and analyzer/formatter pass. M07 native adapter exists but live slice remains blocked. M08–M15 not started. Phase 1/live feasibility and Phase 2 gates remain open; no dependent business-write parity progression.
