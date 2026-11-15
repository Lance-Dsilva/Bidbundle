# Environment readiness

No configured test backend or Clerk development instance was supplied during this milestone. No production credentials were copied. Application defaults make no network requests when configuration is absent/invalid.

| Environment | API origin | Clerk instance | Identity/data | Readiness |
| --- | --- | --- | --- | --- |
| development | owner-supplied HTTPS dev backend | matching development instance | disposable test data | missing |
| staging | owner-supplied HTTPS staging backend | matching development instance | safe role/negative-test identities | missing |
| production | existing Bundleen backend, confirm release origin | production instance | no test submissions | not authorized for deployment/distribution |

N01 implements supported `development` and `staging` native flavors; all identifiers remain provisional pending owner confirmation. The base `com.bundleen.bundleen` is preserved as a provisional legacy configuration, with no supported production flavor. The real entry point requires Flutter appFlavor to match BUNDLEEN_ENV and accepts only nonproduction test keys plus a valid HTTPS origin. Empty public templates intentionally cannot connect. Use explicit --flavor build/run commands from apps/mobile/README.md.

| Flavor | Provisional bundle/application ID | iOS SDK return | Android SDK return |
| --- | --- | --- | --- |
| development | com.bundleen.bundleen.development | com.bundleen.bundleen.development://callback | clerk://com.bundleen.bundleen.development.callback |
| staging | com.bundleen.bundleen.staging | com.bundleen.bundleen.staging://callback | clerk://com.bundleen.bundleen.staging.callback |

These are expected SDK-derived return identifiers, not registered/approved external callbacks. No Native API/account settings changed. Separate install IDs and configuration validation reduce build mistakes; they do not prove distinct backend/Clerk/database resources or measured token/keychain isolation. Do not switch environments over a persisted session as a substitute for approved isolation. Parent must still confirm origin/issuer pairing and all external resources.

Owner inputs needed through secure local/CI configuration:

1. Confirm non-production API URL and Clerk development instance; isolated database/limiter/storage services.
2. Confirm Native API and callback registration for reviewed provisional or final application IDs. Account/security configuration changes require owner action/authorization.
3. Provide safe identities for homeowner, incomplete profile, verified/unverified provider, manager community A, ordinary resident and unrelated community B, plus test-only revocation/demotion capability. Never send passwords/tokens in chat.
4. Identify supported minimum iOS policy (current official SDK requires iOS17), distribution team/store ownership and eventual signing setup.

App-visible defines: BUNDLEEN_ENV, BUNDLEEN_API_ORIGIN, CLERK_PUBLISHABLE_KEY. Use --dart-define-from-file with a secure local file containing only these public configuration values; identity secrets never belong there. Test execution must not log callback URLs or bearer tokens. See AUTH.md for exact callback and validation requirements.

Next live task: configure staging, build each native target, sign in via official hosted SDK, read profile/context/homeowner dashboard, sign out, test expired/revoked/foreign-instance and role/community denial cases. No phase gate closes on the basis of source inspection or fixtures.

## Staging readiness checklist — not yet approved

Parent Engineering's non-secret metadata investigation (2026-11-01) found no custom staging environment in `bidbundle`. Branch Preview `https://bidbundle-fqf9l0npx-lancedsilva2000-8369s-projects.vercel.app`, deployment `dpl_5Ws4H23xe2h2shusR9G2nRjiRSWy`, was READY. Clerk variable entries are separately scoped to preview/production, but instance pairing and Native API settings are unverified. Database, Redis/limiter, Blob, email and QStash entries include both preview and production targets. Integration overrides may change resolved resources. **This Preview is not approved safe staging.** No credential values were retrieved; metadata is not isolation proof. Parent Engineering owns verification and any escalation.

### Minimum for the first authenticated read

- [ ] Parent identifies a stable HTTPS API origin and deployed backend revision; confirm native requests can reach JSON handlers through middleware/deployment protection without copying browser cookies or bypass credentials into the app.
- [ ] Backend owner verifies the resolved Postgres resource is an isolated, sanitized test database at the required schema revision. Record resource aliases and confirmation, not connection strings. No production clone containing real personal data. Schema/fixture preparation requires an explicitly assigned backend owner; mobile does not run root migrations or seed scripts.
- [ ] Matching Clerk development application/instance confirmed for the app publishable configuration and server secret configuration. Record the instance alias and matching issuer/domain, no secret values. Native API, allowed app IDs, callback targets and enabled sign-in/sign-up/verification/MFA methods confirmed by the account owner.
- [ ] Minimum fixture: one synthetic Clerk identity mapped by clerkUserId to a Bundleen homeowner profile. Empty database requests should produce the real cold-start dashboard. For nonempty read coverage, backend owner adds synthetic request/bid/agreement rows with known expected counts/cents; no app-side fabricated results or production submissions.
- [ ] Parent confirms how to sign in with test verification/MFA for the configured Clerk methods. Clerk auth delivery may be necessary even while Bundleen's own email worker stays disabled.
- [ ] Parent confirms safe credential delivery to the human/device test runner using approved local/CI storage. Passwords, OTPs, session tokens and server secrets never appear in app defines, CLI arguments, screenshots or logs.

