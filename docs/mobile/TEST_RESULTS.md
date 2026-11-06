# Independent mobile test report

Date: 2026-11-01. Branch: `codex/mobile-foundation`, based on `fb4a245721ffdd69dd0255c0ef021e6b6fbb08ed`. Reporter: Flutter Architect reassigned as Mobile Test Engineer. Reporter authored scaffold/platform baseline, but did **not** author application `lib/` behavior under test. Application semantic fixes remained manager-owned; reporter applied formatter only to `lib/`.

## Executed checks

Working directory: `apps/mobile`. SDK: `/private/tmp/bundleen-flutter-toolchain`, Flutter3.47.9/Dart3.13.7, exact framework revision `c197ca5199e9ee5661e865596c9c07294dfab51c`.

```sh
/private/tmp/bundleen-flutter-toolchain/bin/dart format --output=none --set-exit-if-changed lib test
/private/tmp/bundleen-flutter-toolchain/bin/flutter analyze
/private/tmp/bundleen-flutter-toolchain/bin/flutter test
```

Final results: formatter clean (9 files unchanged); analyzer **no issues found**; combined tests **33 passed**, exit0. No test was skipped. A previous application brace lint was returned to the manager and fixed; two screenshot-test lints were fixed by the test owner. An initial fake auth signature mismatch was corrected after the application introduced forced refresh. A widget test's asynchronous HTTP stream handling was moved into `tester.runAsync`; final combined verification passed.

## Test inventory

`test/mobile_test.dart`: **29 tests**.

- Configuration: 8 cases covering absent configuration, HTTP, URL credentials/path/query/fragment/empty origin, live-key mismatch and unknown environment.
- Contracts/isolation: 4 cases covering strict required types/nonnegative integers, mismatched user identity, mismatched role, and no homeowner dashboard request for a provider.
- Transport: 11 cases covering total streaming deadline/cancellation, cancellation of a late send response, exactly one forced-token retry on401, no request without session, redirect refusal and external-origin rejection, HTML/array/oversized bodies, timeout, and status mappings403/409/429/503 without retry.
- Session state: 3 cases covering failed initialization and successful retry, late data after sign-out, and unconfirmed logout clearing data while blocking authentication until retry succeeds.
- Widgets: 3 cases covering signed-out200% text, denied access with retry and no protected data, and an unconfigured build with no sign-in action.

`test/evidence/screenshots_test.dart`: **4 tests**, one per fixture capture: signed-out, homeowner dashboard fixture, denied-access error, and200% text. Captures use390×844 logical dimensions at2× pixel resolution.

## Screenshot evidence and limits

Generated, ignored artifacts:

- `apps/mobile/build/evidence/widget-fixtures/signed-out.png`
- `apps/mobile/build/evidence/widget-fixtures/dashboard-fixture.png`
- `apps/mobile/build/evidence/widget-fixtures/error.png`
- `apps/mobile/build/evidence/widget-fixtures/large-text.png`

Dashboard and large-text captures were visually inspected: readable content, no observed clipping/overflow in those captured viewports. These are **fake-backed widget renders**, not device screenshots or live-server evidence. The tests load SDK Roboto as fixture text, including a substitute for the serif family; they do not establish final native font fidelity, brand approval, screen-reader behavior, keyboard handling or all scroll positions. Fixture resident and savings values are synthetic test data, not real users or marketing claims.

## Native compile evidence

Reporter ran `/private/tmp/bundleen-flutter-toolchain/bin/flutter build ios --simulator --debug --no-codesign` after authentication engineer's native bridge files were ready. Result: **passed**, Xcode build49.3s; artifact `apps/mobile/build/ios/iphonesimulator/Runner.app`. This proves simulator compilation only. Authentication/Security Engineer owns native implementation and subsequent native builds, Android compile outcome and device/runtime validation. No Android result is asserted by this report. No application launch or live sign-in was performed by this reporter.

## Gate decision evidence

Local Dart/widget prerequisite checks pass. Phase2 live authenticated slice gate remains open: test/staging credentials and approved identities, actual sign-in/sign-up/renewal/sign-out/deep-link behavior, live server-backed context/read, and iOS/Android runtime isolation must still be demonstrated. CI workflow exists but this local report does not claim a remote CI pass, release artifact/signature, store readiness or product parity.

## Additional actual iOS runtime smoke

