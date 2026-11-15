# N02 synthetic native journeys

Five scenarios: guard self-check, homeowner at100%/200%, provider at100%/200%. Production BundleenApp/HomeModel/ApiClient are injected; production main is not invoked. Fixtures reuse existing unit-test data, never live keys/accounts. Native text/font resolution is unchanged. Navigation taps and BackButton taps are Flutter tester inputs, not OS back/hardware or iOS edge-swipe evidence. Screenshots are synthetic rendering evidence, not performance/live-service proof.

Run serially on a fresh task-owned Android emulator then an iOS simulator, using their exact device IDs:

```sh
flutter pub get --enforce-lockfile
flutter analyze
BUNDLEEN_FIXTURE_EVIDENCE=/absolute/path/android-synthetic flutter drive --flavor development --debug --driver=test_driver/native_journeys_driver.dart --target=integration_test/native_journeys_test.dart -d DEVICE_ID
BUNDLEEN_FIXTURE_EVIDENCE=/absolute/path/ios-synthetic flutter drive --flavor development --debug --driver=test_driver/native_journeys_driver.dart --target=integration_test/native_journeys_test.dart -d DEVICE_ID
```

No dart defines/config file required. Do not target a user's running device. The host driver writes synthetic-prefixed PNGs; default output is ignored build/fixture-evidence. Runtime report is flutter drive output. Android conversion occurs once per scenario; pinned integration_test automatically schedules revertFlutterImage on test teardown. The test checks semantic Account label, textscale, recoverable errors/retry, list/detail/tab navigation and logout. Native SDK callbacks, real Bearer authorization, platform hardware back and real-device secure storage remain outside this fixture proof.

Strict transport allows only selected-role GET routes on api.example.test; every unexpected call is both thrown and recorded so production error handling cannot hide a violation. Real Dart HttpClient construction and bundleen/auth channel calls are denied and self-tested. Required Flutter/integration-test platform channels stay available. This is a guard against accidental app-service use, not an OS network sandbox or a guarantee against arbitrary future raw Socket/plugin networking. Review new service integrations before extending this harness. No fixture imports/flags exist in lib.
