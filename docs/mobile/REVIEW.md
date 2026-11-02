# Independent discovery review

Reviewer: independent_review specialist, architecture/code and Senior Mobile UX review. Date 2026-11-01. Baseline fb4a245. Reviewed the authored plan independently; no mobile implementation or runtime tests existed at this review. Findings are source/document review, not device evidence.

## Decision

**Conditional acceptance for independent local foundation work only. Phase 1 gate remains OPEN; Phase 2 live gate NOT PASSED.** The read-only first slice has usable source contracts. Scaffold, DTO parsing, session abstraction, bounded HTTPS transport, brand tokens, asynchronous state screens and fake-backed tests can proceed without staging. These are prerequisite work, not an exception that completes the missing auth gate. Do not implement dependent business writes or claim authenticated product parity until the gate evidence exists.

## Required fixes and blockers

1. **P1 — Provider-selection authority wording.** PARITY.md homeowner bidding-room row says “explicit owner/provider selection.” Request ownership does not authorize award. `src/app/api/homeowner/requests/[requestId]/award/route.ts` delegates to `awardBid`; `src/lib/server/hoa-market.ts::awardBid` calls `requireCommunityManager(userId, request.communityId)` before award logic. Change the row to requester/participant bid comparison and authorized community-manager selection. UX must not expose an award action merely because a user owns a request. Add negative owner-without-manager and resident-without-manager cases to that slice. Current server need not change.
2. **P1 gate blocker — Auth feasibility unresolved.** AUTH.md accurately labels native SDK bridges conditional. Exact versions, minimum supported OS, secure persistence and lifecycle/callback compilation remain unproven. Approve the adapter only after the ongoing SDK audit and compile spike. A public SDK description or fake channel test is insufficient. Never substitute a token-entry field or static token to make a demo appear integrated.
3. **P1 gate blocker — Safe staging missing.** Real sign-in/profile/context/dashboard/logout/expiry cannot be certified until an isolated backend, matching Clerk development instance, registered identifiers/callbacks and safe identities are available. Middleware `auth.protect()` covers `/api/me`, so verify actual response status/content type and native Bearer handling through deployed middleware, including rejected sessions. Do not amend authorization merely because source mocks cannot prove compatibility.
4. **P2 — Specify navigation semantics.** UX.md “multi-role switching” should mean switching among server-authorized workspaces/assignments, not choosing a new account role. Viewer context has one database role plus assignments and memberships. Homeowner with a manager grant may access scoped management, but role switching cannot mutate or grant that role. Unknown roles/unsupported admin context must fail closed into an explanatory screen.
5. **P2 — Native UX evidence outstanding.** The plan covers touch targets, 200% text, safe areas, keyboard, back, error states and no color-only status. Add explicit VoiceOver/TalkBack traversal and action announcements, contrast measurement for actual composited colors, draft preservation across background/resume, and a reachable cancellation path for hosted auth. Review real screenshots on both platforms before accepting the first slice; none exist yet.
6. **P2 — Transport implementation acceptance.** Disable authenticated redirects or validate origin before every redirect; limit response/body handling; avoid emitting server HTML/raw errors or callback queries in logs. Strictly bind config to environment, reject URLs with credentials/query/fragment, clear all protected state on session generation changes, and do not turn 403/409 into a retry loop. AUTH/ARCHITECTURE already require most of this; test it in the implementation.

## Cross-check evidence

- Profile serialization fields match `src/lib/server/profile.ts::serializeCommonProfile`; nullable fields and server-provided radius remain explicit.
- Context shape matches `src/lib/server/communities.ts::resolveViewerContext`; `canManageCommunity` is expressly navigation-only and roles/assignments are rechecked server-side.
- Homeowner dashboard handler explicitly requires homeowner; source service returns cold_start, active_requests, active_bids and total_saved_cents scoped to authenticated owner. Do not reinterpret calculated savings as guaranteed discount.
- Shared server auth resolves Clerk identity to current database profile/grants. Mobile route guards cannot replace this.
- Parity includes AI, amenities, support, notifications, profile and manager/resident flows; internal admin/server jobs are explicitly excluded. Later-slice contracts are honestly deferred for detailed fixture expansion. In-app notifications do not imply push.
- Isolated apps/mobile, constructor injection and small views/view-models/repositories/services are proportional. No additional backend or database access is proposed.
- Toolchain inventory distinguishes installed tools from verified builds. Flutter installation and native release audit are underway in separate ownership; this review does not certify their later output.

## Next review gate

Manager resolves item 1 and navigation wording, accepts the local prerequisite scope, and records the still-open auth/staging gate. Then independently review actual foundation code and tests; add platform build logs and screenshots with exact revisions/device/OS. Return for auth/security review after exact SDK storage/callback evidence. Full phase acceptance requires the assigned evidence; no completed implementation, UX runtime approval, or live-auth success is implied by this document.

## Foundation source review — initial implementation

Reviewed all seven Dart files under apps/mobile/lib before native bridge/build completion. Source-only review; no analyzer, widget/device test or build execution by this reviewer. Initial decision: **changes requested**, then rerun focused tests and review.