After the report above, performed a limited real simulator launch on a previously **Shutdown** iPhone17 (`CEF9288A-AAED-41D2-9070-32CC401AA6BC`), runtime iOS26.4 (26.4.1 build23E254a). No already-running user simulator was altered. Installed the compiled `Runner.app`, then `xcrun simctl launch … com.bundleen.bundleen` returned process47230 successfully. Captured and visually inspected `docs/mobile/evidence/ios-no-config-runtime.png` (1206×2622): Bundleen displays “This build needs a configured environment before sign-in is available.” The app was then terminated and this simulator shut down successfully.

Commands used: `xcrun simctl boot <udid>`, `bootstatus <udid> -b`, `install <udid> apps/mobile/build/ios/iphonesimulator/Runner.app`, `launch <udid> com.bundleen.bundleen`, and `io <udid> screenshot <absolute-evidence-path>`. The initial relative screenshot destination failed; retry with the absolute path succeeded. This is actual **unconfigured-runtime** evidence, distinct from widget fixtures. No environment defines, credentials, backend requests, sign-in or dashboard integration were supplied or exercised. It does not close the live authenticated-slice gate.

## Native-channel behavioral regression iteration

Added `apps/mobile/test/native_auth_contract_test.dart` independently of application implementation: **8 additional tests**, bringing the combined suite to **41** (29 application/transport cases +4 widget captures +8 native-channel cases). Full `flutter test` passed41; `flutter analyze` found no issues; formatter reported clean. Following independent review, tightened the sign-in/sign-up cases to require the exact user-selected native mode on cancellation **and** recovery, and verified initialization forwards the expected public publishable configuration. Re-ran the affected file:8 passed, analyzer clean, formatter applied. No application code changed in this iteration.

The new cases exercise the real Dart `NativeAuthSession` against the mocked binary messenger, through API/model observable behavior:

1. Sign-in cancellation leaves the view signed out without HTTP requests; retry loads the account.
2. Sign-up cancellation and retry preserve sign-up intent and recover.
3. Native error differs from cancellation, does not leak provider details, and permits retry.
4. API401 forces token renewal, sends the replacement bearer token and succeeds.
5. A rejected replacement bearer token ends after exactly two requests.
6. Failed native sign-out clears sensitive state, blocks new authentication and recovers after sign-out retry.
7. A late successful native sign-in cannot restore the view after sign-out.
8. A late native initialization result cannot restore the session after sign-out.

Commands from `apps/mobile`: `dart format test/native_auth_contract_test.dart`, `flutter analyze`, `flutter test test/native_auth_contract_test.dart`; the earlier complete iteration used `flutter test`. All used `/private/tmp/bundleen-flutter-toolchain/bin/` executables. Tests use synthetic tokens and local HTTP fakes. They verify Dart channel integration and observable state, **not** native Clerk SDK behavior, OS token storage, browser callbacks, actual device auth, session revocation or live backend acceptance. Those runtime/live gates remain open.

Manager verification after the mode/config correction: formatter clean, analyzer no issues, full41 tests passed. Reviewer then requested an explicit getToken dispatch assertion alongside replacement-token outcome checks; added it and reran the affected8 tests successfully with formatting clean. No source behavior changed. Resulting-head remote CI evidence is maintained in draft PR42 after the scoped push.

## Requests browsing iteration — independent final verification

Independent reviewer authored28 requests regressions plus4 capture cases; final complete Flutter suite **73 passed** after compact-list refinement. `flutter analyze` reports no issues; `dart format --output=none --set-exit-if-changed lib test` reports15 files,0 changes. Commands used pinned /private/tmp/bundleen-flutter-toolchain/bin from apps/mobile. Final full log: /private/tmp/bundleen-requests-final-tests.log.

Coverage: distinct list/detail source contracts, nullable money, malformed date/cents, opaque-ID encoding and response-ID mismatch;403/404 detail denial without cached-list fallback; all eligibility reasons and ignored untrusted actionPath; HOA unsupported detail; wrong-role no navigation/network; empty/error/retry; owner/signout/expiry generation fences;200% scrolled list→detail and platform back; simulated iOS edge-swipe and logout route removal; rapid same-request reopening. R01-S1 regression confirms401 followed by native refresh failure clears global protected state; separate initial-token failure remains recoverable without false logout. Security reviewer independently verified those two focused cases.

