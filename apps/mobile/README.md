# Bundleen mobile

Native Flutter client for the existing Bundleen HTTPS backend. This package is under active development; compilation and fake-backed tests do not prove live authentication or product parity. See `../../docs/mobile/STATE.md`, `AUTH.md`, `API_CONTRACT.md` and `PARITY.md` for gates and verified scope.

## Toolchain

Use Flutter **3.47.9**, Dart **3.13.7**, exact Flutter revision `c197ca5199e9ee5661e865596c9c07294dfab51c`. `.flutter-version` and CI record the pin; `pubspec.lock` pins resolved Dart packages. Temporary local SDK: `/private/tmp/bundleen-flutter-toolchain` (not a permanent installation). Full inventory and reproducible setup are in `../../docs/mobile/TOOLCHAIN.md`.

Native configuration starts at iOS17 and Android24. Android uses compile SDK36/JVM target17 and JDK21 for the native Clerk dependency. Xcode26/Swift6.2 or newer is required for the iOS bridge. Development/staging application IDs and the preserved base `com.bundleen.bundleen` identifier are **provisional**, not verified store registrations. Distribution signing is not configured. Default Flutter launcher artwork is temporary and not approved release branding.

```sh
export PATH="/private/tmp/bundleen-flutter-toolchain/bin:$PATH"
flutter pub get --enforce-lockfile
dart format --output=none --set-exit-if-changed lib test
flutter analyze
flutter test
bash tool/verify_flavor_config.sh
flutter build apk --debug --flavor development
flutter build ios --simulator --debug --no-codesign --flavor development
```

Run commands from this directory. The flavor verification script exercises eight separately compiled configuration scenarios, including the actual Flutter flavor binding; CI runs it once in the Linux development job, while every matrix job retains the normal test suite and native build. Android command-line tools/platform packages and license status must be resolved before claiming an Android build. CI is scoped to mobile paths and compiles both targets; it does not deploy the backend, sign distribution packages or upload to stores. No CI run is claimed until a run actually completes.

## Environments and credentials

Only development and staging native flavors are supported. Production and the preserved base identifier remain pending owner confirmation; there is no production build option or fallback. Required app-visible fields are `BUNDLEEN_ENV`, `BUNDLEEN_API_ORIGIN` and `CLERK_PUBLISHABLE_KEY`, with the matching native flavor and SDK-derived platform return URLs. External callback registration remains a separate prerequisite; this repository does not register them. Publishable configuration does not authorize privileged requests. Never include database URLs, service keys, web cookies, passwords or session tokens in defines, source, screenshots, logs or binaries. Keep test identities in an approved secure mechanism.

A real integration requires a reviewed test backend and Clerk test instance. Do not repurpose root `.env.local` or run root `npm run build`: that command deploys database migrations. Fakes belong only in tests; they cannot satisfy the live slice gate. In-app notifications are not push notifications.

## Nonproduction engineering builds (N01)

Supported native flavors are `development` and `staging`; there is no supported production flavor. IDs remain provisional: `com.bundleen.bundleen.development` (Bundleen Dev) and `com.bundleen.bundleen.staging` (Bundleen Staging). Original base `com.bundleen.bundleen` configurations remain pending owner confirmation; launching without a supported flavor fails closed. These are engineering builds, not registered store identities or signed distribution releases.

The real entry point requires Flutter `appFlavor` to equal `BUNDLEEN_ENV`, a valid HTTPS API origin and a test publishable key. Missing configuration, a mismatch or production flavor stops before auth/network setup. Constructor injection remains available to tests. No origin/key is supplied by this repository: empty `config/development.example.json` and `config/staging.example.json` templates intentionally cannot connect. Copy an example to a private file outside the checkout and fill only the approved public origin and publishable key. Never put server secrets or session credentials in defines.

With the pinned Flutter on PATH, unconfigured build commands are:

```sh
flutter build apk --debug --flavor development
flutter build apk --debug --flavor staging
flutter build ios --simulator --debug --no-codesign --flavor development
flutter build ios --simulator --debug --no-codesign --flavor staging
```

After approved environment configuration is available, use an external public-config file:

```sh
flutter run --flavor development --dart-define-from-file=/absolute/private/path/development.json
flutter run --flavor staging --dart-define-from-file=/absolute/private/path/staging.json
```

Native hosted-auth callbacks are SDK-derived, without new app callback handlers. Expected iOS returns: `com.bundleen.bundleen.development://callback` and `com.bundleen.bundleen.staging://callback`; the SDK uses its system authentication session. Android's merged SDK receiver uses `clerk://com.bundleen.bundleen.development.callback` or `clerk://com.bundleen.bundleen.staging.callback` (and its application-ID-derived OAuth receiver). These must be checked against effective binaries and approved external Clerk platform registrations before live auth. This change registers nothing, enables no Native API setting and proves no live sign-in.

CI compiles each flavor on Android and iOS and retains unconfigured debug APK/unsigned simulator ZIP artifacts for seven days. Missing config is deliberate: artifacts open the configuration-required screen. APKs use normal debug signing; unsigned simulator apps are not installable iPhone/TestFlight distributions. Neither artifact includes environment credentials. No automatic production build, store upload or distribution signing is configured. Launcher artwork remains temporary and no bundled custom fonts/assets are introduced.