- **F1 / P1 — Retry failed sign-out.** In home_model.dart::signOut, SDK failure still transitions to signedOut after setting signedIn=false. home_screen.dart renders Sign out only when signedIn, so the message's “try again” has no corresponding action; native session may still persist and reactivate on restart. Keep explicit pending-sign-out/error state with a retry action, prevent new sign-in during unresolved cleanup, clear all data immediately as already done, and distinguish local cleanup from remote revocation. Test SDK failure followed by successful retry and prove no protected content returns.
- **F2 / P1 — Actually refresh after 401.** ApiClient.get calls the same AuthSession.token() on both attempts; the interface has no cache-bypass/force-refresh option. A native SDK may return the same cached rejected token. Add an explicit forced-refresh parameter for the second attempt and wire it to the SDK's supported option (or demonstrate equivalent bridge behavior). Test first token rejected, second forced token accepted, and two failures stopping retry. Do not implement refresh by custom JWT logic.
- **F3 / P2 — Cancel timed-out response streams.** `_readBounded(response).timeout(timeout)` ends the caller's wait without cancelling the underlying stream. A slow-drip body that sends a chunk before each inactivity timeout continues reading after the total timeout, potentially across repeated retries. Use an explicit subscription/deadline that cancels on total timeout, size limit and completion/error; test that stream cancellation is observed after deadline. Also account for a late client.send response after its timeout so that its body is not left unconsumed.
- **F4 / P2 — Recover initialization failure.** initialize catches SDK startup failure and displays ordinary Sign in/Create account buttons, but neither retries SDK initialization. A transient startup failure can leave the user repeatedly invoking an uninitialized bridge. Represent initialization error separately with Retry initialization (or make authenticate reinitialize safely); test one failed initialization followed by success without process restart.

Positive source findings: explicit HTTPS config without production fallback; no Dart credential persistence; authenticated redirects disabled; response size bounded; errors sanitized; account/context identity and role consistency checked; role endpoint selected from server context; protected UI cleared on refresh/sign-out; generation checks discard late responses; non-homeowner preview scope disclosed; scroll layout and 52px button heights support basic touch/text-scale intent. These do not substitute for runtime accessibility, secure persistence or native session proof.

Follow-up scope: rerun targeted failure/race/transport tests after F1–F4 fixes, verify native token refresh contract and cleanup semantics, then independently inspect large-text/screenshots and both platform builds. Unknown future roles currently receive the unsupported-preview message rather than privileged actions; retain that fail-closed behavior as routing expands.

## Foundation fix re-review and native bridge inspection

Source re-review after manager fixes, before test engineer results/build certification:

- F1: **Dart fix verified**. logoutPending preserves a retry action after failure, blocks authentication, and clears protected data immediately. Native remote sign-out can still fail; process-restart cleanup/recovery remains a runtime acceptance case, not proven by an in-memory flag.
- F2: **Dart and bridge source fix verified**. Second safe-GET attempt passes forceRefresh=true; iOS/Android bridge forwards skipCache. Actual native renewal still needs the live test.
- F3: **Source fix verified**. StreamIterator cancellation runs in finally after body deadline/size/error; late send responses are cancelled through the expired flag. Test engineer should prove cancellation and bounded retry behavior.
- F4: **Dart UI fix verified, native retry still open at this inspection**. Retry initialization calls initialize again, but both bridges skip initial configuration after configuredKey is set. Android waits on the same initializationError; the audited Clerk source exposes reinitialize(). Auth engineer has been asked to fix/review supported retry semantics on both SDKs. Do not mark end-to-end startup recovery passed from a fake AuthSession alone.

Independently inspected AppDelegate.swift, MainActivity.kt, Android manifest/backup rules/build settings and iOS Info.plist. Auth SDKs are pinned in source, token errors sanitized, passwords and tokens are not persisted by Dart, SDK auth flow owns callback validation, operations are serialized, skipCache is bridged, telemetry disabled, Android cleartext disabled and clerk_preferences.xml excluded from backup/device transfer. SDK source manifest supplies INTERNET permission and the callback receiver; therefore absence of those entries in the app manifest alone is not a defect. Verify the merged release manifest and runtime callbacks before release.

No native compile/runtime tests were run by this reviewer. SDK lifecycle behavior, process death, cancellation, iOS scheme/callback registration, secure storage, startup retry and remote logout remain live/native gates. This source review permits a clearly labeled draft foundation milestone after remaining code findings are fixed; it is not production/security approval or Phase 2 acceptance.

## Final foundation source follow-up and fixture UX review

F4 is now **resolved in source**: Android retry calls Clerk.reinitialize(), whose pinned implementation clears initializationError and queues a new refresh; iOS retry uses refreshEnvironment()/refreshClient(), which populate the two properties used by isLoaded. This avoids deleting stored identity through reconfiguration. All F1–F4 requested code changes have been inspected. Manager reports 29 independent tests plus four capture tests and the incremental iOS compile after native retry edits passed; see test/build evidence for exact commands. This reviewer did not run those commands. No remaining source blocker was found for a clearly labeled draft foundation milestone.

Inspected the four actual PNG files in apps/mobile/build/evidence/widget-fixtures: signed-out.png, dashboard-fixture.png, error.png and large-text.png. These are fake-backed Flutter widget captures at 390×844 logical size, not emulator/device or authenticated screenshots. The capture code loads SDK Roboto into the serif font alias, so they do not certify native serif typography or final V5 font fidelity.

Visible assessment: normal signed-out actions and error recovery actions are legible and separated; dashboard cards display fixture counts/cents and qualified savings copy; the 200% signed-out capture wraps without horizontal clipping and keeps both auth buttons legible. The large heading consumes considerable vertical space but the ListView permits scrolling; real accessibility navigation and all-screen 200% checks remain required. No screenshot-level blocking overlap found in these four states. Production company icon, native font rendering, insets/keyboard, back behavior, loading/empty state captures and full role navigation are not demonstrated.