Four final fixture screenshots are in evidence/requests; README identifies fake data, dimensions, font substitutions and limitations. Initial detail scroll/native gesture issues were fixed with separate actual nested routes and scroll keys, then affected/full tests passed. No server tests or native compile run is claimed by this test report; release operations records them separately. No live API/authentication, real iOS/Android gesture, secure storage, revocation or cross-community runtime evidence was obtained. Phase2 live gate remains open.


## R02 local independent verification — 2026-11-01

- Added 29 Account/notifications contract, model, transport and widget cases in `account_test.dart`, plus four synthetic capture cases in `evidence/account_screenshots_test.dart`.
- Final complete `flutter test`: **106 passed** (includes regenerated prior Requests captures and regressions). `flutter analyze`: **No issues found**. Final formatter check: 22 files, zero changes.
- Covered ID/role binding, public-role navigation, nullable/strict dates, GET-only behavior, 303/403/500 retry, profile errors, notification 401 and forced-renewal failure clearing global state, owner/navigation late responses, 30-row preservation, inert arbitrary links/plain text, native-style back/iOS edge swipe and signout route removal, 200% text flow, and year+UTC-offset shared dates.
- Initial widget failures were test assumptions about lazily built offscreen fields and `.first` on an absent finder; test harness corrected without app changes.
- Inspected four Account captures and refreshed Requests list/large-text captures. Evidence is synthetic with fake auth, MockClient and substituted fonts; no live API, device, native authentication, or screen-reader proof. Resulting-head CI/build evidence must be recorded separately after push; no earlier-head run proves R02.


## R03 local independent verification — 2026-11-01

Added 42 cases in provider_test.dart and five synthetic scenarios in evidence/provider_screenshots_test.dart. Final complete flutter test: **153 passed**. flutter analyze: **No issues found**. dart format --output=none --set-exit-if-changed lib test: **27 files, zero changes**.

Coverage includes all required rendered fields, nullable versus zero values, three statuses/unknown rejection, numeric boundaries/NaN/infinity, exact GET/envelope/no identity query, all-role endpoint isolation, 403/409/framework500/malformed retry with Account retained, forced-renewal401 global clearing, late signout/owner/role changes, and 200% navigation. Five inspected captures are stored in evidence/provider with fixture-only provenance. Initial lint was corrected in test code; no failing application regression was observed. The reviewer requested a provider-only generic-hero removal for readability; final run and captures include that source change.

No live API or native build was run for R03 by this reviewer. Resulting-head CI/build and authenticated device/isolation evidence remain separate requirements; prior R02 proof is unchanged and does not verify R03.


## R04 local independent verification — 2026-11-01

Added43 cases in support_test.dart plus4 synthetic captures. Final complete flutter test: **200 passed**. flutter analyze: **No issues found**. Final formatter: **32 files, zero changes**.

Coverage: required rendered fields/null community,100-row GET-only list and encoded detail ID/match, all lifecycle statuses, empty visible conversation, strict internal_note/unknown/fromAi rejection, plain multiline bodies,403/404/409/500 no-fallback retry,1MiB oversized response rejection, list loading/empty/failure, public-role gate, forced-renewal401 global clearing, stale owner/list/detail/old401 results,200% actual list-button navigation/scroll reset/message reachability, platform back/iOS edge swipe/logout, and rapid route switching/reopen. Constructor compile failure was corrected by author; final test-only lint fixed before clean full run.

Four captures copied to evidence/support with synthetic provenance. No live API, native build, device accessibility or actual managed-community isolation check performed by this reviewer. Existing R03 exact-head CI proof is unchanged; R04 requires resulting-head CI and the same live runtime gates.


## R05 local independent verification — 2026-11-01

Added48 Opportunities regression cases and4 synthetic capture scenarios. Final complete flutter test: **253 passed**. flutter analyze: **No issues found**. Final formatter: **37 files, zero changes**.

Coverage includes all required rendered fields, null values, enums/numeric/date validation, eligibility contradiction, empty feed, exact GET/envelope/200rows, duplicate/over-cap rejection, role isolation,403/409/500 retries preserving Account,1MiB workspace rejection, refresh replacement/expansion clearing, late clear/owner/tab-close/signout responses, late old401, global forced-renewal expiry,200% actual inline expansion/plain text and back, private text omission and no mutation/per-ID calls. Test-only brace lint corrected before final clean full run; no app defect observed.

