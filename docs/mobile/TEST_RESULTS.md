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
