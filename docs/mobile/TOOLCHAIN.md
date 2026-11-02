# Mobile toolchain inventory and reproducibility

Observed 2026-11-01 on local arm64 macOS host. No application builds or simulator launches were performed. Owner: Flutter Lead / Architect.

| Tool | Evidence / status |
| --- | --- |
| Flutter / Dart | `command -v flutter dart`: absent from PATH; no usable SDK established |
| Xcode | `xcodebuild -version`: 26.4.1, build 17E202; selected `/Applications/Xcode.app/Contents/Developer` |
| Swift | `xcrun swift --version`: 6.3.1; satisfies proposed Clerk bridge minimum Swift 6.2, subject to actual compile |
| CocoaPods | `pod --version`: 1.16.2 |
| iOS runtime | `xcrun simctl list runtimes`: iOS 26.4 (26.4.1 - 23E254a) |
| iOS devices | Available shutdown iPhone 17/17 Pro/17 Pro Max/17e/Air and several iPads. Inventory succeeded outside sandbox; sandbox CoreSimulator connection error does not mean missing runtime |
| Java | `/usr/libexec/java_home -V`: only Oracle arm64 JDK 23.0.2; compatible JDK for generated Android Gradle toolchain still needs selection |
| Android SDK | `$HOME/Library/Android/sdk`; platform android-35, build-tools 35.0.1 and 36.0.0, platform-tools 35.0.2; adb 1.0.41 |
| Android emulator | API36 system image and `Medium_Phone_API_36.0` AVD exist; list command encountered sandbox crashpad permissions; boot/device readiness not tested |
| Android command tools | `sdkmanager` absent from PATH; SDK root has no cmdline-tools directory. Installation prerequisite |
| Android Studio | Not present in `/Applications` inventory; command-line build may still be set up |
| CI | No `.github` workflow directory in baseline; GitHub API reports zero self-hosted runners. Hosted runner availability/budget not proven |

## Proposed exact Flutter pin

Flutter **3.47.9 stable**, Dart **3.13.7**, Flutter ref `c197ca5199e9ee5661e865596c9c07294dfab51c`. Official release metadata retrieved 2026-11-01 reports release 2026-10-29. macOS arm64 archive: `stable/macos/flutter_macos_arm64_3.47.9-stable.zip`, SHA-256 `6545b85938745dc5070e9faf2adf70233c1811009d87fe6d27bfcda5a04b7698`.

