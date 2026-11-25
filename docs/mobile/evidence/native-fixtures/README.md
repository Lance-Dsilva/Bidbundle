# N02 synthetic native-engine journeys

**All authentication, identities and API responses in these28 captures are synthetic.** Captures use the production BundleenApp/HomeModel/ApiClient with test-only injection on actual native Flutter engines. They are not live Clerk/API, authorization, tenant isolation or production-readiness evidence.

## Reproduction and exact source

Successful Android and iOS runs used harness commit **4ac16367ed04206ea76cebecb15a72423c807bdb** unchanged, on2026-11-01 America/New_York (2026-11-02 UTC). Flutter3.47.9/Dart3.13.7, Xcode26.4.1. Run from apps/mobile:

```sh
BUNDLEEN_FIXTURE_EVIDENCE=/absolute/path/android flutter drive --flavor development --debug --driver=test_driver/native_journeys_driver.dart --target=integration_test/native_journeys_test.dart -d emulator-5582
BUNDLEEN_FIXTURE_EVIDENCE=/absolute/path/ios flutter drive --flavor development --debug --driver=test_driver/native_journeys_driver.dart --target=integration_test/native_journeys_test.dart -d 36131BF5-98C6-4B94-813A-AFF84C07D0B3
```

The actual Flutter executable was /private/tmp/bundleen-flutter-toolchain/bin/flutter; outputs were the android/ios subdirectories here. Device IDs identify completed runs, not reusable devices: both task-created devices were stopped/deleted afterward. Android used a fresh Bundleen_N02 profile, Android16/API36 Google Play arm64 image,1080x2400,2cores, no prior userdata. iOS used fresh Bundleen-N02-Isolated iPhone17, iOS26.4.1/23E254a,1206x2622. Platforms ran serially. Existing devices/account settings were untouched.

## Results

| Verification | Result |
| --- | --- |
| Android native harness |5 scenarios passed, driver exit0; journey timer34s |
| iOS native harness |5 scenarios passed, driver exit0; Xcode44.4s, journey timer32s |
| Unit/widget suite |467 passed |
| Analyzer |No issues found |
| Formatter |61 files, zero changes |
| Captures |14 Android +14 iOS; SHA256 inventory in manifest.json |

Each native run has one guard self-check and homeowner/provider journeys at100% and200%. The framework adds tearDownAll to its displayed counter, so +6 is **five authored scenarios**, not six. Required role GET request multiset is exact, not merely containsAll. Real HttpClient creation, unexpected fixture route and bundleen/auth invocation are deliberately attempted and rejected in the self-check. Journeys then require zero unexpected calls, including after capture/unmount. Native guards passed on both integration bindings.

The initial Android run at5efbb4180c9745bb458307269ec703d4692d6a66 was failed/partial: guard and homeowner100% passed, while three journeys failed from test-helper scrolling/finder defects. Corrected helper checks an unqualified finder before selecting.last, settles after scrolling, requires hit-testability and treats missed taps as fatal. Nested cleanup restores guards/semantics/text scale despite failure. No taps were forced, scenarios skipped, errors suppressed or production lib changed. Both complete platform matrices were rerun at the corrected commit; failed captures are excluded here.

## What this establishes

Representative homeowner Requests error→Retry→detail→Back, Community, Account→Inbox→conversation→Back and logout, plus provider Opportunities expansion, Account→Service areas error→Retry→Back and logout run through actual native engines. Effective MediaQuery scale is asserted at1x/2x. Account/Retry/Sign out controls have semantic labels, button flags, tap actions and at least48logical-pixel semantic rectangles. Actions require hit-testable targets after bounded scrolling. Logout clears model data and synthetic auth state.

Inspected representative normal/large-text screenshots on both platforms show readable wrapping, plain HTML-like/URL content and persistent navigation; long content extends below the scroll viewport. iOS200% Service areas Retry initially lies partly below the viewport, and the subsequent bounded scroll/hit-testable Retry action passes. No horizontal overflow or blocking app defect was identified. These are viewport captures, not full-page screenshots or proof every lower field is visible simultaneously.

## Explicit limits

Screenshots are SDK Flutter/app-surface captures; Android converts the Flutter surface once per test and the pinned binding reverts on teardown. They omit OS chrome and do not replace full-device screenshots, performance measurements or real platform input. Taps, drags/ensureVisible and BackButton taps are Flutter tester actions. No Android hardware/predictive back, iOS edge swipe, TalkBack/VoiceOver traversal, external keyboard, OS accessibility-setting change, physical-device or authenticated lifecycle test occurred in N02. Semantics assertions are limited to the stated controls, not comprehensive accessibility certification.

Native font resolution is used without the earlier widget-capture font substitutions. The injected unit-fixture AppConfig says staging in the signed-out footer even though the test binary uses the development flavor; that is synthetic model data, not a real staging connection or AppConfig.fromEnvironment test. Normal production main and its flavor guard are not invoked by this test entrypoint; N01 covers that separately.

Test-only files/dev dependency contain fixtures; no fixture imports/flags or alternative fake-service branch exists in lib. Guards cover current app HTTP and auth-channel boundaries, not an OS-wide network sandbox or arbitrary future raw Socket/plugin networking. Required Flutter/integration-test channels remain available. No actual Clerk sign-in, callbacks/tokens/storage, backend ownership enforcement, real logout/revocation, environment credentials or account/settings mutations were exercised. Live and release gates remain open; resulting-head CI is separate from this local runtime evidence.
