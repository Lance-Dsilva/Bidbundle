# Offline approved-mark derivatives

Canonical source: public/bundleen/brand/bundleen-company-icon.svg, explicitly selected by src/components/brand/BundleenCompanyIcon.tsx and docs/homepage-v5.md. Only that approved teal b/amber roof geometry and colors are rasterized. Other concept assets are not inputs. This records repository approval/provenance, not a new license grant or store approval.

Run `python3 /absolute/path/to/apps/mobile/tool/generate_brand_assets.py` from any working directory. Python 3 and local **rsvg-convert 2.61.3 / ImageMagick 7.1.2-13** are offline asset-maintenance prerequisites only: normal Flutter builds and app runtime use checked-in PNGs and do not need these tools. Executables resolve through PATH, with optional task-specific `BUNDLEEN_BRAND_RSVG` and `BUNDLEEN_BRAND_MAGICK` executable-path overrides. Missing tools or mismatched versions fail with an actionable message before output generation; the script never installs tools or changes global settings.

Use `--output-root /absolute/task-local/new-output` to generate all 22 PNGs and the manifest in a new or empty directory without touching source assets. Nonempty destinations and direct symlink destinations are rejected. With no output option, generation updates the known checked-in mobile derivatives. Source SVG and iOS size inventory always resolve relative to the script, not the working directory.

Manifest assets/brand/manifest.json records source SHA-256, renderer version strings, each output's dimensions, bytes and SHA-256. Compare output bytes and manifest against checked-in assets before adopting a new maintenance environment. Matching top-level versions alone do not guarantee identical raster output across different cairo/platform/build variants; the manifest retains the full tool version strings and output hashes rather than concealing such differences. No network/download, image generation, font content or runtime package is used.

Header: transparent 288-pixel source-derived mark displayed at 24 / 28 logical pixels. Normal text has decorative mark beside Bundleen; large text uses labelled mark alone to reserve room for native Back and Sign out. Platform fonts remain unchanged. Launcher: iOS opaque warm-paper background, uniformly padded unchanged mark at every existing asset-catalog size; Android legacy density icons plus padded adaptive foreground/cream background. OS controls adaptive mask. No invented new logo or pre-rounded iOS frame. Provisional IDs and Dev/Staging display names are unchanged.

N03 native check (after exact source checkpoint, fresh task-owned devices):

```
BUNDLEEN_FIXTURE_EVIDENCE=/absolute/path/synthetic-presentation flutter drive --flavor development --debug --driver=test_driver/native_journeys_driver.dart --target=integration_test/native_presentation_test.dart -d DEVICE_ID
```

Two scenarios at 100% / 200% use production widgets with synthetic provider fixtures. Retry is asserted hit-testable immediately after route entry without scrolling; header mark/back/signout bounds cannot overlap. Tester BackButton taps are not OS gesture evidence. Capture actual launcher Dev/Staging icons and labels separately on both platforms after building those flavors. No full N02 journey rerun is required merely to acknowledge this presentation change. Fixture text such as `<b>North service area</b>` is synthetic plain text, not application copy. Live authentication remains untested by these scenarios.