Manager's calculated contrast for explicit planned pairs: forest #193E34/paper #F8F6EF 10.91:1, white/teal #087666 5.54:1, muted #596C61/paper 5.19:1. These figures do not certify Material-derived colors, outlines, all component states or platform rendering. VoiceOver/TalkBack traversal/announcements, actual platform screenshots, live hosted auth, session expiry/revocation, secure-storage inspection and cross-user/community isolation remain unrun gates. **Draft milestone review accepted within these limitations; Phase 2/live auth and release approval remain withheld.**

## Bounded follow-up: native Dart channel tests and environment checklist

Reviewed apps/mobile/test/native_auth_contract_test.dart and the ENVIRONMENTS.md extension on coordination baseline 1bed1f0. No application/backend implementation changed within this scope.

The eight new cases exercise the real NativeAuthSession over Flutter's fake binary messenger, then observe HomeModel/API behavior: cancellation vs failure sanitization and recovery, forced replacement token actually sent in Authorization, bounded second rejection, failed logout/retry, and late auth/initialization completion unable to resurrect private view state. These are useful boundary regressions beyond asserting that a method exists. Mock handler removal in tearDown and model disposal prevent shared test state from leaking; normal race paths complete and await their pending futures.

**N1 / P2 coverage correction requested:** cancellation/recovery cases for signIn and signUp currently accept either method in the handler without asserting which was called. A signUp accidentally wired to signIn would pass both cases. Record the actual authentication method and assert the expected mode for cancellation and recovery, and verify initialize receives the fixture publishableKey. Keep assertions at the cross-language interface boundary rather than duplicating implementation logic.

Environment checklist cross-check: current AppConfig supports exactly BUNDLEEN_ENV, BUNDLEEN_API_ORIGIN and CLERK_PUBLISHABLE_KEY; native IDs are compiled and flavors/ID defines are not implemented. Callback strings match pinned SDK defaults for com.bundleen.bundleen. The three protected GET handlers have no direct limiter requirement; optional Blob/AI/geocoding/Bundleen workers need not be invoked for this narrowly read-only slice. Clerk verification/delivery remains required by enabled methods. Document correctly distinguishes public config from identity/server secrets, metadata from proven resource isolation, and owner coordination from permission to mutate shared services. Existing parent-reported environment metadata was not independently re-fetched in this review.

No checklist blocker found. Source review of tests is conditional on N1 correction and test execution evidence. Fake messenger tests do not execute Swift/Kotlin/Clerk SDKs, real callbacks, secure storage or live server authorization. The artificial concurrent completions test Dart generation fences, not native serialization semantics. Staging/live gates remain open; these tests cannot certify them.

### Follow-up resolution

N1 **resolved and source-verified**: both cancellation/recovery modes now assert the exact signIn/signUp method and initial public configuration forwarding. The two renewal cases additionally assert the native getToken method before interpreting forceRefresh, while retaining replacement-header and retry-bound outcome checks. Manager reports all41 tests/analyzer/format passed before the last method-name assertion and affected8 tests passed after it; this reviewer inspected source and did not independently rerun commands. Current-head CI must rerun rather than inherit the prior milestone head's pass.

**Approved for the bounded draft-PR update**: native Dart boundary regression tests and environment-readiness documentation only. No application/server changes or external setup are approved by this review, and no live/native SDK/device authorization gate is closed. No outstanding findings remain for this scope.

## Read-only homeowner Requests slice — independent test, UX and code review

Reviewed current request DTOs/repository/model/screens plus HomeModel/HomeScreen integration and API renewal adaptation against server handlers/services and the API_CONTRACT appendix. Scope is GET list and separately authorized GET neighborhood detail with Home/Requests navigation. Creation, participation, bidding, awards, HOA detail, schedule and other writes remain unavailable; none is implied by this acceptance.

### Findings and resolution

- **R02 / P2, resolved:** the initial single-Scaffold detail replacement lacked an actual iOS back-swipe route and retained the long list scroll position on detail. The independent200% widget test failed to find the detail heading after scrolling to View details. Author replaced it with nested CupertinoPage/MaterialPage navigation and distinct scroll keys. The same test now passes, as do platform-back and simulated iOS edge-swipe tests. Session cleanup removes the requests navigator. A rapid back→reopen same-ID probe passes; no stale-removal callback defect was reproduced.
- **R01 security regression, resolved:** after a server401, a native forced-refresh exception previously could leave global account/list state active. Security reviewer raised this; author maps failed second-attempt renewal to unauthenticated. Independent HomeModel integration test confirms account/list/detail/navigation clear. A distinct initial-token network-error test confirms it does not falsely expire the account, hides provider details, clears detail and recovers on retry. This is fake token-service evidence, not real revoked-session proof.
- No other blocking source finding remains for this bounded slice. List/detail DTOs are separate, opaque IDs encoded, response ID verified, membership denial never synthesizes detail from list, unsupported HOA rows cannot invoke neighborhood detail, and client permission fields grant no business actions. Renewal remains bounded and redirects disabled.

### Tests actually run by independent reviewer

Added28 cases in apps/mobile/test/requests_test.dart and four capture cases in test/evidence/requests_screenshots_test.dart. Coverage includes distinct source-contract DTOs and nullable amounts, malformed cents/date rejection, unknown status as inert text, encoded IDs,403/404 denial after successful list, all eligibility refusal reasons without following arbitrary actionPath, HOA row limitation, unscoped/wrong-role no requests calls or navigation, expired session/global clearing, late owner/detail/sign-out responses, empty/error/retry,200% scrolling/back, iOS gesture simulation, logout route removal and rapid same-request reopening.

