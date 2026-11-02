# Authentication decision and security gate

Evidence date: 2026-11-01. Baseline: `fb4a245721ffdd69dd0255c0ef021e6b6fbb08ed`. Owner: Mobile Authentication / Security Engineer.

Status: **native bridge foundation implemented and compiled; live feasibility gate OPEN**. Both native targets compile with pinned official Clerk SDKs. Source persistence/callback audit is recorded below; runtime secure-storage behavior and staging authentication have not been proved. See the final evidence sections and TEST_RESULTS.md.

## Proposed adapter

Use a thin Flutter platform adapter around official Clerk iOS/Android SDKs, initially invoking supported hosted authentication. Flutter renders Bundleen journeys; Clerk opens a system-browser auth session and activates the native session. Delegate passwords, MFA, token renewal and callback validation to Clerk. This is not a WebView product wrapper or a custom OAuth exchange.

The tradeoff is two native bridges and lifecycle tests versus a single community Dart dependency. Native bridges add Swift/Kotlin maintenance and a potentially restrictive iOS floor, but keep security-critical session exchange under officially supported SDKs. Choose this only after exact-release compilation and storage review. A maintained Flutter integration remains a viable fallback if its source audit and real-device tests pass; do not silently substitute it.

| Candidate | Verified evidence | Assessment |
| --- | --- | --- |
| clerk_flutter | pub.dev lists 0.0.18-beta, MIT, Flutter >=3.27.4, Dart >=3.6.2, Android/iOS/macOS. Repository explicitly says community-maintained/as-is, breaking changes expected. | Not official despite clerk.com publisher. Smaller bridge cost; beta churn and unverified persistence/flow completeness need audit. |
| Official native bridges | Clerk iOS/Android document hosted sign-in/sign-up, session activation, token retrieval and sign-out. | Preferred conditionally; must verify chosen releases, callback/lifecycle behavior and storage. |
| Generic AppAuth/OIDC | No reviewed evidence that a generic OAuth token is interchangeable with Bundleen Clerk sessions. | Do not invent a session exchange. |
| WebView/cookie copying/static token | Violates product/security requirements. | Rejected. |

