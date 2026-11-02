# N03 independent native presentation evidence

Verified source: **15a88ee5075f7eb47f78b7c72f4a26c00334e2d2**, on 2026-11-01 America/New_York (2026-11-02 UTC). This bounded slice covers canonical brand derivatives, header spacing, and Service areas error recovery. It does not repeat or replace the full N02 native journey matrix.

## Evidence types

- `android/` and `ios/`: four screenshots per platform, taken by the integration-test SDK from native Flutter/app surfaces with synthetic auth and API responses. Each has an error and ready state at 100% / 200% text scale. They omit OS chrome.
- `android-os-launcher.png` and `ios-os-launcher.png`: actual OS launcher screenshots after installing normal, unconfigured development and staging builds side by side. They are not synthetic app-surface captures.
- Packaged metadata JSON records actual application identifiers, labels and icon resource references. Android accessibility metadata preserves full launcher labels even where the visible Staging label is truncated.
- `manifest.json` records SHA256 hashes and capture types for all ten images.

All ten screenshots were independently inspected. Retry is fully visible in the initial error viewport on both platforms at both scales. The test asserts hit-testability before any scroll after entering Service areas. Header bounds for the complete title, mark, Back and Sign out do not overlap; controls are hit-testable. Normal text keeps the mark and full wordmark; large text retains a labelled mark with room for Back and Sign out. Platform fonts remain unchanged. The ready state wraps long synthetic text and scrolls when content exceeds the viewport.

The shortened coverage copy retains both read-only limitations and the fact that saved areas do not confirm activation, credentials or bidding access. It makes no new authorization or service promise. Literal `<b>` text in the ready fixture is deliberately synthetic plain text, not new product copy.

## Asset verification

Canonical source: `public/bundleen/brand/bundleen-company-icon.svg`, SHA256 `5444477735a2164ccd6791a6889c941534945f3859cbc0764ede0d113c47f461`. Repository provenance is the approved shared component and `docs/homepage-v5.md`; no new license or store approval is implied.

Independently checked all 22 generated PNG hashes, byte lengths and IHDR dimensions against `apps/mobile/assets/brand/manifest.json`. A clean temporary regeneration using the committed generator exactly matched every output and the manifest, without modifying author-owned files. Pinned local tools: rsvg-convert 2.61.3 and ImageMagick 7.1.2-13 Q16-HDRI aarch64.

The generator retains the canonical SVG child geometry and colors, applies uniform rasterization/padding and uses warm-paper backgrounds for launcher assets. All 15 iOS icon files are opaque. Android adaptive foreground uses extra transparent safe-area padding with a separate warm-paper background; both launcher masks display the complete mark. No concept alternative, new artwork, font substitution, pre-rounded iOS frame or runtime asset download was added.

## Commands and devices

Flutter executable: `/private/tmp/bundleen-flutter-toolchain/bin/flutter`, version 3.47.9 / Dart 3.13.7. Xcode 26.4.1. Commands ran from `apps/mobile`:

```sh
flutter build apk --debug --flavor development
flutter build apk --debug --flavor staging
flutter build ios --simulator --debug --no-codesign --flavor development
flutter build ios --simulator --debug --no-codesign --flavor staging
BUNDLEEN_FIXTURE_EVIDENCE=/absolute/path/android flutter drive --flavor development --debug --driver=test_driver/native_journeys_driver.dart --target=integration_test/native_presentation_test.dart -d emulator-5584
BUNDLEEN_FIXTURE_EVIDENCE=/absolute/path/ios flutter drive --flavor development --debug --driver=test_driver/native_journeys_driver.dart --target=integration_test/native_presentation_test.dart -d 40C02756-CCB1-48ED-99CD-A0B07C9E0B95
```

Actual screenshot output paths were the platform subdirectories here. Builds and platform runs were serialized. Normal artifacts were preserved before the test entrypoint replaced the development test installation.

Android used a fresh task-owned `Bundleen_N03` emulator profile: Android 16 / API 36, Google Play arm64 image, 1080 × 2400, two cores, no prior userdata. iOS used a fresh `Bundleen-N03-Isolated` iPhone 17 simulator: iOS 26.4.1 / 23E254a, 1206 × 2622, UUID shown above. Both task-created devices were stopped and removed; temporary Android data was deleted. Existing devices and account settings were untouched. These completed device IDs are provenance, not reusable run targets.

## Results and limits

| Check | Result |
| --- | --- |
| Normal Android development / staging builds | Passed, 11.5 s / 7.6 s |
| Normal iOS development / staging simulator builds | Passed, 52.9 s / 42.9 s |
| Focused Android native presentation | Two authored scenarios passed, driver exit 0 |
| Focused iOS native presentation | Two authored scenarios passed, driver exit 0 |
| Full unit/widget regression | 467 passed |
| Analyzer | No issues found |
| Formatter | 62 files, zero changes |

Each native run reports counter 3 because the framework includes `tearDownAll`; there are two authored scenarios, not three. Both scales use exact service-request multisets, zero unexpected guard violations and explicit logout state clearing. No forced taps, suppressed misses or skipped scenarios were used. Source and asset review found no blocking issue; no correction was required during independent execution.

Synthetic tester taps, BackButton actions and semantic/layout bounds are not OS back gestures, TalkBack/VoiceOver traversal, physical-device accessibility or authenticated native lifecycle evidence. Launchers establish installed icon/label appearance only. Normal simulator builds are not release signing or store validation. No live Clerk/API, callback registration, storage isolation, backend ownership, account, credential or server setting was changed or verified. Resulting-head CI remains separate from this local evidence.
