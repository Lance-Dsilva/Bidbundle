# Offline approved-mark derivatives

Canonical source: public/bundleen/brand/bundleen-company-icon.svg, explicitly selected by src/components/brand/BundleenCompanyIcon.tsx and docs/homepage-v5.md. Only that approved teal b/amber roof geometry and colors are rasterized. Other concept assets are not inputs. This records repository approval/provenance, not a new license grant or store approval.

Run from apps/mobile: `python3 tool/generate_brand_assets.py`. Requires local rsvg-convert 2.61.3 and ImageMagick 7.1.2-13 at the documented Homebrew paths in the script; it fails on different versions. No network/download, image generation, font renderer content or runtime package. Manifest assets/brand/manifest.json records source SHA-256, renderer versions, each output's dimensions/bytes/SHA-256. Run twice and compare manifest/output hashes to verify byte reproducibility on that toolchain.

Header: transparent 288-pixel source-derived mark displayed at 24 / 28 logical pixels. Normal text has decorative mark beside Bundleen; large text uses labelled mark alone to reserve room for native Back and Sign out. Platform fonts remain unchanged. Launcher: iOS opaque warm-paper background, uniformly padded unchanged mark at every existing asset-catalog size; Android legacy density icons plus padded adaptive foreground/cream background. OS controls adaptive mask. No invented new logo or pre-rounded iOS frame. Provisional IDs and Dev/Staging display names are unchanged.

N03 native check (after exact source checkpoint, fresh task-owned devices):

```
BUNDLEEN_FIXTURE_EVIDENCE=/absolute/path/synthetic-presentation flutter drive --flavor development --debug --driver=test_driver/native_journeys_driver.dart --target=integration_test/native_presentation_test.dart -d DEVICE_ID
```

Two scenarios at 100% / 200% use production widgets with synthetic provider fixtures. Retry is asserted hit-testable immediately after route entry without scrolling; header mark/back/signout bounds cannot overlap. Tester BackButton taps are not OS gesture evidence. Capture actual launcher Dev/Staging icons and labels separately on both platforms after building those flavors. No full N02 journey rerun is required merely to acknowledge this presentation change. Fixture text such as `<b>North service area</b>` is synthetic plain text, not application copy. Live authentication remains untested by these scenarios.