Sources: [package](https://pub.dev/packages/clerk_flutter), [license](https://pub.dev/packages/clerk_flutter/license), [changelog](https://pub.dev/packages/clerk_flutter/changelog), [maintainer repository](https://github.com/clerk-community/clerk-sdk-flutter), [Clerk SDK directory](https://clerk.com/docs). Publication/activity alone establishes no maintenance SLA or security guarantee.

[Official iOS repository](https://github.com/clerk/clerk-ios) declares MIT and currently lists iOS 17+, Xcode 26+, Swift 6.2+. These are current README requirements, not a verified minimum for a pinned release or an approved Bundleen support policy. Confirm the release before accepting the compatibility cost. [Android releases](https://github.com/clerk/clerk-android/releases) and [versioning guide](https://clerk.com/docs/guides/development/upgrading/versioning) must be checked when pinning; search caches disagree about latest release, so no exact native dependency version is approved yet.

[iOS hosted auth](https://clerk.com/docs/ios/guides/account-portal/hosted-auth) documents Native API enablement and registered identifiers. The default callback is `<bundle-identifier>://callback`. [Android hosted auth](https://clerk.com/docs/android/guides/account-portal/hosted-auth) uses `clerk://<package-name>.callback`. SDKs activate a session after browser completion. Hosted social login uses the provider's web OAuth flow; Apple production configuration requires a Services ID/key in provider configuration, never the app. Cancellation must remain distinct from failure.

## Server evidence and gaps

`src/lib/server/auth.ts` calls Clerk `auth()` then resolves live Bundleen identity/profile. `authorizeRequest()` returns 401 absent identity, 409 missing profile, 403 wrong role/inactive admin grant and sanitized 500 for profile lookup failure. Roles and grants remain database-authoritative. HOA manager checks remain server-side; client-selected roles/community IDs cannot grant access.

`src/middleware.ts` applies Clerk broadly and invokes `auth.protect()` for `/api/me`, `/api/auth/profile`, `/api/auth/me`, `/api/admin` and selected pages. `/api/me/context` can therefore be intercepted before the handler. Its actual unauthenticated response and native Bearer behavior must be measured through middleware. `tests/authorization.test.ts` mocks Clerk `auth()` and does not verify token cryptography, expiry, SDK refresh or middleware.

Clerk's [authenticated requests guide](https://clerk.com/docs/guides/development/making-requests) supports session tokens in the Authorization Bearer header. This does not establish that this deployment accepts native sessions end to end. First test current server behavior with safe real sessions. Only demonstrated incompatibility justifies a backward-compatible change; preserve web cookies/page redirects, all resource guards and issuer validation. Never disable authorization or write a second JWT verifier.

## Adapter and transport contract

Proposed interface: initialize(public config), observe auth state, startSignIn/startSignUp, getFreshSessionToken, signOut. Native SDK owns renewal/revocation. Serialize sign-in attempts; handle cancellation, cold/warm callbacks, activity recreation and app resume. Ignore stale responses after sign-out/account switch.

**Secure persistence remains unverified.** Audit chosen SDK source and device storage: iOS Keychain accessibility, Android Keystore-backed encryption, backup exclusion and logout cleanup. Do not assume SDK persistence is encrypted. If defaults fail the requirement, evaluate a supported storage provider before approval. Do not persist bearer tokens in Dart preferences/files or telemetry. Keep request tokens in memory and purge user data/navigation on logout.

Use explicit environment-bound HTTPS origins. Never forward Authorization across redirects/hosts. Get a fresh token for requests; allow at most one refresh/retry for a safe read after 401, then reauthenticate. Never automatically replay mutations. Distinguish 403, profile 409, 429, network and 5xx errors. Cached roles are display state, never authority. Redact tokens, callback query strings and sensitive payloads in logs.

Clerk's [session model](https://clerk.com/docs/guides/how-clerk-works/overview) uses short-lived session tokens. Revocation must prevent renewal; an issued JWT may remain usable until expiry. Record that window rather than claiming immediate invalidation. Database role/community removal must affect the next resource authorization.

## Required staging inputs — names only

- `BUNDLEEN_API_ORIGIN`: safe staging backend with isolated test database; matching `CLERK_PUBLISHABLE_KEY`. Production `.env.local` is not a substitute.
- Owner-confirmed Native API enablement, registered `IOS_BUNDLE_ID` and `ANDROID_APPLICATION_ID`, callbacks and actual enabled authentication methods. Native API enablement changes account security configuration and is not implicitly authorized here.
- Safe identities: homeowner with profile, no-profile identity, verified/unverified provider, authorized manager for community A, resident, unrelated user/community B. Test-only revocation/demotion authority. Deliver credentials through secure local/CI configuration, never chat or commits.
- Toolchains/runners matching pinned SDKs; simulators/emulators and real devices for storage/callback testing. Provider/social configuration and signing prerequisites when needed.
- All Clerk secret keys/database credentials stay server-side in test secret storage. Mobile contains only origin, publishable key and app identifiers.

## Executable spike and acceptance

Non-live work available now: resolve exact SDK release source, compile a tiny bridge on installed toolchains, inspect persistence/callback code, and test adapter cancellation/error/state serialization with fakes. These checks can eliminate unsuitable dependencies but cannot pass the live gate. Auth source/contract inspection completed; none of those compilation/runtime checks has run yet.

First slice: hosted sign-in -> native session -> GET `/api/me/context` -> GET `/api/homeowner/dashboard` -> logout. Add profile read per the final API contract. Missing-profile 409 must lead to onboarding, never invented access.

Independently record app/server revisions, exact SDKs, OS/device, environment alias, sanitized statuses and screenshots on both platforms:

1. Sign-in/sign-up and each enabled verification/MFA/social method; cancelled/failed browser; wrong code; slow/offline network; cold/warm callback and wrong/replayed callback.
2. Actual native Bearer reads through middleware; absent, malformed, expired, revoked and wrong-instance tokens fail closed. Recheck existing web cookie behavior.
3. Refresh after expiry and background/resume. Logout clears views/cache, stops renewal and eventually invalidates already-issued tokens. Test remote revocation separately.
4. Wrong role denied; user/community isolation; ordinary resident cannot gain manager access via client role/community edits. Grant removal affects next request.
5. Distinct 401/403/409/429/5xx handling; bounded retry; no mutation replay or token redirect leakage.
6. Inspect secure persistence, backups/logs, process termination, duplicate sign-in and logout/account-switch while requests are in flight.

Exact next auth task: resolve and audit native release candidates, compare supported toolchains with iOS floor, then compile bridge and run safe staging hosted auth/Bearer checks. Fake tests do not establish live feasibility. Manager acceptance remains conditional on these results.

## Public UI observation supplied by manager

On 2026-11-01 the manager inspected the public sign-in page without submitting credentials: Clerk displayed “Sign in to bundleen-auth”, an email field, Continue and Sign up; no social buttons were observed. This is evidence for prioritizing the email journey, not proof of the configured verification strategy or absence of other methods. Inventory enabled methods in the test Clerk instance before implementing parity. Do not carry older sign-in-page marketing claims into the native UI.

## Pinned-source feasibility audit (2026-11-01)

Direct GitHub release API requests supersede cached search results above. Candidate pins are **clerk-ios 1.6.2** (published 2026-10-27) and **clerk-android v1.3.0** (2026-10-22). Official source archives were downloaded and extracted under `/tmp/bundleen-clerk-ios` and `/tmp/bundleen-clerk-android`; no executable package/install scripts were run. Candidate means source-audited, not compiled or production-approved.

Archive SHA-256 (audit provenance, not a distribution guarantee):

- iOS: `630537ab1ab3298b565aa0e51cdd4c640d46710e141dc696a38192c22f7b149e`
- Android: `9690d790092eec70dfae73f5790337d48894f636ab0074526b9a9982bc9efbee`

### Persistence and callback findings

- [iOS SystemKeychain at 1.6.2](https://github.com/clerk/clerk-ios/blob/1.6.2/Sources/ClerkKit/Storage/Keychain/SystemKeychain.swift) stores generic-password items with `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`. `ClerkIdentityStore` stores device token and cached client through the keychain abstraction. Use the default app-specific service and no cross-app keychain access group. This protection permits access after first unlock; it is not a biometric gate. Runtime cleanup and reinstall behavior remain test obligations.
- [Android StorageCipher at v1.3.0](https://github.com/clerk/clerk-android/blob/v1.3.0/source/api/src/main/kotlin/com/clerk/api/storage/StorageCipher.kt) uses AES/GCM/NoPadding with an AndroidKeyStore key and randomized encryption. The deterministic test cipher is restricted to Robolectric fallback. [StorageHelper](https://github.com/clerk/clerk-android/blob/v1.3.0/source/api/src/main/kotlin/com/clerk/api/storage/StorageHelper.kt) encrypts values before private SharedPreferences writes and ignores writes if encryption is unavailable. It reads legacy plaintext then attempts migration; fresh Bundleen installs must not seed/import such preferences. Test keystore failure and avoid relying on apparent session persistence after a failed write.
- Android SDK manifest defines no backup/data-extraction exclusion. **Application requirement:** exclude `clerk_preferences.xml` from cloud backup and device transfer using platform-appropriate backup rules, and verify the merged manifest/artifact. Encryption alone is not a reason to copy credentials into backups. Shared-session provider is disabled by default; do not enable it.
- [iOS hosted flow](https://github.com/clerk/clerk-ios/blob/1.6.2/Sources/ClerkKit/Core/Auth%2BHostedAuth.swift) generates state/PKCE, validates callback against initiated redirect/state, redeems a rotating token nonce with verifier, and verifies the returned session before activation. The iOS flow only supports custom-scheme redirects and uses the system authentication session.
- [Android callback validator](https://github.com/clerk/clerk-android/blob/v1.3.0/source/api/src/main/kotlin/com/clerk/api/hostedauth/HostedAuthCallback.kt) checks scheme/authority/path, exact state, and nonempty single nonce/session parameters. [HostedAuthService](https://github.com/clerk/clerk-android/blob/v1.3.0/source/api/src/main/kotlin/com/clerk/api/hostedauth/HostedAuthService.kt) generates state/PKCE using SecureRandom, accepts an HTTPS auth destination, redeems nonce/verifier and fences stale responses. The SDK receiver handles the default callback. App code must not bypass these checks by treating an incoming URI as a signed-in state.

### Exact compatibility evidence and decision

[iOS 1.6.2 Package.swift](https://github.com/clerk/clerk-ios/blob/1.6.2/Package.swift) sets Swift tools 6.2 and iOS 17. [Android v1.3.0 version catalog](https://github.com/clerk/clerk-android/blob/v1.3.0/gradle/libs.versions.toml) sets minSdk24, compile/target36, Kotlin2.4.21, JDK21 for its own build and JVM target17. Its own AGP is9.4.1; consuming published artifacts need compatibility verified, not blind adoption of all producer build settings. Resolve Maven/SPM artifacts and lock transitives during compilation.

**Source-level verdict:** these release candidates contain supported hosted auth and OS-protected persistence suitable for the planned bridge, with required app backup exclusions. No source-level persistence blocker for fresh installs was identified. This is a bounded review of relevant files, not a complete SDK security audit. Binary dependency compatibility, secure storage on devices, logout cleanup, callbacks after process death and live Bundleen Bearer authorization remain unrun gates. The manager can proceed with a bridge spike against these candidate pins when toolchains are available; cannot declare Phase 1 live feasibility or Phase 2 complete from this evidence.

## Native bridge implementation checkpoint

The source-only status above is superseded for compilation by this checkpoint; live authentication remains unproven. `apps/mobile` now bridges `bundleen/auth` to official ClerkKit1.6.2 and clerk-android-api1.3.0. Methods: initialize(public publishableKey) returns session-present bool; signIn/signUp await hosted activation; getToken accepts `forceRefresh` (default false) and forwards SDK skipCache; signOut awaits SDK completion. SDK exceptions are sanitized before crossing into Dart; auth operations serialize. Android coroutine work cancels with Activity destruction. iOS uses the SDK system authentication session. No app password/JWT verification or persistent token store was added.

Retry after bootstrap failure uses Android `Clerk.reinitialize()` and iOS `refreshEnvironment()`/`refreshClient()`; it does not clear identity via reconfiguration. SDK telemetry is disabled on both platforms. Android app backup and transfer rules exclude Clerk credentials and cleartext traffic is disabled. iOS public-key format validation prevents Clerk's debug assertion on malformed configuration; it only validates encoded configuration, never identity.

Validation run: `flutter build ios --simulator --debug --no-codesign` with Flutter3.47.9, Xcode26.4.1. Initial compile passed (49.3s); rerun after force-refresh/retry fixes passed (11.4s). Artifact: `apps/mobile/build/ios/iphonesimulator/Runner.app`. SPM resolution files are generated under both workspace/project shared SwiftPM directories and must be retained for reproducibility. No device/runtime/live auth claim follows from compilation. Android debug build was still provisioning SDK36/NDK28.2 at this checkpoint using licenses already accepted in the machine's SDK; no license acceptance command was run.

Android final compile succeeded (227.4s first build, 3.0s final incremental). Actual no-config emulator launch and screenshot passed; see TOOLCHAIN.md for checksums/device evidence. No Clerk methods were invoked by that configuration-blocked screen, so all live auth/session/authorization gates remain open.

## R01 Requests independent security source review — 2026-11-01

Scope: `features/requests/models.dart`, `requests_model.dart`, `requests_screen.dart`, HomeModel/HomeScreen integration, shared ApiClient/AuthSession and exact R01 API contract. Reviewer owns this review only; application author and independent test/code reviewer own fixes/tests. This is source review plus a small local URI behavior probe, not live SDK/backend authorization verification.

Confirmed from source:

- Requests owner comes from a successfully matched server profile/context and is set only for homeowner role. Home refresh clears requests before reloading role/context; sign-out, auth restart, expiry and disposal invalidate generations. Both successful and failed late list/detail responses check owner and generation; old responses cannot restore navigation/data after account changes through these paths.
- Detail fetch uses its separate protected endpoint and DTO. It clears previous detail before fetch and keeps detail null on403/404/failure; no fallback to list fields. List context=hoa cannot open the neighborhood-only detail. Server remains responsible for current membership/ownership checks.
- Request IDs are encoded as a single URI component; blank/dot traversal IDs are rejected and the returned detail ID must exactly match. A temporary Dart probe tested `r1`, `../profile`, `/api/profile`, `?x=1#f`, `%2e%2e`, `//other.invalid`, and `a/b`: all stayed one path segment on the original host with no injected query/fragment. Shared transport disables redirects.
- Server eligibility only supplies explanatory text. No create/manage/respond/bid/award authority is inferred from owner, role, eligibility, list context or client clock. Unused nested participant/bid/visit data is not retained by the read-only DTO, and UI renders plain text.

Actionable finding R01-S1 (P2, reported to manager/author/test reviewer): after a protected read returns401, ApiClient's forced SDK token renewal can throw PlatformException (for example revoked-session token failure). That error previously escaped as a generic failure instead of confirmed unauthenticated state. On a detail refresh, RequestsModel consequently kept Home account/list state even though the server had explicitly returned401. Preserve that401 across failed forced renewal and invoke the existing global expiry clearing path; keep initial token/network failures distinct so an ordinary offline error does not become an invented revocation. Independent regression must cover detail401 -> forced-refresh exception -> Home/data/list/detail/navigation cleared. Finding disposition is pending author fix and reviewer verification at this checkpoint.

No additional actionable source finding identified in the requested stale-callback, denied-detail fallback, path-injection or client-authority areas. Conditional source approval only; live sign-in, token expiry/renewal and actual cross-user/community denial still require staging identities on both platforms. Native iOS back behavior is owned by the separate UX review.

### R01-S1 resolution

Resolved in source and focused independent tests on 2026-11-01. ApiClient now wraps token acquisition per attempt: a failed forced renewal after the first server401 becomes `ApiFailure.unauthenticated`, activating existing global Home/request clearing; an initial token exception is rethrown without falsely declaring session loss. The retry remains bounded to one safe GET and no raw SDK error reaches the UI.

Security reviewer independently ran both authored-by-test-reviewer regressions with `flutter test test/requests_test.dart --plain-name <name>`; each passed1/1:

- `401 then native refresh error clears all protected home and request state`
- `initial token network error does not falsely expire existing account`

The second test also checks that detail data is cleared during the failure, private error detail is not displayed, and retry can recover. R01 has no remaining actionable finding from this bounded security source review. This closes only R01-S1's source/unit evidence; it does not establish live SDK expiry, middleware Bearer acceptance, cross-account/community isolation or platform runtime auth.