The profile/context/dashboard GET slice has no direct limiter requirement. Before exercising profile completion or any protected mutation, require an isolated Redis namespace/resource and functioning limiter credentials plus RATE_LIMIT_IDENTIFIER_SECRET; never disable production fail-closed guards. No readiness check may silently expand the test scope to writes.

### Identity and data fixture matrix for negative gates

| Fixture | Expected evidence |
| --- | --- |
| Homeowner with profile | Matching profile.id/context.userId and role; real dashboard200 |
| Clerk identity without Bundleen profile | Profile-incomplete409 from handler, or documented middleware result; never invented access |
| Verified and unverified providers | Homeowner dashboard denied403; verification eligibility tested on later provider contracts |
| Authorized manager community A | Live assignments and scoped read success; role string alone gives no authority |
| Ordinary resident/request owner without manager grant | Manager-only award/management denied; test writes only in separately approved disposable fixture plan |
| Unrelated identity/community B | A's protected resources not exposed; record actual contract-appropriate403/404 |
| Expired/revoked/wrong-instance sessions | Fail closed; bounded renewal for expiry, revoked sessions must not yield a usable renewed token, wrong issuer rejected |
| Test-only role/grant removal | Next resource authorization reflects removal; performed only by assigned authorized test administrator |

Create synthetic identities/fixtures only after environment approval and authorized owner assignment. Do not create credentials or change security settings through this checklist automatically.

### Public app configuration and identifiers

Exactly three current Dart defines are supported:

```json
{
  "BUNDLEEN_ENV": "staging",
  "BUNDLEEN_API_ORIGIN": "",
  "CLERK_PUBLISHABLE_KEY": ""
}
```

This empty template cannot connect and supplies no approved destination/key. Fill only an owner-approved public-config file outside tracked source. Origin must be HTTPS with no credentials, query, fragment or path other than `/`. Select the matching development/staging flavor explicitly; native IDs and SDK-derived callbacks are listed in the provisional matrix above. There are no runtime ID defines or production fallback. Owner confirmation and external callback registration remain outstanding. Do not switch an existing persisted session to another environment as a substitute for approved isolation.

### Optional services for this read-only slice

- Blob uploads, Geoapify/maps/address onboarding, OpenAI/AI, Bundleen email delivery, QStash/outbox/reminder jobs and device push are outside this slice and may remain unconfigured/disabled in a dedicated test environment. Do not invoke those flows or schedule workers. Do not disable existing production resources or alter shared deployment settings.
- Redis is required once registration/profile completion or other rate-limited mutations enter scope; it is not needed to prove only the three protected GET contracts.
- Clerk delivery/verification required by enabled auth methods is not optional. Provider OAuth/MFA must either be supported/tested when enabled or explicitly recorded as unrun; do not silently turn security features off for a pass.
- Signing teams, store accounts and external beta distribution are unnecessary for simulator/emulator checks. They remain later human-owned release prerequisites.

### Reversible local preparation and commands

These local commands do not provision accounts, change backend settings, or establish live auth. Run from `apps/mobile` with the pinned SDK on PATH:

```sh
flutter pub get --enforce-lockfile
dart format --output=none --set-exit-if-changed lib test
flutter analyze
flutter test
bash tool/verify_flavor_config.sh
flutter build apk --debug --flavor development
flutter build apk --debug --flavor staging
flutter build ios --simulator --debug --no-codesign --flavor development
flutter build ios --simulator --debug --no-codesign --flavor staging
flutter devices
```

Only after parent confirms isolated staging and the account owner confirms required settings, use the public-only config file and an explicitly selected test device:

```sh
# Set BUNDLEEN_MOBILE_CONFIG to an absolute path outside tracked source.
# Set BUNDLEEN_TEST_DEVICE to the intended simulator/emulator identifier.
flutter run --flavor staging -d "$BUNDLEEN_TEST_DEVICE" --dart-define-from-file="$BUNDLEEN_MOBILE_CONFIG"
```

Do not put auth credentials in those variables. Enter authorized test identity credentials through the system-browser Clerk flow. API probes requiring tokens must use a reviewed redacted harness; no curl commands with bearer values in shell history. Existing root `npm run build` runs migrations and is not a local compile command.

### Live acceptance record

Record app/backend revisions, SDK versions, device/OS, environment/fixture aliases, sanitized statuses and screenshots. Successful sequence on both platforms: sign-in → GET /api/profile → GET /api/me/context → GET /api/homeowner/dashboard → sign-out → protected-read rejection. Also check sign-up with enabled verification, cancellation vs failure/retry, background/resume, cold/warm callbacks, expired token renewal, revoke/foreign-instance denial, wrong role/community and sign-out racing an in-flight read. Confirm secure OS persistence/backup exclusions and no stale private UI after account change. Revoked issued JWTs may remain valid until expiry; measure the actual window, never claim immediate revocation without evidence. Fake channel/unit tests cannot pass these gates.

Local document/test preparation is already authorized and reversible. Resource creation/billing, account/Native API/security changes, callbacks/domain registrations, fixture-account creation, revocation/demotion authority, production deployment, agreements and store publication need the appropriate explicit human authority through parent Engineering. Parent must coordinate a backend writer before any shared schema/API change. No such change is authorized by this readiness document.