Four inspected screenshots copied to evidence/opportunities with synthetic provenance. Native builds/live API/provider isolation were not run by this reviewer; resulting-head CI must verify R05 separately from historical R04 proof. Workspace network-payload/privacy and1MiB limitations remain explicit.

R05 final checkpoint also includes one additional Home→Requests monetary-display regression after source review found missing currency authority for savings/lowest bid. Both displays were removed; explicitUSD request budgets remain visible. Final post-correction total **253 passed**, analyzer clean, formatter37files/zero changes. Home and Requests screenshots regenerated, inspected and refreshed. This records a contract-gap correction, not a production-data incident; no server change was made.

R05 final capture maintenance: refreshed provider fixtures for the new Opportunities navigation tab. Legacy Home capture harness now loads SDK MaterialIcons, replacing missing-glyph boxes; this is a fixture correction only. Post-fix full253tests, analyzer and formatting remain clean.


## R06 local independent verification — 2026-11-01

Added43 coverage tests plus4 synthetic captures; updated existing Home/Requests parser assertions for ignored unused monetary extras while retained USD budgets remain strict. Final complete flutter test: **300 passed**. flutter analyze: **No issues found**. Final formatter: **42 files, zero changes**.

Coverage includes lazy provider-only canonicalGET, required/null/type fields, radius boundaries/nonfinite rejection, legacy postal-only data, strict active status/date,12rows without truncation or primary invention,403/409/500 retry, empty state,1MiB rejection preserving Account, refresh/late owner/close clearing,401failed-renewal global expiry,200% actualbutton flow, privatefield absence/plaintext, platformback/iOSgesture/signout and rapid Account-child route switching. Affected105-test run and final fullsuite both passed; no application fix was needed by this reviewer.

Four inspected screenshots copied to evidence/coverage with synthetic provenance. No native build/live API/provider isolation verification by reviewer; resulting-head CI is required independently of historical R05 proof. Exact address/geometry still travels in authorized network responses before projection, bounded by the existing transport limit.


## R07 local independent verification — 2026-11-01

Added39 Community cases plus4 synthetic captures. Final post-heading-refinement flutter test: **343 passed**. flutter analyze: **No issues found**. Final formatter: **47 files, zero changes**.

Coverage: exact British endpoint/lazy homeowner product gating, no manager or per-ID calls, nullhub versus emptyfeed, requiredfields/canonicaldates/safecounts,50cap/duplicate/communitybinding, unknownstatus inert, privatepayload omission and managerflags without actions, plain inline text,1MiB/timeout/error recovery preservingAccount, revoked-null refresh clearing, forced-renewal401 and stale owner/role/signout/old401 fences,200% actual four-tab/Show description/back flow. No source defect found; readability refinement replaced awkward large-text Neighborhood heading with Community.

Four Community captures inspected/copied; prior homeowner Home/Requests/Account/Support captures refreshed to four tabs. Fixtures use fake auth/API data and substitute fonts. No live API/nativebuild/device-isolation check performed by reviewer; resulting-head CI and established live gates remain separate from historical R06 proof.


## R08 local independent verification — 2026-11-01

Added44 reviews tests plus4 synthetic captures. Final complete flutter test: **391 passed**. flutter analyze: **No issues found**. Final formatter: **52 files, zero changes**.

Coverage: required/null fields, rowrating and serveraverage/count bounds, canonicaldate, exact20/0 GET and20unique cap, no summary/list consistency assumption, providerlazy role isolation, pending/suspendedread,403/409/500 retry preservingAccount, oversized/timeoutfailure, refreshmoderation removal, owner/close/role/old401 fences and globalexpiry, actual200% navigation/plaincomments/privateomission/back, iOSedge and rapidAccountchild switching/signout. Four screenshots inspected/copied to evidence/reviews with synthetic provenance; no application fix needed.

No live API/moderation/provider-isolation/nativebuild check by reviewer. Resulting-head CI and established SDK/device/live gates remain separate from historical R07 proof.


## R09 local independent verification — 2026-11-01

Added45 Inbox cases plus5 synthetic captures. Final complete flutter test: **441 passed**. flutter analyze: **No issues found**. Final formatter: **57 files, zero changes**.

