# N04 Android system Back evidence

Final tested source: **b2b6aecdd3e0dce4a2a9e7854559fef874242ded**, 2026-11-01. Separate 100% and 200% invocations ran on fresh task-owned `Bundleen_N04` / `emulator-5586`, Android 16 / API 36, arm64 Google Play image, 1080 × 2400 at 420 dpi. Flutter 3.47.9 / Dart 3.13.7. No real accounts, Clerk session or live API was used.

## Results and evidence boundary

At each scale, four externally delivered Android system Back commands produced the asserted production-model transitions: Requests detail → Requests list; Inbox conversation → Inbox list; Inbox list → Account; Account top-level tab → Home. The harness then used tester setup taps to reopen Inbox and sign out, asserted private data/route clearing and zero fixture violations, and emitted `N04_ASSERTIONS_COMPLETE`. Effective text scale and Account semantics were checked in the harness. This is **eight confirmed route transitions and two pre-exit assertion checkpoints**, not two normally completed integration-test processes.

A fifth actual Back command at each scale, after `N04_TERMINAL_READY`, finished the Activity and returned to NexusLauncher. `inputs.jsonl` records exact command, UTC timestamp and exit status; `os-foreground.txt` independently records launcher focus. The reviewer stopped the waiting driver afterward. Normal Dart test completion and final teardown were not observed because terminal input ended the Activity/engine. Host cleanup was verified separately. No post-relaunch auth/session continuity is claimed.

All 12 PNGs are full Android OS screenshots from `adb exec-out screencap -p`: five synthetic app states plus the actual launcher after terminal Back, per scale. They are not Flutter screenshot-driver output, real customer data or authenticated-service evidence. The test entrypoint injects synthetic identity/API responses; the visible staging fixture caption does not mean a staging server was contacted. Setup navigation, scrolling and logout taps are Flutter tester actions. Only the ten logged KEYCODE_BACK deliveries are OS-input evidence.

## Reproduction

From `apps/mobile`, once a fresh task-owned device is booted, run each scale separately:

```sh
BUNDLEEN_FIXTURE_EVIDENCE=/private/tmp/bundleen-n04-final/1x flutter drive --flavor development --debug --driver=test_driver/native_journeys_driver.dart --target=integration_test/native_navigation_test.dart --dart-define=N04_TEXT_SCALE=1 -d emulator-5586
BUNDLEEN_FIXTURE_EVIDENCE=/private/tmp/bundleen-n04-final/2x flutter drive --flavor development --debug --driver=test_driver/native_journeys_driver.dart --target=integration_test/native_navigation_test.dart --dart-define=N04_TEXT_SCALE=2 -d emulator-5586
```

The actual executable was `/private/tmp/bundleen-flutter-toolchain/bin/flutter`. At each ready marker, the reviewer captured and inspected the current route, then invoked `/Users/lancedsilva/Library/Android/sdk/platform-tools/adb -s emulator-5586 shell input keyevent KEYCODE_BACK`. Native metadata came from `adb shell uiautomator dump /sdcard/n04.xml` and `adb pull`; no accessibility service/settings were enabled. Runtime markers omit unrelated logs and ephemeral VM-service addresses.

## Accessibility and visual review

At both scales, observed controls expose descriptive native labels, Android button class and `focusable=true`. Measured exposed rectangles have at least 48 dp width/height (420 dpi ÷ 160 = 2.625 px per dp). Back is 48 × 48 dp; the navigation tabs are about 103 × 80 dp. The JSON summary preserves all observed clickable-node bounds and labels; XML is the raw native hierarchy. This is metadata/target-size evidence, not measured focus traversal, spoken TalkBack output or physical touch accuracy.

Representative full OS captures show nonoverlapping Back, canonical mark and Sign out, persistent four-tab navigation, and readable wrapping at 200%. Body content continues below the viewport in scrollable lists. Account at 200% retains its prior scroll position after returning from Inbox. No blocking visual defect was established in these affected routes.

## Historical protocol finding

Initial source `d9e5c18915d25bd56c4727d040c4a1067b229bf3` completed the four 100% route checkpoints, but placed both scales in one invocation and expected observation after terminal Back. Actual Android Back finished the Activity. Attempting the documented activity resume started a new Flutter engine at the first scenario, so continuity could not be claimed. The reviewer stopped it. The test-only correction selects one scale per invocation and moves all assertions before terminal input. Both scales were rerun at the final source above; initial markers remain historical, not accepted full-run evidence. No production navigation fix was needed.

## Open gates and cleanup

**iOS actual edge swipe was blocked and not run.** Available CUA documentation describes native `App.drag`, but inventory returned “The Mac is locked and automatic unlock could not unlock it.” No host unlock/accessibility setting was changed and no alternate macOS input injection was used. Existing Flutter tester gesture evidence is not substituted for this open gate.

Android predictive gesture animation, hardware keys, other Account child routes beyond representative Inbox, physical devices, TalkBack/VoiceOver speech/focus traversal and real Clerk/API/storage/callback/logout isolation remain unproven. Guards cover the existing Dart HttpClient, MockClient route/method/origin and native-auth-channel seams; they are not an OS-wide network sandbox.

Full local regression after native checks: **467 tests passed**; analyzer clean; formatter **63 files, zero changes**. No unchanged N02/N03 native matrix was repeated. The task emulator was killed, its exact temporary AVD directory removed, and adb inventory confirmed empty. No iOS runtime was created; existing device/app/account data was preserved. Resulting-head CI remains separate.