Executed with /private/tmp/bundleen-flutter-toolchain/bin from apps/mobile:

- `flutter analyze`: no issues.
- `dart format --output=none --set-exit-if-changed lib test`:15 files,0 changed.
- `flutter test`: **73 passed** (prior41 plus28 request regressions plus4 request captures).
- Full-suite log: /private/tmp/bundleen-requests-full-tests.log.

Initial test failures included missing test list setup and fake widget-time HTTP handling, corrected in tests; platform override was restored before framework invariants. These were test harness failures, distinct from the reproduced detail-scroll issue. Final suite passed after all source fixes. No web/server tests or native builds were run by this reviewer for this iteration; release operations must record those separately.

### Screenshot review and limits

Generated and inspected apps/mobile/build/evidence/request-fixtures/{requests-list,requests-detail,requests-denied,requests-large-text}.png. Fake source-shaped data,390×844 logical viewport; Roboto substitutes test text fonts, actual SDK MaterialIcons is loaded. Updated captures show recognizable navigation/back icons, clear denial+Retry without leaked detail, explicit USD/nullable-date labels, and200% list text wrapping with reachable scrolling. Detail begins at top after actual list navigation in the regression test. Long detail content extends below viewport and remains scrollable; the capture is not proof of full screen-reader or device behavior. No blocking overlap found in these fixture captures.

**Accepted for a reviewed draft milestone within this read-only scope**, subject to current-head CI/native build results from release operations. This is independent local fixture/source acceptance only. Real iOS/Android authenticated runtime, membership revocation, cross-user/community isolation, VoiceOver/TalkBack and secure-session/callback behavior remain unrun. Phase2 live gate and overall parity/release gates remain open.

### Final compact-list UX refinement

Author compacted list metadata into wrapping inline label/value rows, preserving every field, nullable labels and48px actions; detail layout unchanged. Regenerated all four captures and visually re-inspected list and200% text: normal-size rows are easier to scan, with no horizontal truncation or overlap at200%. Independent affected32 tests passed, followed by the **complete73-test suite** on final source. Analyzer: no issues; formatter:15 files,0 changes. Evidence copied to docs/mobile/evidence/requests with a fixture-only README. Acceptance above remains limited to this draft read-only slice; no live gate advances.


## R02 independent Account and recent notifications review — 2026-11-01

Reviewed the read-only Account DTO/repository/model/navigation and notification surfaces against the appended server contract. Account requires the expected profile ID and public customer role; admin/unknown roles cannot open Account or initiate its requests. Email verification is labeled precisely and makes no provider-vetting claim. Nullable profile fields remain explicit. Notifications preserve server readAt, show plain text and safe kind labels, retain linkPath inertly, and expose no write action, unread total, pagination claim, or push enrollment. The author resolved the missing notification kind display with known labels and a generic unknown-kind fallback. No remaining blocking source finding in this bounded slice.

Independent tests exercise exact GET paths, identity/role mismatch, malformed/null data, 303/401/403 and server failures, retry and old-data clearing, late profile/notification results after owner or navigation changes, public-role navigation, native-style back/edge gesture in widgets, signout/forced-renewal expiry clearing, literal body/link behavior, and 200% text scrolling. Shared Account/Requests dates now include year and explicit UTC offset. Final local suite: **106 tests passed**, analyzer clean, formatter 22 files with zero changes on the final check.

Visually inspected four Account fixtures and regenerated Requests list/large-text fixtures: clear email verification/null labels, readable read/unread states, year/offset dates, denial with Retry, and no blocking overlap. At 200% content scrolls beneath persistent navigation; widget tests reach notifications and return through both levels. Screenshots use fake auth/API data and substituted Roboto fonts, not actual device screenshots. Account and updated Requests evidence are checked in under evidence/.

**Accepted as an independently reviewed local read-only draft slice**, subject to resulting-head CI/native build checks. Live authenticated iOS/Android behavior, native SDK session/storage/callback-after-logout handling, cross-user isolation, VoiceOver/TalkBack, and complete production font/device accessibility remain unrun. This review does not pass the live staging or release gates.

Independent security reviewer also found no actionable R02 source issue: matched ID/role, generation fences, global clearing, GET-only transport, inert paths/plain Text, no avatar/coordinate fetch, and email-only verification. This security acceptance is source-scoped; native session/storage and live isolation gates remain open.


## R03 independent provider Home review — 2026-11-01

Reviewed the strict rendered overview subset, provider child state, Home integration and role gates against the R03 API appendix. Required nullable keys are distinguished from missing fields; unknown status, negative/unsafe counts, fractional/out-of-range win rate and nonfinite/out-of-range rating fail closed. Pending, active and suspended remain read states. Company fallback uses the already matched profile name. Metrics retain agreement/count semantics; money, trends, unread totals and inbox previews are excluded, with no mutation affordance or verification claim.

The child failure state preserves personal Account after 403/409/500 or malformed success. Role and identity are established before provider GET; other roles make no provider call and providers make no homeowner calls. Owner/generation fencing discards late signout/role-switch/owner-switch results. A 401 followed by failed native renewal clears global Home/Account/provider state. No actionable security or correctness finding remains in the reviewed source.

UX review requested removal of the inherited generic Home hero from provider Home because it pushed useful data below the viewport and split a long heading at 200%. Author applied the provider-only refinement; regenerated captures now begin with matched identity and provider overview. Five synthetic captures inspected, including the scrolled null-rate/rating state: honest absence labels, zero published reviews, clear denial/retry and usable persistent Account navigation. At 200%, content wraps and scrolls without blocking overlap.

