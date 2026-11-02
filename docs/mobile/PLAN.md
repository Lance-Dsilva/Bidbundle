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

## R04 — reordered read-only Support requests

Source-backed Account → Support requests → ticket detail. Existing GET routes have no hidden mutations. Server visibility includes own tickets and tickets of actively assigned managed communities; no client management grant or all-tickets ownership claim. Mobile only exposes supported public roles after identity/context matching. Use encoded opaque IDs and response-ID matching;404 detail clears state without list fallback.

Render a minimal summary (ticket number, subject, category/status, nullable community and timestamps) and plain customer/admin replies. Reject internal_note/unknown message kinds; do not retain requester email, assigned admin identity, unfiltered messageCount, mutation permissions or related routing IDs. No links/attachments/create/reply/reopen. List is latest100; unpaginated detail can exceed existing1MiB transport cap and must fail honestly, with no silent truncation or enlarged limit.

Require real backable native routes, distinct scroll state, loading/empty/errors/retry/refresh, notification/support route switching,200% text, global401/renewal clearing and role/account/signout/navigation generation fences. Application engineer owns lib, independent reviewer owns contract/state/UI tests and captures, security reviewer audits source; manager checkpoints only reviewed/tested source with exact resulting-head native CI. No live/mutation/release gate advances.

## R05 — reordered read-only provider Opportunities

Manager-selected next eligible slice after R04 review/checkpoint; source contract and limits in API_CONTRACT.md. Provider-only tab with inline current-feed details from GET /api/provider/marketplace, after matched profile/context. There is no detail GET-by-ID; never invent one or reuse homeowner endpoints. Keep server eligibility/reason authoritative, distinguish ineligible/eligible-empty, and describe a feed filtered from at most200 candidate requests rather than a complete catalogue.

Minimal DTO only: eligible/reason/feed titles, community/context/category/kind, plain description, nullable locality/region/recurrence/distance/dates and bounded counts. Reject invalid enums/numbers/dates; never show feed under false eligibility. Omit budgets from this initial feed projection (underlying request budgets are explicitly USD), own bids, precise awarded-work addresses/access notes, service areas, agreement/occurrence data and any actions. No arbitrary links, direct IDs, local eligibility recomputation or status promotion. Existing1MiB bound can reject the shared workspace; fail honestly, no silenttruncate/newlimit.

Child403/409/5xx errors preserve Home/Account,401 globally clears. Refresh discards old feed/expansion. Require role/account/signout/navigation generation fences,200% text, top-level back behavior, independent code/security/fixture review and full appropriate checks with exact-head native CI. Application engineer owns lib, independent reviewer owns tests/captures/review; no shared server writer. All live/mutation/release gates remain OPEN.

R05 currency consistency correction: retain request budget USD displays because schema/validation/migration explicitly define US cents. Omit Home savings and request lowest-bid monetary displays because their API summaries drop bid/agreement currency; defaultUSD is not a database invariant. No actual mixed-production-data claim or server change. Require absence regressions and refreshed affected captures.

## R06 — reordered read-only provider Service areas

After R05 review/checkpoint, use canonical GET /api/provider/service-areas for a lazy provider Account child. Source read scopes active rows by authenticated provider; it does not require providerProfile/activation/credential state. Empty is genuine; saved coverage never proves eligibility. Retain only label/primary/coarse locality+region/nullable radius/postal codes/active status/updatedAt, with strict finite1..100 radius and canonical timestamp validation. Do not impose the10-area create rule on GET results.

No coordinates/exact address retention, maps/geolocation/permissions, editing, per-ID or legacy route calls. Require native back/route switching,200% text, empty/errors/retry/refresh, existing response limits, owner/role/session/navigation fences and global401 clearing. Local errors preserve Account. Also remove now-unused savings/bestBid fields from mobile DTOs, retaining strict USD budgets and behavioral omission tests; backend payloads stay unchanged. Application owns lib, independent reviewer tests/captures/docs, security source audit. Exact resulting-head native CI and all live gates remain separate.

## R07 — reordered read-only homeowner Neighborhood

Source contract confirms GET /api/homeowner/neighbourhood has no workflow mutations, geocoding or membership reconciliation. Homeowner-only Community tab is a bounded mobile product choice (API also admits hoa_staff). Lazy matched-identity read; no per-ID, roster or manager endpoint. Retain communityId/name/active member count/optional managerName and up to50 visible request id/communityId/title/categoryLabel/status/date/plain description. Validate exact hub-community binding and unique IDs; active member count includes caller. Null hub is distinct from a real empty feed and does not explain why membership is unavailable.

Inline current-feed expansion only; omit management/addressReady/permissions/creator identities/bids/participants/agreements/visits/occurrences/money. No participation/join/vote/create/award/invite/map or links. Keep1MiB and total-time bounds. Local failures preserve Account;401 clears globally; refresh/revocation/null/close discard prior snapshot and expansion with role/owner/generation fences. Require4-tab homeowner200% navigation/back, independent source/security/tests/captures and exact-head native CI. No live/mutation gate closure.

