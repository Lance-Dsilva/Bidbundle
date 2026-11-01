# Foundation screenshot evidence

Captured 2026-11-01 by independent Flutter widget screenshot tests in `apps/mobile/test/evidence/screenshots_test.dart`.

These are **fake-backed widget fixtures**, not native device screenshots and not live authentication/backend proof. Only synthetic Test Resident data is used. The test harness substitutes SDK Roboto for all font families, so serif font fidelity is not certified. See REVIEW.md and TEST_STRATEGY.md for remaining gates.

- signed-out.png: sign-in/create-account preview.
- dashboard-fixture.png: synthetic server-contract profile/context/homeowner dashboard.
- error.png: recoverable transport failure, no stale private data.
- large-text.png: 200% text scaling fixture.

Regenerate with `flutter test test/evidence/screenshots_test.dart` from apps/mobile; outputs are written under ignored build/evidence/widget-fixtures. These copies preserve the reviewed milestone evidence.

Native launch-only captures added:

- ios-no-config-runtime.png: iPhone17/iOS26.4 simulator, actual installed app.
- android-unconfigured.png: Android API36 emulator, actual installed debug APK.

Both native captures show the fail-closed missing-configuration screen. Neither exercised sign-in, protected API data, authenticated navigation or account isolation. Exact commands/devices are in TEST_RESULTS.md and TOOLCHAIN.md.