Final independent verification: **42 provider tests + five provider capture cases; full suite 153 passed**, analyzer clean, formatter 27 files/zero changes. Accepted for this bounded read-only draft slice, subject to resulting-head CI/native builds. These are source and mocked widget results only; actual provider identity isolation, live authorization/session renewal, device SDK storage/resume/callback behavior, and VoiceOver/TalkBack remain open. No live gate or financial/messaging parity is passed by this review.

R03 security source audit: auth/security specialist found no actionable issue in matched-role call isolation, child error preservation of Account access,401 global clearing, owner/generation fencing or plain status presentation. No mutation/authority is derived from status. This is source-only acceptance of the local R03 slice, not live or earlier-head CI proof.


## R04 independent Support review — 2026-11-01

Reviewed the minimal customer Support projection and Account→list→detail navigation against the API appendix and server visibility/filter functions. The list honestly covers up to100 recent tickets available to the account, including authorized community records; it does not claim all are owned by the viewer. Waiting-on-requester and Last activity labels preserve server semantics. Unfiltered message counts, requester email, staff identity, permissions, and related ids are absent from the retained projection. Body text is plain and inert. Internal notes, unknown message kinds/author sides and fromAi=true are rejected.

Detail GET encodes one path segment and matches returned identity. 403/404/409/500 detail errors never substitute list data. A legitimate body exceeding1MiB fails with the existing transport boundary and a recoverable read error; there is no silent truncation or invented pagination. Session/owner generations fence late results; old-owner401 cannot expire the current scope. Public navigation remains restricted to matched customer roles. The independent security reviewer also found no actionable source issue in these boundaries; that is source acceptance, not live isolation evidence.

Initial compile identified a detail-constructor super parameter reference error, corrected by the author before tests executed. Final independent verification: **43 Support cases + four capture cases, full suite200 passed**, analyzer clean, formatter32files/zero changes. Actual HomeScreen widget tests cover scrolled list→detail starting at top, reachable messages at200%, platform back, iOS edge swipe, logout route removal, rapid same-ticket reopen, and Support/notifications switching before transitions settle. No delayed-route regression was reproduced.

Inspected four synthetic captures: clear limited list, neutral status, customer/support labels, visible literal markup/URL text, year/offset dates, denial/Retry without cached conversation, and wrapping200% content with persistent navigation. No remaining blocker for this bounded read-only draft slice. Resulting-head CI/native builds, actual managed-community access/revocation, cross-user isolation, native auth/session/storage/callback behavior, and device screen-reader accessibility remain open. No live or release gate advances.

R04 checkpoint also refreshes Account fixture captures from the final200-test run to reflect the new Support navigation button. Earlier R02 snapshots remain available in Git history. No device/live evidence inferred.


## R05 independent Opportunities review — 2026-11-01

Reviewed the provider-only inline feed against the marketplace contract. Only eligibility/reason and the minimal opportunity fields survive projection; budgets without currency, own bids, service areas and private awarded-work sections are not retained by DTOs or rendered. GET uses no client identity/location/filter or per-ID request. Inline expansion reads the current feed and introduces no independent detail authority or mutation. False eligibility with rows, duplicate IDs, more than200 rows, unknown context/kind, invalid counts/dates and nonfinite/negative distance fail closed. Null distance/date/recurrence remain absent rather than invented values.

Provider access follows matched Home identity/context. Other roles make no marketplace call; providers make no homeowner calls. Local403/409/500 and oversized-workspace errors preserve Account. Refresh/tab close clear prior feed and expansion, owner generations discard late responses, old-owner401 cannot expire a new scope, and failed forced renewal clears global state. The unchanged1MiB transport limit can reject a legitimate large workspace before projection; omission of sensitive nested sections does not prevent their authorized network transfer. No source correctness/security blocker identified in this bounded review.

Final independent verification: **48 Opportunities cases plus four capture cases; full suite253 passed**, analyzer clean, formatter37files/zero changes. Widget tests use the actual Show details button at200%, reach literal multiline description, verify tapping it makes no call, check omitted private strings/amounts, GET-only/no per-ID traffic, and back to Home. Four inspected captures distinguish eligible empty from ineligible, explain the200-candidate limit honestly, preserve dates with year/offset and render no currency or action claim. No blocking overlap found; long content scrolls beneath persistent navigation.

Accepted as a bounded local read-only draft, subject to resulting-head CI/native build checks. Live cross-provider/feed eligibility isolation, actual SDK session/storage/callback behavior and device accessibility remain unrun. Financial/bid/scheduling/message parity remains deferred; no live or release gate is passed.

### R05 checkpoint currency correction and security cross-check

Independent security source review agreed with the bounded Opportunities projection, provider-only gate, inline-only expansion and generation/session fences. Its monetary audit found explicit validator/schema/migration USD authority for request budgets, so those remain supported. Older lowest-bid and savings responses omit potentially non-USD bid/agreement currencies; a schema default is not a currency constraint. This is a source-contract ambiguity, not evidence of an actual mixed-currency production incident. Author removed those two amount displays while preserving DTO compatibility fields and explicit-USD request budgets.

Added one Home→Requests widget regression using nonzero amounts: savings/lowest-bid amounts stay hidden while the USD budget remains visible. Final post-correction full suite **253 passed**, analyzer clean, formatter37files/zero changes. Regenerated all captures and copied updated Home and Requests evidence; inspected Home dashboard and Requests list to confirm the monetary change. No backend arithmetic or API behavior changed. R05 budgets remain intentionally outside its approved slice.

