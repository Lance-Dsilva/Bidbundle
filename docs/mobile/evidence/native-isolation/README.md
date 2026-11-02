# N01 native build isolation evidence

Captured 2026-11-01 America/New_York (2026-11-02 UTC). These are real unconfigured application launches, not authenticated UI fixtures. No fake backend response or integration-test entrypoint was shipped.

## Verified artifacts and runtime

| Platform | Development | Staging |
| --- | --- | --- |
| Android debug build | passed, 11.9 s | passed, 12.8 s |
| iOS simulator debug build | passed, 36.0 s | passed, 89.4 s |
| Application identifier | com.bundleen.bundleen.development | com.bundleen.bundleen.staging |
| Packaged display name | Bundleen Dev | Bundleen Staging |
| Side-by-side install and no-config launch | passed on both platforms | passed on both platforms |

Android API36 arm64 Google Play image ran in task-only emulator5580 using a new /private/tmp AVD containing hardware configuration only. First boot produced a system-process-not-responding dialog and slow package installation. After choosing Wait, completing host workloads and cold-relaunching the app, both variants rendered the expected screen; final captures show that recovered state. This is not a startup-performance benchmark. The emulator was stopped and its temporary data removed.

iPhone17 simulator iOS26.4.1 (23E254a) was newly created as Bundleen-N01-Isolated, UUID0B2F47B9-E970-40BA-8916-811BC31D6085. Both variants installed together and launched, then the simulator was shut down and deleted. Existing device data was not used or erased. Launcher screenshots retain starter Flutter icons; final branding is outside N01. Android launcher visually truncates Staging, while its accessible/full packaged label remains Bundleen Staging. iOS no-config captures show the OS return-to-previous-app breadcrumb; the breadcrumb names the other variant, not the foreground app.

The four *-no-config.png files show the normal entrypoint rendering configuration-required text with no sign-in action. The two launcher images show coexistence. JSON files record effective packaged IDs/names and Android callback/backup/shared-session metadata. No packet capture or real authenticated SDK event was collected.

## Configuration and source boundaries

26 independent config cases pass in the full467-test suite. tool/verify_flavor_config.sh additionally runs eight compiled --flavor configurations: two accepted development/staging configurations (factory only), five missing/mismatched/production cases, and missing endpoint/key. Every rejected real main entrypoint renders the no-config screen with zero mocked native-auth calls and zero HttpClient construction. Synthetic .invalid/test-key values remain tests only and are never contacted. Full analyzer is clean; formatter58files/zero changes.

Independent first Android compile found custom resValues disabled; enabling buildFeatures.resValues fixed it. Both subsequent variants compiled successfully. CI has a four-platform/flavor-job matrix, a Linux/development compiled-config script, pinned artifact action and7-day unconfigured engineering artifact retention. Templates have environment names but empty origins and publishable keys.

Android effective callback hosts are clerk://com.bundleen.bundleen.{development,staging}.callback and .oauth. Shared-session authorities are separately suffixed and their providers disabled; allowBackup and cleartext are false. iOS packaged IDs are separately suffixed; CFBundleURLTypes is absent. Simulator binaries are linker ad hoc with no team identifier or entitlement output, not distribution-signed builds. Clerk callback construction/Keychain scoping is separate source evidence, not exercised by these unconfigured launches.

No production flavor, app registration, credential, host account setting, signing identity, backend or Clerk setting was created or changed. Flavor binding prevents accidental build/config mismatches; it is not tamper resistance or proof that configured endpoints, Clerk tenants or secure storage are isolated. Live sign-in/callback/token persistence/logout/resume/late-callback isolation, physical-device accessibility, authenticated navigation and resulting-head CI remain separate gates.
