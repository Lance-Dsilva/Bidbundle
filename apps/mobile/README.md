# Bundleen mobile

Native Flutter client for the existing Bundleen HTTPS backend. This package is under active development; compilation and fake-backed tests do not prove live authentication or product parity. See `../../docs/mobile/STATE.md`, `AUTH.md`, `API_CONTRACT.md` and `PARITY.md` for gates and verified scope.

## Toolchain

Use Flutter **3.47.9**, Dart **3.13.7**, exact Flutter revision `c197ca5199e9ee5661e865596c9c07294dfab51c`. `.flutter-version` and CI record the pin; `pubspec.lock` pins resolved Dart packages. Temporary local SDK: `/private/tmp/bundleen-flutter-toolchain` (not a permanent installation). Full inventory and reproducible setup are in `../../docs/mobile/TOOLCHAIN.md`.

Native configuration starts at iOS17 and Android24. Android compile SDK36/JVM target17 and JDK21 are planned for the native Clerk dependency. Xcode26/Swift6.2 or newer is required for the proposed iOS bridge. Application IDs `com.bundleen.bundleen` are **provisional**, not verified store registrations. Distribution signing is not configured. Default Flutter launcher artwork is temporary and not approved release branding.

```sh
export PATH="/private/tmp/bundleen-flutter-toolchain/bin:$PATH"
flutter pub get --enforce-lockfile
dart format --output=none --set-exit-if-changed lib test
flutter analyze
flutter test
flutter build apk --debug
flutter build ios --simulator --debug --no-codesign
```

Run commands from this directory. Android command-line tools/platform packages and license status must be resolved before claiming an Android build. CI is scoped to mobile paths and compiles both targets; it does not deploy the backend, sign distribution packages or upload to stores. No CI run is claimed until a run actually completes.

## Environments and credentials

Use distinct development, staging and production configuration; no implicit production fallback. Planned app-visible fields are `BUNDLEEN_ENV`, `BUNDLEEN_API_ORIGIN` and `CLERK_PUBLISHABLE_KEY`, plus registered platform return URLs. Consult the actual Dart configuration implementation before launching. Publishable configuration does not authorize privileged requests. Never include database URLs, service keys, web cookies, passwords or session tokens in defines, source, screenshots, logs or binaries. Keep test identities in an approved secure mechanism.

A real integration requires a reviewed test backend and Clerk test instance. Do not repurpose root `.env.local` or run root `npm run build`: that command deploys database migrations. Fakes belong only in tests; they cannot satisfy the live slice gate. In-app notifications are not push notifications.