R05 final capture maintenance: refreshed provider fixtures for the new Opportunities navigation tab. Legacy Home capture harness now loads SDK MaterialIcons, replacing missing-glyph boxes; this is a fixture correction only. Post-fix full253tests, analyzer and formatting remain clean.


## R06 independent Service areas review — 2026-11-01

Reviewed the canonical lazy provider Account→Service areas read against the R06 appendix. No request occurs on Home initialization or Account open; only matched providers can enter the summary. It uses GET /api/provider/service-areas without a per-ID route, marketplace fetch, mutation, map or geolocation call. The retained DTO omits exact coordinates, formatted address and unused geocoded metadata. Saved labels and postal codes are plain text; UI explicitly distinguishes saved coverage from activation, credentials and bidding access.

Nullable legacy radius remains absent; finite1..100 bounds, active status, canonical dates and required types fail closed. More than10 otherwise valid rows are retained, and no primary is synthesized. Empty success is not a missing-provider/onboarding or eligibility error. Read failures and unchanged1MiB transport rejection preserve Account; refresh clears old rows immediately; owner/close/generation fences discard stale replies. Global401/failed renewal clears session models and routes. No blocking source or UX finding.

Updated older parser tests confirm missing/malformed unused total_saved_cents and bestBidCents no longer affect the used projections. Source declarations/parsing are removed; explicitUSD budget validation and existing monetary-display absence regression still pass. This is minimal retained-data cleanup, not a backend semantic change.

Independent final evidence: **43 coverage cases and four captures added; full suite300 passed**, analyzer clean, formatter42files/zero changes. Widgets exercise the actual Service areas button at200%, plain label/private-data omission, back, iOS edge swipe, signout route removal and rapid Coverage→Support→Notifications→Coverage changes. Four inspected captures show coarse/legacy/empty states and scrollable large text without blocking overlap.

Accepted for the bounded local read-only draft, subject to resulting-head CI/native builds. Source/mock evidence does not establish actual provider ownership isolation, live SDK session/storage/callback correctness, production font/device accessibility or screen-reader behavior. Existing live gates remain open; no server changes or external calls performed.

Independent source-security audit also found no actionable R06 issue: canonical lazy provider read, no invented provider-profile/status authority, coarse-only retained projection, no10-row cap/maps/permissions/mutations, sibling-route clearing and owner/generation/global401/dispose fences. Monetary aggregate declarations are absent while fixed-USD budgets remain. This is bounded source acceptance only; live isolation is still unverified.


## R07 independent Community snapshot review — 2026-11-01

Reviewed the minimal neighbourhood snapshot against the British-spelled GET contract. Homeowner-only navigation is a product restriction, not a claim that server excludes HOA staff. The client makes one lazy /api/homeowner/neighbourhood read, without manager-roster, arbitrary community, per-request, or mutation calls. It retains only community identity/name, active member count, optional manager name and current-feed request summaries/descriptions. Permission/manager/address flags, bids, participants, agreements and exact visit data do not enter the projection or create actions. The larger authorized response still crosses the network before projection under the existing1MiB/time limits.

Strict retained-field parsing enforces canonical dates, safe counts, at most50 unique requests and exact request-to-hub community binding. Unknown status remains inert display data. Null hub is distinct from a real hub with no visible requests; neither invents an onboarding or eligibility diagnosis. Refresh clears old snapshot/expansion before loading; revoked-to-null, owner/role/tab/signout transitions and late old401 cannot revive or expire the wrong scope. Local errors preserve Account and forced-renewal401 clears all session models. No blocking source finding.

Independent tests cover canonical role-only lazy GET, null/empty distinction, required fields, count/date limits,50cap/duplicates/community mismatch, plain text/privacy omission, flags granting no actions,1MiB and timeout recovery,403/409/500, refresh revocation, owner/role/signout/old401 races and200% actual four-tab/inline/back navigation. Synthetic captures cover populated, unavailable, empty and large text. The initial large-text heading had a final-letter wrap; a readability refinement was requested before final capture acceptance.


### R07 final disposition

Author changed the page heading to Community, matching its tab. Re-inspected the200% capture: heading no longer splits its last letter, four navigation labels fit, and content remains scrollable. Final post-refinement **full343-test suite passed** (39 Community cases plus four captures added), analyzer clean, formatter47files/zero changes. Refreshed Home/Requests/Account/Support fixture images for the four-tab layout and copied four new Community images with provenance.

Independent source-security audit also found no actionable issue: minimal privacy projection, exact hub binding/50 unique feed limit, lazy canonical homeowner read, retained-ID-only expansion and refresh/null/error/close/session generation fences. Accepted for this bounded local read-only draft, subject to resulting-head CI/native builds. No live user/community isolation, membership revocation, native SDK session/storage/callback or production-device accessibility gate is passed by source/mocked evidence.


## R08 independent Published reviews review — 2026-11-01

Reviewed the provider Account first-page read against the published-review contract. Canonical lazy GET /api/provider/ratings?limit=20&offset=0 follows matched provider identity. Pending/suspended provider records retain read access; missing-record409 is local and does not remove personal Account. No per-review or identity-lookup request, response/edit/delete/report workflow, link action or invented verification/anonymous badge is present. Plain projection keeps only displayed review fields and server page/summary information, dropping distribution and unexpected private metadata.

Strict validation enforces integer1..5 row rating, nullable finite1..5 average, safe nonnegative total, canonical dates, nullable subject and exact20/0 with at most20 unique IDs. Summary average is not computed from the current page; independently read summary/list inconsistencies remain acceptable, without invented transactional or distribution-sum invariants. Empty page/nullaverage and hasMore have precise labels, with no complete-history or fake pagination claim.1MiB/timeout and403/409/500 fail locally; refresh clears removed rows, role/owner/close/signout fences protect content, and failed renewal401 clears global state.