Coverage includes exact role mapping/lazyGET, encodedlistedID/detailquery50/0,100list/50message uniqueness bounds, requiredfields/canonicaldates/nullpreview, thread/message binding, untrustedrole rejection, onlyGET/no read/send calls,403/404/409/500 nofallback retry,1MiB/timeout errors preservingAccount, refreshreplacement and stale owner/role/close/old401/globalexpiry, actual200%button/scrollreset/back, iOSedge/reopen and allAccountchild clearing. Five captures inspected/copied to evidence/inbox. No appsource correction needed.

Mock tests do not establish live cross-participant privacy or actual receipt nonmutation; those require staging evidence. No server/live/nativebuild performed by reviewer; resulting-head CI remains separate from historical R08 proof.


## N01 local independent verification — 2026-11-01

Added26 flavor/config cases. Full flutter test: **467 passed**; flutter analyze: **No issues found**; formatter: **58 files, zero changes**. Eight compiled --flavor scenarios separately passed26 cases each, exercising accepted factory configurations and rejected real main startup with zero native-auth calls/HttpClient creation. Production/missing/mismatch inputs fail closed.

After author resolved disabled Android resValues, debug builds passed: Android development11.9s/staging12.8s; iOS simulator development36.0s/staging89.4s. Effective suffix IDs/labels and Android callback/shared-session/backup metadata inspected. Both variants installed side by side and rendered no-config UI on fresh task-owned Android API36 and iOS26.4.1 devices. Six final screenshots inspected. Android initial system-process first-boot delay recovered after Wait and cold relaunch; no performance claim. Devices stopped/deleted afterward without touching existing device state.

Evidence and limitations: evidence/native-isolation/README.md. No live Clerk/API credentials, callbacks, authenticated UI, secure-storage isolation or physical-device accessibility tested. No production flavor/registration/signing/backend changes. Native simulator linker ad hoc signatures are not release signing. Resulting-head CI remains outstanding, separate from prior Inbox CI.


## N02 independent native fixture verification — 2026-11-01

Exact successful harness head: **4ac16367ed04206ea76cebecb15a72423c807bdb**. Android emulator5582/API36 and iPhone17 iOS26.4.1 simulator36131BF5-98C6-4B94-813A-AFF84C07D0B3 ran serially with flutter drive development flavor/test-only target and screenshot driver. Each passed5 authored scenarios (framework counter6 includes tearDownAll), exit0; Android34s/iOS32s journey timers.28 captures retained, representative100%/200% captures independently inspected; exact commands/OS/limits and SHA256 manifest in evidence/native-fixtures.

Initial5efbb418 Android run failed three journeys due test-helper lazy-finder/scroll-settlement defects; guard and homeowner100% passed. Test-only correction added settled/hit-testable/fatal-miss actions and robust restoration. Both entire platform runs repeated at4ac16367; no forced taps/skips/production changes. Guard self-checks passed on both native bindings; complete route audits and logout clearing/interactive semantics/effective scales passed.

Final full flutter test **467 passed**; analyzer **No issues found**; formatter **61 files, zero changes**. Task Android/iOS devices stopped/deleted and temporary AVD removed, with existing device data preserved. No real auth/API/ownership/callback/storage/platform-back/screen-reader/physical-device evidence. Native screenshots are synthetic app-surface rendering and tester input proof only. Resulting-head CI remains separate from prior N01 CI.


## N03 independent presentation verification — 2026-11-01

Tested source **15a88ee5075f7eb47f78b7c72f4a26c00334e2d2**. Two focused authored scenarios per platform passed on fresh Android 16 / API 36 and iPhone 17 / iOS 26.4.1 runtimes, driver exit 0. Framework counter 3 includes teardown. Retry was initially visible/hit-testable without route scrolling at 100% / 200%; title/mark/Back/Sign out bounds, exact request counts, guard violations and logout clearing passed. No runtime fix or skipped scenario was needed.

All four normal builds passed: Android development 11.5 s / staging 7.6 s; iOS simulator development 52.9 s / staging 42.9 s. Both-flavor packaged icon/label metadata and real OS launcher screenshots verified. All 22 asset hashes/dimensions/byte lengths passed, all iOS icon files opaque, and independent temporary generation exactly reproduced the manifest/output bytes with pinned tools.