## R08 — reordered read-only provider Published reviews

Source-only proof establishes provider-console gate, owner-scoped published-only reads with no workflow writes. Provider Account child lazily fetches canonical ratings GET with limit20/offset0. Keep first-page bounds/hasMore honest; no fake full-history or pagination control. Retain minimal plain reviewer name/rating/comment/nullable subject/date, server page and optional server average/count. Drop distribution/extra identity data; never invent anonymous/verified badges or calculate a page average as the all-published summary. Do not require exact cross-query totals during concurrent moderation.

No response/edit/delete/report/subject navigation, external links or per-ID/identity calls. Local errors preserve Account;401 globally clears; refresh/close/moderated-away rows/account/role changes clear prior text with generation fences. Require native back/Account-child switching,200% text, strict rating/date/numeric/page validation, existing size/time bounds, independent code/security/fixture review and exact-head native CI. No server writer, live gate or mutation progression.

## R09 — reordered read-only Inbox and latest transcript

GET callgraph is read-only; web separately POSTs /read, which mobile must not do. Account routes support homeowner+hoa_staff through homeowner inbox and provider through provider inbox after matched identity; response party labels never select endpoints. Server participation is the authority for existing history, not current membership/bid status. List up to100 recent threads, then fresh authorized encoded listed-ID detail GET limit50/offset0. Bind thread and every message to selected ID; no list fallback on denial.

Retain minimal plain participant names/previews/body/date and server isMine, omit sender IDs/request links/unread totals/receipts. Show latest50 and older-available state honestly; no fake pagination, send/start/read-receipt/report or external/identity calls. List previews can visibly ellipsize as previews; transcript messages in the returned window stay complete. Preserve1MiB/timeout guards, local errors/Account access, global401 clearing, owner+role/navigation generations and refresh replacement. Require all Account-child switches/rapid reopen/native back/iOS/200%, independent source/security/fixture review and exact combined-head CI. No live/mutation progression.

## N01 — isolated nonproduction native builds

Parent accepted this priority after R09: one native prerequisite slice, with optional read-only screens deferred. Add development/staging flavors, provisional com.bundleen.bundleen.development and .staging IDs, and visible Dev/Staging names. Preserve the base ID provisionally; no production flavor or external callback/Native API registration. The real entry point requires appFlavor == BUNDLEEN_ENV and valid HTTPS/test-key configuration before constructing auth/network dependencies. Empty public templates intentionally cannot connect.

Application owner handles native/Dart/config/CI/README; independent reviewer handles compiled configuration tests, four native builds, effective metadata and fresh task-owned no-config launches; security reviewer audits pinned SDK callbacks/storage settings. CI compiles both flavors on Android/iOS and retains unconfigured debug APK/unsigned simulator artifacts for seven days. Run compiled configuration scenarios once in Linux/development CI, alongside normal full-suite checks. No distribution signing or store action.

Acceptance: mismatch/missing/production cases fail before auth/HTTP; matching development/staging factories accept synthetic public values without contacting them; effective APK/plist IDs, labels, callbacks, backup/storage settings match source expectations; both flavors build on both platforms and coexist on fresh task-owned devices. Record actual no-config screenshots and clean up only created devices. Configuration guards reduce mistakes; they do not prove approved backend/Clerk/database pairing or measured SDK persistence/isolation. Real auth callbacks/storage/resume and authenticated UI remain live gates. Native fixture journeys and final artwork/fonts are separate future slices.

## N02 — native fixture journeys

Prerequisite N01 exact head 741b13d54368a172d1e681a613faae172f7246b2 passed all four CI/build/artifact gates in run41372909197. Parent approved this separate bounded slice. Architect owns integration_test, SDK dev dependency/lock and test tooling; independent reviewer owns native evidence and review/test results. Manager owns scope/checkpoint. No production fixture flag or main-entrypoint bypass is permitted.

| Both fresh task-owned Android and iOS runtimes | Acceptance |
| --- | --- |
| Homeowner | Home, Requests/detail/back, Community, Account/Inbox/transcript/back, logout clears private content |
| Provider | Home, Opportunities, Account child page, injected recoverable error/retry, back/logout |
| Large text and semantics | Key journeys at 200% text; usable labels/controls, no overflow; record exact assertion and input methods |
| Isolation of fixtures | Inject synthetic AuthSession and strict API transport only from integration_test; unexpected app service/channel/network calls fail; no real auth/account/server access |
| Evidence | Exact commit, command, device/OS, clearly labelled synthetic screenshots, result and cleanup; distinguish tester input from OS input and screen-reader use |

Production widgets/models are reused directly. Normal main.dart and shipping artifacts retain no fixture data or bypass. SDK integration_test is a development dependency. Branding/fonts, physical devices, VoiceOver/TalkBack, live auth and runtime secure-storage isolation remain separate unrun gates.