Final independent evidence: **44 review cases + four captures added; full391 tests passed**, analyzer clean, formatter52files/zero changes. Actual Account-button navigation at200%, literal comment tapping without network effects, private/verified/anonymous omission, native back/iOS edge swipe and rapid sibling-page switching pass. Four inspected captures show clear first-page boundaries, server aggregate separate from rowrating, nullaverage/empty and denied/Retry states. Long text scrolls under persistent navigation without blocking overlap.

Independent source-security audit also found no actionable issue in the lazy query, backend published/session-provider filters, minimal plain projection, server-summary semantics and generation/global401 boundaries. Accepted for the bounded local read-only draft, subject to resulting-head CI/native builds. Actual cross-provider ownership, moderation visibility, native SDK/session/storage and device accessibility remain unverified live gates; no source/mock result passes them.


## R09 independent read-only Inbox review — 2026-11-01

Reviewed the minimal thread/transcript projection and Account native routes against the participant-scoped source contract. Trusted matched role alone maps homeowner/hoa_staff to homeowner inbox and provider to provider inbox; message party labels cannot choose endpoints. Lazy listGET retains at most100 unique threads, and only a listed ID may trigger encoded detailGET with limit50/offset0. Returned thread identity and every message conversationId must match; duplicate or over-window messages fail closed. No unread total/badge, sender ID, request ID or receipt field is retained or rendered, and no /read, /messages, identity or per-request call occurs.

Server isMine determines You versus plain sender name; bodies/previews remain plain text. Native view describes the latest window and older-message omission without claiming complete history, read receipts or start-of-conversation access. Empty transcript is valid.403/404 after list clears detail without metadata fallback;409/500/size/timeout errors remain local preserving Account. Refresh replaces prior text; close/owner/role/signout and old401 fences protect the current session. All Account siblings clear prior Inbox state, including fast route switches and same-thread reopen.

Existing conversation authorization is stored participant ownership, not current community membership or current bid/award status; this review does not invent a membership-revocation rule. Live cross-participant authorization remains external evidence.

Final independent results: **45 Inbox cases + five captures added; full441 tests passed**, analyzer clean, formatter57files/zero changes. Actual200% Inbox and View conversation buttons, scrolledlist→top-of-detail, message reachability, platformback, iOSedge gesture, rapidreopen and sibling-page switching/signout pass. Five inspected captures show bounded list/latestwindow, plain named/You messages, empty and404 recovery, with wrapping text and persistent usable navigation. No blocking source or fixture UX finding.

Accepted for this bounded local read-only draft, subject to resulting-head CI/native builds. Actual session/storage/callback behavior, live participant isolation, read-state nonmutation and device/screen-reader accessibility remain unrun; no release/live gate advances.

Independent source-security audit likewise found no actionable R09 issue in trusted role paths, listed-ID/response binding, bounded minimal plain projection, participant read source, no mutations, stale owner/role/generation fencing and global401/local failures. This source acceptance is not live privacy or receipt-state proof.


## N01 independent native build isolation review — 2026-11-01

Accepted for the bounded engineering build-isolation slice. Independent review found one concrete build blocker: Android flavor resValue labels required buildFeatures.resValues=true. Author corrected it, and all four development/staging Android/iOS simulator builds subsequently passed. Packaged suffix IDs and display names match; Android callback hosts/shared-session authorities are suffix-specific, shared-session provider disabled and backup/cleartext protections retained. iOS simulator metadata has suffix IDs and no added URL entitlement/registration or distribution signing.

26 independent configuration cases plus eight compiled-flavor runs verify accidental mismatch rejection before auth/network construction. Full467 tests pass, analyzer clean and formatter58files/zero changes. CI matrix/artifact retention, empty credential/origin templates and absence of production flavor were inspected. No fixture entrypoint or fake responses were added to application builds.

Real fresh-device evidence now confirms both variants coexist and render no-config screens on Android API36 and iOS26.4.1; six inspected captures and effective metadata are in evidence/native-isolation. Android first boot caused a system-process ANR/slow install; after Wait and cold relaunch, both final app screens rendered correctly. Android launcher truncates the long staging label visually but preserves its full accessible name; distinct Dev/St labels remain identifiable. Starter icons are intentionally unchanged. Both task-created devices were stopped and removed; existing device data was untouched.

Independent security source review found no additional actionable regression. This acceptance does not prove live callback registration, backend/Clerk environment isolation, token persistence, secure-storage isolation, late callback after logout, authenticated navigation or screen-reader/device accessibility. No live/release gate advances; resulting-head CI is still required. See evidence/native-isolation/README.md for exact build/runtime limits.


## N02 independent synthetic native review — 2026-11-01

Accepted for the bounded native-engine fixture slice at **4ac16367ed04206ea76cebecb15a72423c807bdb**. Both fresh Android16/API36 and iOS26.4.1 runtimes passed the same five authored scenarios (guard self-check plus two roles at two scales; framework teardown yields counter6). Production BundleenApp/models/API are injected through a separate test entrypoint; no lib fixture branch/import or live account/service exists. Strict role/method/origin/full-route whitelist and exact call multiset protect the current HTTP seam. Actual integration-binding self-check denied real HttpClient, unexpected route and bundleen/auth on both platforms; later journeys recorded zero violations.