Final complete unit/widget suite: **467 passed**. Analyzer: **No issues found**. Formatter: **62 files, zero changes**. Eight synthetic native app captures plus two OS launcher captures were independently inspected and indexed in `evidence/native-presentation`. Task devices were stopped/deleted and temporary AVD data removed; existing device/account data untouched.

This focused N03 run does not repeat the full N02 native matrix or establish live auth/API/callback/storage, OS back gestures, screen-reader/physical-device accessibility or distribution signing. Resulting-head CI remains separate.


### N03 generator portability addendum — 2026-11-01

Independent maintenance-tool review accepted PATH discovery, task-specific executable overrides and a clean temporary output root. Seven checks passed: outside-repository invocation through PATH (including spaces), explicit overrides with empty PATH, missing rsvg, missing ImageMagick, wrong version, nonempty output and direct symlink output. Both successful runs reproduced all 22 PNGs and the manifest byte-for-byte. Failure cases were actionable and preserved existing content; missing/wrong tools created no output directory.

Only the generator and its instructions changed; UI, native source, canonical SVG and derivative assets remained unchanged. No global install/settings or native rerun was needed. Generator hash and detailed results are in `evidence/native-presentation/README.md` and `generator-portability-results.json`. Existing native results retain their original source basis rather than being relabelled as a new native run.


## N04 Android system Back verification — 2026-11-01

Final source **b2b6aecdd3e0dce4a2a9e7854559fef874242ded** ran independently at 100% and 200% on fresh Android 16 / API 36 emulator-5586. Each scale recorded four actual KEYCODE_BACK route transitions and `N04_ASSERTIONS_COMPLETE` for scale/Account semantics/fixture guards/logout clearing. Each then received a fifth terminal Back and returned to NexusLauncher, verified by native screenshot and focused-window metadata. **Eight route checks and two pre-exit assertion checkpoints succeeded; no conventional completed-drive or Dart-teardown claim.** Drivers were stopped after Activity finish. Ten inputs are timestamped separately from model markers.

Initial d9e5c189 was partial: Android terminal Back finished the Activity, so one invocation could not continue to the next scale. Relaunch began a new test engine; no continuity was inferred. Author made only a test-protocol correction; both scales repeated at final source. iOS OS edge swipe was blocked by the locked Mac and not run. No host settings changed.

Full local suite **467 passed**, analyzer clean, formatter **63 files / zero changes**. Native metadata exposes labelled focusable buttons with observed rectangles >=48 dp at both scales; no spoken screen-reader/focus-traversal claim. Twelve full Android OS screenshots and native metadata are indexed in `evidence/native-navigation`. Task emulator and temporary AVD removed, inventory empty, existing data preserved. Synthetic identity/API only; no live auth/storage/authorization proof or unchanged N02/N03 native rerun.


## N04 iOS control retry addendum — 2026-11-02 UTC

After the human confirmed the Mac unlocked, native CUA inventory succeeded. A fresh task-owned simulator `94184537-A9E2-4DDE-AA7B-03A4947C0020` booted successfully in 31 seconds. However, documented `cua.getApp` selection of Simulator returned no app state and blocked for 709.6 seconds before root-agent interruption. After a successful CUA kernel reset, one bundle-ID retry with explicit `timeout_ms: 20000` again returned no state and was interrupted by the root agent after 81.9 seconds. Tool output calls these interruptions “by user”; they were agent interruptions, not human input.

The current blocker is **supported Simulator UI control hanging despite the unlocked host and booted simulator**, superseding the earlier lock-only explanation. No alternate input injection or host settings changes were attempted. No iOS build, test, gesture or receipt acknowledgement ran. Prepared source **7c997ee933ca598073ad402ea40a1df0fd299add** adds a test-only receipt handshake and same-engine post-swipe private-state assertions; that protocol remains unexecuted, with source/analyzer review reported separately by the author/manager. Android evidence retains its earlier source basis and was not rerun.

Only the exact fresh task simulator was shut down and deleted; booted inventory was then empty. Sanitized attempt details are in `ios-control-limitation.json`. iOS actual edge swipe and signed-out post-input clearing remain open. There is no iOS application failure or gesture-pass claim.


### Receipt protocol local verification — 2026-11-02 UTC

