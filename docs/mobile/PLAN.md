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

M01 source inventory and initial contracts recorded; per-slice payload audits continue. M02 native SDK audit and compile completed; live feasibility pending. M03 pinned toolchain and native compile complete. M04 independent source/fixture UX review complete for delivered slices. M05 awaits parent-owned safe staging. M06 foundation and reviewed read-only presentation are implemented. M07 real authenticated lifecycle remains unproven. M08–M15 full workflows remain backlog, with explicitly reordered read-only preparation R01–R03 below. Current exact scoped evidence belongs to STATE.md, TEST_RESULTS.md and the PR handoff; historical tests/builds do not certify a later head.

## R01 — reordered read-only homeowner request browsing

Authorized by parent Engineering under the human's instruction to continue/complete Flutter work. This is an independently testable M09 presentation/contract preparation slice moved ahead of unresolved M07 live prerequisites. It does not pass Phase 1/2 or permit dependent business writes.

Owners: backend specialist owns API_CONTRACT appendix only; Flutter application engineer owns mobile lib/ implementation; independent test/UX/code reviewer owns request tests/captures/review; mobile manager owns acceptance and checkpoint. No shared-server writer or server edits.

Acceptance criteria:

- Native homeowner Home/Requests navigation; real GET /api/homeowner/requests and GET /api/homeowner/requests/{encodedId}, separate strict typed DTOs per actual services.
- Read real title/status/category/community, available budgets/dates/counts. Handle null values honestly. No create/join/edit/award or inferred manager authority. Provider/admin contexts do not receive homeowner request navigation.
- Loading, empty, malformed/error/denied, retry and refresh states. Detail denial never falls back to owner-list data. Legacy HOA rows remain visible but explicitly lack mobile detail support because no compatible HOA detail GET exists.
- Back navigation and200% text work. Sign-out/session expiry/account change clear protected request state/detail; late requests cannot resurrect it. Session errors distinguish access denial from expiry.
- Meaningful contract/repository/widget/race tests, formatter/analyzer, independent UX/code/security review and fixture screenshots. Resulting-head Android/iOS CI builds required. Fixtures do not prove native runtime/backend authorization.

First live acceptance remains sign-in → profile/context → homeowner overview → sign-out/expiry on approved isolated staging, then real request list/detail and denied membership cases. Backend/API integration, native auth/storage/callback/resume and business-write gates remain open. Other M09 actions and all other PARITY rows are unchanged backlog.

## R02 — reordered read-only Account and Recent notifications

Selected after reviewed R01 under parent Engineering's authorization to continue eligible independent parity preparation. R01 commit04cc2dc is being checked in CI; R02 work stays local until that exact-head result is recorded. Live auth/business-write gates remain open.

Owners: Flutter application engineer owns lib; independent reviewer owns account/notification tests, captures and review; manager owns plan/parity/checkpoint; release/security specialist monitors R01 CI then reviews R02 session boundaries. Backend contract discovery is complete; no shared-server edits.

Acceptance: use real GET /api/profile and GET /api/me/notifications with typed separate DTOs, matching account identity, nullable fields, email-verification terminology and latest30 cap. Account accessible to public customer roles; Requests remains homeowner-only and admin/unknown workflows remain unsupported. Account→notifications uses native backable navigation, accessible200% text, loading/empty/error/retry/refresh. Do not edit profile, auto-mark read, dismiss notifications, show an invented unread-total or imply push. Stored links remain inert. Sign-out/expiry/account or role change clear private data/routes and stale replies cannot restore them. Dates include year and timezone, including a bounded correction to R01's date formatting. Tests/captures are synthetic and cannot certify live auth or storage. Require independent review, formatter/analyzer/tests and resulting-head native CI.

R02 local acceptance:106 tests pass with independent source/security/UX review; no actionable outstanding findings. Native resulting-head CI remains required after push. Fixture captures do not close live auth/runtime gates.

## R03 — reordered read-only provider Home overview

Parent Engineering accepted this as the next eligible candidate after R02 review and checkpoint. Source contracts are in API_CONTRACT.md. Application engineer owns lib; independent reviewer owns provider tests/captures/review; manager owns scope/checkpoint, security reviewer owns source audit. No shared-server edits.

Acceptance: only matched provider profile/context may request GET /api/provider/overview. Render company name (nullable fallback), explicit pending/active/suspended account state, active bids, active/completed agreements, published rating/review count and decided-bid win rate. Parse a strict bounded subset; null comparisons are unavailable, never zero. Account state is not bid eligibility or verification. Provider overview403/409/5xx must preserve authorized Account/notifications access;401 globally expires all private state. Include loading, errors/retry/refresh, role/account/signout stale-response fences and200% text evidence. No homeowner calls for providers; no provider calls for other roles.

Explicit deferrals: revenue/trends because source sums potentially mixed currencies and caps period data without a truncation flag; conversation previews/unread, marketplace, scheduling, bids and all mutations remain subsequent slices. Do not claim payouts or complete provider parity. Require independent fixture/source/security review, full appropriate local checks and exact resulting-head Android/iOS CI; live/runtime Phase1/2 gates remain OPEN.
