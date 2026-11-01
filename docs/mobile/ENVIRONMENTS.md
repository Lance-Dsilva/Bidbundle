# Environment readiness

No configured test backend or Clerk development instance was supplied during this milestone. No production credentials were copied. Application defaults make no network requests when configuration is absent/invalid.

| Environment | API origin | Clerk instance | Identity/data | Readiness |
| --- | --- | --- | --- | --- |
| development | owner-supplied HTTPS dev backend | matching development instance | disposable test data | missing |
| staging | owner-supplied HTTPS staging backend | matching development instance | safe role/negative-test identities | missing |
| production | existing Bundleen backend, confirm release origin | production instance | no test submissions | not authorized for deployment/distribution |

The current scaffold uses provisional `com.bundleen.bundleen` for both platform identifiers. Before side-by-side environment installation/distribution, add distinct reviewed bundle/application IDs and registered callbacks per flavor. Do not switch environments over a persisted SDK session as a substitute for proper isolation. Current launch configuration validates environment name, HTTPS origin without userinfo/path/query/fragment, and test/live publishable-key prefix. This does not cryptographically prove origin/Clerk pairing; the server must validate issuer/session and staging setup must verify the pairing.

Owner inputs needed through secure local/CI configuration:

1. Confirm non-production API URL and Clerk development instance; isolated database/limiter/storage services.
2. Confirm Native API and callback registration for reviewed provisional or final application IDs. Account/security configuration changes require owner action/authorization.
3. Provide safe identities for homeowner, incomplete profile, verified/unverified provider, manager community A, ordinary resident and unrelated community B, plus test-only revocation/demotion capability. Never send passwords/tokens in chat.
4. Identify supported minimum iOS policy (current official SDK requires iOS17), distribution team/store ownership and eventual signing setup.

App-visible defines: BUNDLEEN_ENV, BUNDLEEN_API_ORIGIN, CLERK_PUBLISHABLE_KEY. Use --dart-define-from-file with a secure local file containing only these public configuration values; identity secrets never belong there. Test execution must not log callback URLs or bearer tokens. See AUTH.md for exact callback and validation requirements.

Next live task: configure staging, build each native target, sign in via official hosted SDK, read profile/context/homeowner dashboard, sign out, test expired/revoked/foreign-instance and role/community denial cases. No phase gate closes on the basis of source inspection or fixtures.
