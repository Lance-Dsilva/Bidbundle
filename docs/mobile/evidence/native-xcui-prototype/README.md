# N04 minimum XCTest prototype: readiness failure

Compiled source **1f84897c31f663af27445423533d0d2c6458bd17**; corrected command documentation **6a55f892f8b504dda86abf0bfea167ec8514580b**. Tested 2026-11-02 with Xcode 26.4.1 (17E202), Flutter 3.47.9, fresh iPhone 17 simulator `9F8DAAB4-E4CA-426E-9EC1-6931AEA7B882`, iOS 26.4.1 (23E254a). Scope was only homeowner 100% Requests detail → list by public XCTest coordinate drag.

## Observed result

`build-for-testing` succeeded in 80.96 seconds with `CODE_SIGNING_ALLOWED=NO`, without account/team credentials. Generated `.xctestrun` inspection confirmed the separate UI-test runner and intended development fixture app; a compact copy of those paths is retained. XCTest subsequently installed/launched the app once, established its automation session and foreground state, and the captured simulator screen showed Requests detail after Flutter tester setup.

The single actual test **failed at the readiness predicate**, Swift line 14, after 64.9748 seconds (xcodebuild 93.29 seconds, exit 65). It did not reach the coordinate drag call. **Zero native gestures, zero delivery markers and zero correlated observed destinations.** Repeated `N04Marker` existence checks are recorded, but no returned Boolean, accessibility tree or marker label is available; absence versus present-but-not-ready is unresolved. The screenshot proves visible fixture setup, not the Dart ready milestone. This is a prototype handshake failure, not demonstrated production back-navigation failure.

The raw result bundle is preserved locally at `/private/tmp/bundleen-n04-xcui/ResultActual.xcresult` (about 48 MB). Exported automatic screen recording is in the adjacent `attachments` directory (about 4.8 MB). Compact structured test/activity JSON and the independently captured full simulator OS screenshot are committed here. No intended before/after marker screenshots were reached. No real customer data, auth or API was involved.

## Commands and early validation errors

All commands ran from `apps/mobile`; exact argument arrays/deadlines/results are in the command JSON files. Flutter config was generated explicitly for `integration_test/xcui_navigation_test.dart`. Build used isolated `/private/tmp/bundleen-n04-xcui/DerivedData` and an owned 600-second deadline. Test used `test-without-building`, the same simulator/artifacts, `-parallel-testing-enabled NO`, test timeouts 150/180 seconds and an owned 240-second deadline. No lifecycle recovery or XCTest retry was used.

Two command-validation rejections occurred before any app launch: `-test-iterations 1` was invalid on this Xcode (exit 64, 0.72 seconds); the rejected command left the requested result path, causing the corrected invocation to reject that existing path (exit 64, 0.33 seconds). The author removed the invalid flag, and the reviewer used a fresh `ResultActual.xcresult` path. Those are distinct from the one actual failed test. No code was rebuilt or changed between successful compilation and actual execution.

## Cleanup and remaining gates

The exact task simulator was shut down/deleted; booted inventory was empty. Explicit `flutter build ios --config-only --simulator --debug --flavor development --target lib/main.dart` and the corresponding staging command both succeeded. After each, `Generated.xcconfig` and `flutter_export_environment.sh` reported only `FLUTTER_TARGET=lib/main.dart`. This corrects the stale prior fixture configuration; it is config restoration, not a new normal-app native build claim.

Local source regression afterward: **474 tests passed**, analyzer clean, formatter **67 files / zero changes**. Source review fixed missing model disposal and made missed tester setup taps fatal before the compiled checkpoint. Security review accepted the bounded passive-marker/test-only design; no source or local-unit check substitutes for failed native evidence.

No CUA, private input, host accessibility/signing/account setting, live service, Android rerun or other native matrix was used. iOS actual gesture, 200%/Inbox routes, same-engine post-logout clearing, physical devices and screen-reader behavior remain open. Marker placement/query/lifecycle diagnosis is read-only pending manager review; no further runtime attempt was made.