Final local working-tree verification after the test-only receipt-gate extraction: **474 tests passed**, including seven receipt rejection/lifecycle cases; analyzer clean; formatter **66 files, zero changes** (including `tool`). The real test extension uses the tested gate. Cases cover absent/wrong receipts, replay, stale/replaced checkpoints, teardown invalidation and empty identifiers. Independent security review also ran the seven cases and found no actionable issue. These are local protocol/source checks, not actual CUA input, native receipt execution or same-engine post-gesture evidence. The iOS control blocker remains unchanged; no device rerun occurred. Tested-file hashes are preserved in `receipt-local-verification.json`; the manager's resulting commit/CI remains separate.


## N04 minimum XCTest prototype review — 2026-11-02

Source **1f84897c31f663af27445423533d0d2c6458bd17**, command-only checkpoint **6a55f892f8b504dda86abf0bfea167ec8514580b**: test build passed without signing credentials; the separate UI runner launched the synthetic development app once on a fresh iPhone 17 / iOS 26.4.1 simulator. The one 100% Requests prototype then **failed the ready-marker predicate** at Swift line 14 after 64.9748 seconds (command exit 65). No drag call, delivery marker or independent observed destination was reached. Native gesture count is zero. The visible Requests-detail screenshot establishes setup only; available logs do not distinguish an absent marker from an unexpected label/state.

Two earlier exit-64 command validations (unsupported iteration count, then existing result path) occurred before app launch and are documented separately. No runtime retry/recovery or production fix occurred. Source review corrected model disposal/fatal missed setup taps before compilation. Compact structured evidence is in `evidence/native-xcui-prototype`; the raw result bundle and automatic screen recording remain at the documented task-local paths.

Both development/staging generated configs and export scripts were explicitly restored to `lib/main.dart`; exact task simulator deleted, booted inventory empty. Local regression **474 passed**, analyzer clean, formatter **67 files / zero changes**. Prototype acceptance is **not passed**: iOS edge gesture and same-engine post-input gates remain open. No other native matrices, host settings, credentials or live services were touched.


## N04 corrected readiness diagnostic — 2026-11-02

One authorized fresh rerun at **01bacee5bf0ecb87d1a503bd04f0a83c9dd17f3d** compiled successfully (82.37 s) and failed the unchanged native readiness wait (test 64.751 s; process 91.35 s, exit 65). Unlike the first run, available evidence now discriminates the boundary: Dart logged successful local marker semantics, detail setup and READY with resumed lifecycle; the screenshot visibly shows ready. XCTest's preserved components report **foreground=true, markerExists=false, label=absent**, and its tree exposes only native containers. Native PID 17898 matches the PID in the unchanged Dart nonce/isolate identity. The underlying native accessibility cause remains unestablished.

No coordinate drag was reached: **zero native inputs and zero observed destinations**. This remains a failed prototype/readiness gate, not a production navigation defect or iOS gesture pass. Separate sanitized evidence and hashes are in `evidence/native-xcui-prototype/corrected-readiness`; first-run evidence remains unchanged. No wait/check was weakened, no recovery/relaunch performed and no host accessibility settings changed.

Exact task simulator deleted; generated development/staging config and export targets explicitly restored/verified as `lib/main.dart`. Final local corrected-source checks: **474 tests passed**, analyzer clean, formatter **67 files / zero changes**. No other native matrix rerun or live auth/API claim. Further runtime work is paused pending manager scope; iOS gesture, post-input logout and broader matrix gates remain open.


## N04 semantics forwarding experiment — failed / partial

Source: `08f3b245c4afee62df5a9f18e3e1a6ca4c7d2820`. One fresh iPhone 17 / iOS 26.4.1 simulator, `E94EA66C-11DC-4705-92B4-59E6502C78A5`, one XCTest launch, no retry or recovery. Synthetic auth/API fixture; no live account proof.

The real Flutter native accessibility marker was found and its ready identity validated, unlike the preserved `01bacee` readiness failure. One public XCTest coordinate drag was delivered at 2026-11-02T19:38:25Z from (4.02, 437) to (341.7, 437), normalized (0.01, 0.5) to (0.85, 0.5), with a 0.1-second press. Native event target PID 24204 matches identity `1793648302473383|24204|isolates/2527935443000647`.

The unchanged destination wait failed: no Dart OBSERVED milestone or accepted detail-to-list destination. Test duration 27.689 seconds; command exit 65 after 73.43 seconds. Accessibility exposure and actual input delivery are partial evidence only; Requests native navigation is NOT accepted. The screenshot is the ready state before input, not a destination image. No post-input successful guard/model assertion is claimed.

