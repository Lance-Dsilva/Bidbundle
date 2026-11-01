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