Sources: [official machine-readable release metadata](https://storage.googleapis.com/flutter_infra_release/releases/releases_macos.json), [SDK archive](https://docs.flutter.dev/install/archive), [manual setup](https://docs.flutter.dev/install/manual). The archive's rendered HTML omits dynamically loaded version rows; the metadata above, not a search snippet, establishes the pin. Save this pin in the future mobile package/CI and verify `flutter --version --machine` against it. Do not float on `stable` during reproducible builds.

## Setup commands, not yet executed

Run from an approved SDK location; these install no server services and must not copy web secrets:

```sh
mkdir -p "$HOME/develop/bundleen-sdk"
curl -fL https://storage.googleapis.com/flutter_infra_release/releases/stable/macos/flutter_macos_arm64_3.47.9-stable.zip -o /tmp/bundleen-flutter-3.47.9.zip
printf '%s  %s\n' 6545b85938745dc5070e9faf2adf70233c1811009d87fe6d27bfcda5a04b7698 /tmp/bundleen-flutter-3.47.9.zip | shasum -a 256 -c -
unzip /tmp/bundleen-flutter-3.47.9.zip -d "$HOME/develop/bundleen-sdk"
export PATH="$HOME/develop/bundleen-sdk/flutter/bin:$PATH"
flutter --version --machine
flutter doctor -v
flutter config --android-sdk "$HOME/Library/Android/sdk"
flutter devices
```

Before Android builds, install official Android command-line tools and a JDK compatible with the generated Gradle/AGP versions (proposed JDK17 pending generated-project verification), then run `flutter doctor -v`, inspect required SDK/API versions, and install exactly those packages. Do not assume existing API35 is sufficient or accept SDK licenses silently. Verify emulator boot outside restricted sandbox. Before native bridge implementation, confirm Android minimum SDK/Kotlin/AGP compatibility with the pinned Clerk SDK and record exact versions. Xcode26/Swift6.3 availability is necessary but does not prove Swift package or Flutter compatibility.

Once the manager accepts Phase1 and scaffolding is permitted:

```sh
flutter create --platforms=ios,android --org com.bundleen --project-name bundleen apps/mobile
cd apps/mobile
flutter pub get
dart format --output=none --set-exit-if-changed lib test
flutter analyze
flutter test
flutter build apk --debug
flutter build ios --simulator --debug --no-codesign
```

`com.bundleen` is a proposed identifier, not verified store ownership. Production identifiers and signing teams must be established before release. Actual staging runs require the reviewed environment configuration, auth redirect registration and safe identities; raw tokens/passwords must not appear in command history or logs. Tool installation, dependency fetches, builds, device tests, signing and store readiness remain unverified at this checkpoint.

## Executed setup checkpoint

Manager subsequently authorized temporary SDK installation. Executed `git clone --depth 1 --branch 3.47.9 https://github.com/flutter/flutter.git /private/tmp/bundleen-flutter-toolchain` successfully. `flutter --version --machine` confirms exact framework ref `c197ca5199e9ee5661e865596c9c07294dfab51c`, Dart3.13.7 and engine `89c39edfdfae2949f6806e4a315c0c08522238b7`. This is a pinned detached tag, so doctor reports channel `[user-branch]`; no floating-channel upgrade is needed. Use `/private/tmp/bundleen-flutter-toolchain/bin/flutter` and sibling `dart` or prepend that path per command. This temporary installation supersedes the initial “absent” observation above; no permanent shell configuration changed.

`flutter doctor -v` completed successfully as a diagnostic command, with two warning categories: detached-tag/PATH warnings; Android missing cmdline-tools and unknown license status. Xcode26.4.1/CocoaPods passed; network resources passed. Only desktop and Chrome were connected; no mobile device runtime was exercised. No Android license acceptance occurred. No app source, builds or runtime evidence yet.

## Scaffold checkpoint

Created `apps/mobile` using the pinned Flutter SDK, with iOS and Android platforms and provisional `com.bundleen.bundleen` identifiers. Resolved exact `http: 1.6.0` and `flutter_lints: 6.0.0`; committed-intent lockfile generated with `flutter pub get` (not yet Git committed). Flutter template selected AGP9.1.0 and Gradle9.3.1; platform integration owner now owns compatibility adjustments. iOS deployment target set17; Android min24/compile36/JVM17. JDK21 chosen for CI, superseding the earlier tentative JDK17 proposal. Local JDK21 still not installed. Native files handed to authentication engineer before compilation.

Added `.github/workflows/mobile.yml`: mobile path filter, immutable action revisions, exact Flutter revision, Linux/JDK21 Android debug compile and macOS26 iOS simulator compile, with formatter/analyzer/tests and lock enforcement. Workflow has not run. No emulator, device or application build pass is implied.

## Verified native build checkpoint — supersedes earlier unrun statuses

On 2026-11-01 native authentication integration compiled successfully using the pinned temporary Flutter3.47.9/Dart3.13.7 installation. Android used the existing **Oracle JDK23.0.2** locally (not JDK21); Gradle9.3.1, AGP9.1.0, app Kotlin declaration2.4.21, JVM target17, minSdk24/compileSdk36, official Clerk Android1.3.0 and direct kotlinx-coroutines-android1.11.0. CI still proposes JDK21 and has not executed, so its compatibility is not claimed.

`flutter build apk --debug` passed in227.4s after Gradle installed NDK28.2.13676358, Android platform36 revision2 and CMake3.22.1 using existing SDK license records. No license acceptance command was invoked. Final incremental rebuild after bridge/dependency edits passed in3.0s. Android cmdline-tools remain absent; they were not needed for this successful Gradle build.

`flutter build ios --simulator --debug --no-codesign` passed initially49.3s and after retry/forceRefresh changes11.4s with Xcode26.4.1/Swift6.3.1, iOS deployment17 and ClerkKit1.6.2. Both SwiftPM Package.resolved files should be retained. These are debug/simulator artifacts, not signed beta/release packages.

SHA-256 of verified artifacts at this checkpoint:

- `apps/mobile/build/app/outputs/flutter-apk/app-debug.apk`: `798668dbea060160ec521d692c105dba982aafe518f13be6880128ac657c9356`
- `apps/mobile/build/ios/iphonesimulator/Runner.app/Runner`: `61621c392b5a5e95acea896ec8c984eaca491bcd9fb49b9ef30e209708b166bd`

Android packaged merged manifest confirms `allowBackup=false`, credential cloud/transfer backup-rule references, `usesCleartextTraffic=false`, disabled Clerk shared-session provider and the SDK callback receiver. Live sign-in, Bearer authorization, session persistence/renewal and device security remain unverified. Runtime smoke evidence is tracked separately; a configuration-only screen cannot satisfy authentication parity.

## Android runtime smoke

Started previously shutdown `Medium_Phone_API_36.0` AVD with emulator35.5.10.0, Android36 arm64 system image; `adb devices` initially showed no connected devices. First install ran before package service was ready and failed; waited for `sys.boot_completed=1`, then `adb install -r` succeeded. `am start -W -n com.bundleen.bundleen/.MainActivity` returned `Status: ok`, COLD launch, TotalTime6372ms on first emulator boot. This startup duration is not a representative performance benchmark. App process remained running and filtered AndroidRuntime/flutter error output was empty at the check.

Inspected actual screenshot `docs/mobile/evidence/android-unconfigured.png`: Bundleen configuration-required screen rendered in cream/green with readable centered text and no clipping at default scale. This proves only installation/launch/no-config handling. No Clerk session, API call, role data, accessibility sweep or authenticated journey was exercised. Test-created emulator was shut down after capture; no pre-existing running device was touched.
