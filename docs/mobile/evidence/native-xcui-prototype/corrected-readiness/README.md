# Corrected readiness prototype: native accessibility boundary

Tested source **01bacee5bf0ecb87d1a503bd04f0a83c9dd17f3d**, 2026-11-02. One newly authorized, controlled 100% Requests-only run used a fresh iPhone 17 simulator `83B1E73E-35B9-44A9-9910-4317775254C1`, iOS 26.4.1 (23E254a), Xcode 26.4.1 (17E202). The earlier failed run and its manifest remain unchanged in the parent directory.

## Exact observed boundary

Build-for-testing succeeded in **82.37 seconds**, exit 0, no signing credentials. The sole XCTest invocation launched the fixture once and failed its unchanged 60-second readiness wait at Swift line 28. Test duration **64.751 seconds**; xcodebuild duration **91.35 seconds**, exit 65. There was no retry, recovery launch, input substitution or relaxed wait.

The diagnostic attachment states:

```text
expectedPhase=ready foreground=true markerExists=false label=absent
```

Its native accessibility tree contains Application, Window and Other containers, but no Flutter semantic descendants. Native Application PID **17898** matches the Dart fixture PID. Public simulator app logs independently captured these milestones:

- `N04_DART_SETUP_SEMANTICS`: local identifier/label/nonzero-size assertions passed, resumed lifecycle.
- `N04_DART_DETAIL_SETUP`: Requests detail setup reached, resumed lifecycle.
- `N04_DART_READY`: exact local marker semantics checked after ready publication, resumed lifecycle.

All carry identity `1793596710745393|17898|isolates/6985984626500179`. The independent simulator screenshot and XCTest failure screenshot visibly show `N04 fixture: ready` over Requests detail. This distinguishes successful Dart/local-semantics readiness from failure to expose/query that marker through native XCTest accessibility. It does **not** establish the underlying bridge cause or a production navigation defect.

**Zero coordinate drag calls, zero native input delivery markers, zero correlated observed destinations.** No gesture, same-engine post-gesture or signed-out result is accepted. No receipt helper, VM attach, CUA, raw/private input or host accessibility setting was used.

## Evidence and reproduction

Exact build/test argument arrays and watchdog outcomes are in the command JSON files. They use explicit fixture target `integration_test/xcui_navigation_test.dart`, scheme `n04-ui`, Debug-development, task-only DerivedData, `CODE_SIGNING_ALLOWED=NO`, a 600-second owned build deadline and a 240-second owned test deadline. XCTest per-test bounds remained 150/180 seconds with parallel testing disabled. `.xctestrun` target paths were inspected before execution. No account/team prompt occurred.

`dart-milestones.txt` contains only the four sanitized N04 lines selected from `simctl spawn <task-UDID> log show --last 2m --style compact --predicate 'process == "Runner"'`. Unrelated logs and potential debug-service addresses are excluded. The startup milestone was initially inactive; the subsequent setup-semantics/detail/ready milestones were resumed. No post-gesture milestone exists.

Structured XCTest results/activities, native predicate components/tree and two synthetic full-screen captures are retained here. The raw result bundle remains at `/private/tmp/bundleen-n04-xcui-diagnostic/Result.xcresult`; exported automatic screen recording is in its adjacent `attachments` folder. Fixture data is synthetic; the marker is test-only and pointer-ignored. These are diagnostic captures, not production UI design or live customer evidence.

## Cleanup and local validation

The exact task simulator was shut down and deleted; booted inventory was empty. Development and staging config-only commands explicitly targeted `lib/main.dart`; both completed and generated config/export targets were verified. Final files contain only `FLUTTER_TARGET=lib/main.dart`. Package-resolution work made restoration slower; pending work was stopped and final staging verification was completed serially. No test fixture target was left as the normal generated entrypoint.

Final corrected-source local verification: **474 tests passed**, analyzer clean, formatter **67 files / zero changes**. These source/unit checks do not pass the failed native gate. No Android/N02/N03 or expanded iOS matrix was repeated. Any further marker/bridge diagnosis or runtime attempt requires the manager's next scope decision; none was performed here.