Independent native testing caught test-helper defects at initial5efbb418: premature taps after scrolling, `.last` on absent lazy items, and review identified cleanup vulnerable to assertion failure. Author corrected only harness code, added postscroll settlement/hit-testability/fatal missed taps and guaranteed teardown; both complete native matrices then passed at one corrected head. The initial run remains failed/partial, not accepted evidence.

Representative captures inspected at100%/200% on each platform show readable wrapping, inert HTML-like/URL text and persistent navigation. Selected Account/Retry/Sign out semantics have labels/button/tap actions and48logical-pixel rectangles, with actual MediaQuery scale asserted. Lower content remains scrollable; the iOS200% Retry initially below the viewport becomes hit-testable through the next bounded scroll. No blocking production layout/source defect established. Full467 tests passed, analyzer clean,61files format unchanged.28 synthetic captures plus exact source/device/command/limits and hashes are in evidence/native-fixtures. Fresh task devices were stopped/removed; existing data untouched.

Back/tap/scroll are Flutter tester inputs and captures are native Flutter/app surfaces, not full OS interaction or screen-reader proof. No live Clerk/API, callback/storage isolation, production auth/logout, hardware back/predictive back, iOS native edge gesture, physical device or TalkBack/VoiceOver gate advances. Independent source-security audit found no additional actionable current-seam issue, with explicit raw Socket/plugin/OS-network-sandbox limits. Resulting-head CI remains separate and required.


## N03 independent native presentation review — 2026-11-01

Accepted for the bounded presentation slice at **15a88ee5075f7eb47f78b7c72f4a26c00334e2d2**. Independently verified the canonical SVG provenance/hash and all 22 PNG hashes, sizes and byte lengths. Clean temporary regeneration with pinned rsvg-convert 2.61.3 and ImageMagick 7.1.2-13 exactly matched the committed manifest and outputs. Canonical geometry/colors are preserved with uniform padding; all 15 iOS icons are opaque, and Android adaptive foreground padding protects the mark under the observed mask. No new artwork or font substitution is present.

Both normal development/staging builds passed on Android and iOS. Real OS launcher screenshots show both variants with the complete canonical mark and distinct labels; packaged identifiers and icon references match. Two focused native scenarios per platform passed at 100% / 200%, with initially hit-testable Retry before scrolling, nonoverlapping full title/mark/Back/Sign out bounds, exact HTTP audit, zero guard violations and logout clearing. All eight synthetic app-surface captures and both OS launcher captures were inspected. The compact header preserves controls at large text, and the shortened error-page copy retains read-only and non-eligibility meaning. No blocking source, asset or captured UX finding.

Full regression: **467 tests passed**, analyzer clean, formatter **62 files / zero changes**. Exact commands, devices, packaged metadata, screenshot hashes and provenance are in `evidence/native-presentation`. Task-created Android/iOS devices were stopped/removed; existing data was preserved. The full N02 native matrix was not repeated because this was a focused presentation change.

Acceptance covers synthetic native rendering and actual launcher appearance. Tester Back/tap and layout/semantic bounds do not establish OS gestures, screen-reader traversal, physical-device accessibility, live Clerk/API authorization, secure storage, callbacks or release/store readiness. Resulting-head CI remains separately required.


### N03 generator portability addendum — 2026-11-01

Independent maintenance-tool review accepted PATH discovery, task-specific executable overrides and a clean temporary output root. Seven checks passed: outside-repository invocation through PATH (including spaces), explicit overrides with empty PATH, missing rsvg, missing ImageMagick, wrong version, nonempty output and direct symlink output. Both successful runs reproduced all 22 PNGs and the manifest byte-for-byte. Failure cases were actionable and preserved existing content; missing/wrong tools created no output directory.

Only the generator and its instructions changed; UI, native source, canonical SVG and derivative assets remained unchanged. No global install/settings or native rerun was needed. Generator hash and detailed results are in `evidence/native-presentation/README.md` and `generator-portability-results.json`. Existing native results retain their original source basis rather than being relabelled as a new native run.


## N04 independent Android OS-input review — 2026-11-01

Accepted for the bounded Android system Back slice at **b2b6aecdd3e0dce4a2a9e7854559fef874242ded**; iOS actual edge swipe remains blocked/not run because native computer-use inventory reported the Mac locked. No host settings or unlock workaround was used.

Both independent 100% / 200% runs confirmed Requests detail → list, Inbox conversation → list → Account, and Account → Home using separately logged adb KEYCODE_BACK commands and production-model observations. Logout/private-state/fixture-guard assertions completed before terminal Back; actual terminal Back then finished the Activity and returned to the launcher at both scales. This does not constitute normal drive-suite completion, observed Dart teardown or post-relaunch session persistence. Host cleanup was independently verified.

Review caught a test-only sequencing defect in initial d9e5c189: terminal Back destroyed the Activity before the second scale, and relaunch restarted the harness rather than resuming it. Author corrected scale selection and pre-exit assertion ordering; both scales reran at the final source. No production defect or source change was needed. Native hierarchy review at both scales found labelled, focusable button controls and observed target rectangles at least 48 dp; representative OS screenshots show no header/control overlap and readable scrollable large text. This is not TalkBack/VoiceOver speech or focus-traversal proof.

Full local regression **467 passed**, analyzer clean, formatter **63 files / zero changes**. Evidence, ten delivered inputs, eight route observations, two pre-exit checkpoints, twelve full OS screenshots, native XML and source limits are in `evidence/native-navigation`. Fresh task Android runtime/data was removed; no iOS runtime created. Other child routes, predictive/hardware gestures, physical devices and live auth/API/storage/callback isolation remain open. Resulting-head CI is separate.
