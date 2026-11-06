# N04 XCTest synthetic navigation matrix

The current source implements the approved eight-drag matrix in
`docs/mobile/N04_IOS_MATRIX_PLAN.md`: Requests detail, Inbox detail, Inbox list,
and a signed-out edge drag at 100% and 200%. One XCTest launch and one engine span
both groups. Fresh synthetic auth/models between groups are explicitly setup,
not persistence evidence. Native runtime acceptance of this matrix is pending.
Earlier one-route attempts/results below remain historical evidence only.

`NativeInputBinding` is instantiated first and asserted as the installed binding.
It captures DEVICE provenance synchronously inside dispatchEvent, records only
immutable facts, and always delegates unchanged to super. The pure accumulator
rejects wrong origin/source/pointer/view, cancellation, incomplete or duplicate
sequences. It never drives navigation. Device forwarding is restored before any
fallible teardown; semantics are never programmatically disabled.

The real Flutter `N04Marker` stays mounted across model replacement. Its schema
is `N04|nonce|pid|isolate|scale|step|name|phase|sequenceCount`; XCTest requires exact
steps 1–8 and unchanged identity, plus the final complete marker. The passive
`N04PointerFacts` semantics label contains correlated bounded JSON with actual
DEVICE down/move/up counts, pointer/view and normalized start/end positions.
XCTest validates and attaches each summary after observed. These are observations,
not an acknowledgment/command surface. Each signed-out step requires completed
DEVICE input, two seconds of settling and all public private-state-clear checks.

All Dart input/hold/layout deadlines use Stopwatch. Bounds: ready 60 seconds,
input 90 seconds, native observed 20 seconds, observed hold 15 seconds and final
complete 30 seconds. Setup taps are labeled setup; only XCTest's public coordinate
press/drag supplies the eight acceptance inputs. Failure stops the run without
retries or recovery. No production entry point imports these helpers, and no
normal scheme includes the UI-test target. Native quiescence remains a prerequisite;
a timeout is failure and cannot be bypassed by tester navigation.

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
xcodebuild test-without-building -workspace ios/Runner.xcworkspace -scheme n04-ui -configuration Debug-development -destination "platform=iOS Simulator,id=$N04_UDID" -destination-timeout 30 -derivedDataPath "$N04_OUTPUT/DerivedData" -resultBundlePath "$N04_OUTPUT/Result.xcresult" -parallel-testing-enabled NO -test-timeouts-enabled YES -default-test-execution-time-allowance 900 -maximum-test-execution-time-allowance 960 CODE_SIGNING_ALLOWED=NO
```

Before execution inspect the generated `.xctestrun` for the intended UI-test
bundle and fixture Runner.app. The test runner is the only launch owner. Omitting iteration/retry options uses the default single execution. Repetition, retry, relaunch and recovery are prohibited; stop on first failure. Installed Xcode rejects `-test-iterations 1`, so do not add that option. Use a
host-owned bounded process deadline (build 10 minutes, test 1020 seconds); terminate
only that owned subprocess on timeout and fail, without recovery. Preserve the
result bundle's eight delivery records, eight DEVICE fact summaries, sixteen
ready/observed screenshots and final-complete screenshot. No actual native-input claim is warranted until the independent run
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

## Readiness instrumentation refinement

The initial native run launched and showed Requests detail but timed out before
finding the marker; no drag was delivered. Its cause remains unestablished. The
next controlled prototype uses a visible 180 × 24 logical-pixel passive marker,
16 pixels from the right and 64 below the safe top inset, away from the left-edge
gesture start. Dart checks its local semantics identifier/label and emits only
sanitized setup/detail/ready/observed/failure phase and lifecycle milestones.
XCTest preserves predicate components, a debug tree truncated to 16,000
characters, and a screenshot on readiness failure before asserting. This
instrumentation distinguishes Dart readiness from native accessibility exposure;
it does not relax readiness or establish a navigation defect.

## Test dispatcher forwarding experiment

The corrected visible marker run reached Dart ready with valid local semantics,
but native XCTest still exposed only application/window/container nodes. Source
inspection found that this pinned SDK's `TestPlatformDispatcher` does not forward
`setSemanticsTreeEnabled`; its fallback `noSuchMethod` returns null. The real iOS
engine creates its accessibility bridge when that notification arrives.

This entry point therefore calls the public
`ui.PlatformDispatcher.instance.setSemanticsTreeEnabled(true)` after acquiring
its semantics handle and before its first frame. This is a source-backed
experiment, not a confirmed runtime fix. It does not modify the SDK, native host,
production entry point or user settings, and never calls the API with false.
All existing native marker, identity, foreground, actual drag and independent
Dart observation requirements remain mandatory. A successful API call or local
semantics assertion alone is not acceptance evidence.

## Real device pointer forwarding experiment

The semantics-forwarding run exposed the genuine native marker and delivered one
XCTest drag, but did not observe the Dart destination. The pinned live test
binding defaults `shouldPropagateDevicePointerEvents` to false and gates actual
device pointers on it. This test entry point saves the prior value, enables it
inside the protected test body, asserts and logs its effective value at ready,
and restores it first in unconditional cleanup. Tester setup and actual XCTest
input remain distinct. This source-supported correction is not navigation
acceptance until the single fresh native run meets every existing assertion.
