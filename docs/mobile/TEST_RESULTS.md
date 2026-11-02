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