Build exited 0, but its wall-clock elapsed report is anomalous (3579.48 seconds despite a 600-second configured timeout). The wrapper uses subprocess wait with a monotonic deadline and time.time for reporting; the clock discrepancy's cause is unknown. Compilation success is separate from bounded wall-duration proof. See preserved command result and watchdog provenance.

Raw result bundle and automatic video remain in `/private/tmp/bundleen-n04-xcui-forwarding/Result.xcresult` and its attachments directory. Committed logs contain only selected Dart milestones, not ephemeral VM URLs. Native UI snapshot attachment does not provide a complete descendant tree; marker lookup success is the evidence of exposure.

Cleanup reconciled: task simulator absent, remaining devices shutdown, no matching prior task process. Both explicit development and staging config-only builds restored lib/main.dart successfully. Source/config exclusion found no fixture reference in production lib and only RunnerTests in normal schemes; normal artifact rebuild was not performed. Local checks: 474 tests passed, analyzer clean, formatter 67 files / zero changes.

Source-only follow-up: the pinned live test binding defaults shouldPropagateDevicePointerEvents to false and gates real device input; tester-generated events take a different path. This is a next hypothesis, not an established cause or successful fix. Further execution requires a separate exact checkpoint and authorization.

Evidence: `evidence/native-xcui-prototype/semantics-forwarding`.


## Pointer forwarding checkpoint — blocked before runtime

Source `447783746f809d4b1363ee78a57e5b97d6488da6` independently accepted for scoped testing. Automatic approval service disconnected before configuration execution; no app build/launch/input occurred. Execution stopped without retry. Fresh simulator A03C2862-A90C-40E3-9931-CDD29A2108ED shutdown/delete exited 0; current generated config/export still lib/main.dart. See `evidence/native-xcui-prototype/pointer-forwarding-blocked/README.md` for exact service error and scope. Native acceptance remains open.


## N04 one-route native prototype passed — 2026-11-05

At `933a153` (mobile source identical to reviewed `4477837`), the single fresh iOS 26.4.1 / iPhone 17 XCTest run passed: actual public edge drag returned Requests detail to list at 100%, with exact unchanged nonce/PID/isolate native marker and independent Dart destination/foreground/guard assertions. Case 17.271 s; test command 37.48 monotonic s, exit 0. Ready/observed screenshots independently inspected. Standalone Dart console unavailable; no completed teardown transcript claimed.

Exact task simulator deleted and absence verified; both normal flavor entrypoints explicitly restored and checked. Wall/monotonic clock divergence preserved without inferred cause. Only this synthetic one-route prototype is accepted; broader iOS navigation, 200%, logout, live authentication and screen-reader gates remain open. See `evidence/native-xcui-prototype/pointer-forwarding-passed` for exact commands, identity, artifacts, cleanup and limitations. Prior failures remain unchanged.


## N04 full matrix first run — failed / partial

At source 39c0dd3, one controlled iOS run delivered three 100% native drags. Requests detail→list and Inbox conversation→list passed their correlated observed checkpoints; Inbox list→Account failed an exact helper-text finder at Dart line 366 after a complete DEVICE sequence. Native marker disappeared after Dart failed/teardown. No signed-out/200%/final complete evidence. Case 46.577 s, command exit 65 at 72.83 s; no retry. Exact task simulator deleted, both normal main configs restored/verified. See `evidence/native-xcui-matrix/first-run` for sanitized discriminated failure, native facts and screenshots. Matrix acceptance remains open.


## N04 Account correction run — failed / partial, 2026-11-06

At exact b0c815b, all four 100% native checkpoints passed, including current visible Account destination and signed-out actual DEVICE input followed by two-second settling/private-state-clear assertions in the same engine. The first 200% step then failed its exact “Your requests” text finder after a completed DEVICE sequence. Five native deliveries, four accepted checkpoints; no final complete. Case 90.246 s, command exit 65 at 120.06 s; no retry. Exact task simulator deleted, both normal flavor main configs restored/verified using restored pinned SDK. See `evidence/native-xcui-matrix/account-correction-run`. Full matrix remains unaccepted; live auth and broader accessibility claims remain excluded.
