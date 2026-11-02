# N04 XCTest prototype (synthetic, 100% only)

This test-only prototype covers one native left-edge drag from Requests detail to
its list. It does not establish the full iOS matrix, logout behavior, live auth,
physical-device behavior, or screen-reader usability. No production entry point
imports the fixture. The normal development/staging schemes do not include the
UI-test bundle, and the `n04-ui` scheme has no archive action.

`N04NavigationUITests` owns exactly one initial `XCUIApplication.launch()`. There
is no Flutter drive launch, activate, recovery launch, or mid-checkpoint install.
Dart performs labeled setup taps, then exposes `N04Marker` with
`N04|engineNonce|processId|isolateId|ready`. XCTest records that identity, checks
foreground state and the unchanged marker, then calls the public iOS
`coordinate(withNormalizedOffset:).press(forDuration:thenDragTo:)` API. Dart
independently observes the production Requests model, checks detail removal and
list visibility, unchanged isolate and uninterrupted foreground lifecycle, and
publishes the same identity with `observed`. XCTest requires that exact result.
The marker is passive: it accepts no commands or receipts. No VM attach is needed
for this minimum prototype; process/isolate values are fixture-reported and
correlated across the same engine nonce, not an external process inspection.

A background transition or changed marker invalidates the checkpoint. Startup
has a 60-second marker deadline; Dart has a 90-second input deadline and XCTest a
20-second result deadline. The result remains visible for 15 seconds. XCTest UI
quiescence is an unproven runtime prerequisite: a timeout fails this prototype;
it must not be worked around by tester navigation or disabled idleness.

## Reviewer execution after source checkpoint

Use one fresh task-owned simulator UDID. Do not use an already-running user's
simulator. Record source SHA, Xcode/SDK, UDID/model/OS, exact commands, result
bundle and correlated marker identity. The independent reviewer owns device
creation/boot, process deadline and cleanup. No runtime was run by the author.
From `apps/mobile`, with `FLUTTER` the pinned SDK executable and `N04_UDID` the
reviewer's explicit fresh device, and `N04_OUTPUT` a new task-local directory:

```sh
"$FLUTTER" build ios --config-only --simulator --debug --flavor development --target integration_test/xcui_navigation_test.dart
xcodebuild build-for-testing -workspace ios/Runner.xcworkspace -scheme n04-ui -configuration Debug-development -destination "platform=iOS Simulator,id=$N04_UDID" -destination-timeout 30 -derivedDataPath "$N04_OUTPUT/DerivedData" CODE_SIGNING_ALLOWED=NO FLUTTER_TARGET=integration_test/xcui_navigation_test.dart
xcodebuild test-without-building -workspace ios/Runner.xcworkspace -scheme n04-ui -configuration Debug-development -destination "platform=iOS Simulator,id=$N04_UDID" -destination-timeout 30 -derivedDataPath "$N04_OUTPUT/DerivedData" -resultBundlePath "$N04_OUTPUT/Result.xcresult" -parallel-testing-enabled NO -test-iterations 1 -test-timeouts-enabled YES -default-test-execution-time-allowance 150 -maximum-test-execution-time-allowance 180 CODE_SIGNING_ALLOWED=NO
```

Before execution inspect the generated `.xctestrun` for the intended UI-test
bundle and fixture Runner.app. The test runner is the only launch owner. Repetition, retry, relaunch and recovery are prohibited; stop on first failure. Use a
host-owned bounded process deadline (build 10 minutes, test 4 minutes); terminate
only that owned subprocess on timeout and fail, without recovery. Preserve the
result bundle's `synthetic-n04-100-ready` and `synthetic-n04-100-observed`
attachments. No actual native-input claim is warranted until the independent run
passes; a build alone is not evidence. Stop/delete only the task-owned simulator
after the result or failure is recorded.

## Required local config cleanup, even after failure

Preflight found the ignored Generated.xcconfig still pointed at a prior
presentation fixture. Do not restore that stale snapshot. Explicitly regenerate
both normal variants and verify the generated configuration/export after each:

```sh
"$FLUTTER" build ios --config-only --simulator --debug --flavor development --target lib/main.dart
rg 'FLUTTER_TARGET' ios/Flutter/Generated.xcconfig ios/Flutter/flutter_export_environment.sh
"$FLUTTER" build ios --config-only --simulator --debug --flavor staging --target lib/main.dart
rg 'FLUTTER_TARGET' ios/Flutter/Generated.xcconfig ios/Flutter/flutter_export_environment.sh
```

Both must contain only `lib/main.dart` as the target. Normal CI builds retain the
default main and do not use `n04-ui` or any integration-test target. This cleanup
is not a substitute for native-build or runtime evidence.
