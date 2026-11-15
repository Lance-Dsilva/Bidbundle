# Mobile architecture proposal

Status: reviewed foundation architecture, 2026-11-01; first read-only Flutter scaffold and native bridges implemented, not live-verified. Baseline fb4a245721ffdd69dd0255c0ef021e6b6fbb08ed. Owner: Flutter Lead / Architect.

## Boundaries

Create `apps/mobile` as an independent Flutter package. Existing Next.js routes remain the only business backend. Flutter calls approved HTTPS JSON contracts; no Postgres connection, privileged keys, copied server role logic, website scraping or WebView product. API origins and Clerk publishable keys are public configuration. All live identity, role, community authorization, prices and lifecycle decisions stay on the server.

Use a small MVVM arrangement: views render immutable state; view models own async commands and presentation transitions; repositories map validated API responses to typed data; one API service handles HTTPS, headers, timeout and error normalization. Inject repositories and session services through constructors at the composition root. SDK `ChangeNotifier`/`Listenable` is adequate initially; avoid a service locator or code-generation framework until complexity warrants it. Use `go_router` for auth redirects, nested role navigation and deep links, subject to package version/license verification at installation. This follows the separation and repository guidance in [Flutter architecture recommendations](https://docs.flutter.dev/app-architecture/recommendations), adapted to keep business authority on the server.

Proposed directories: `lib/app` (configuration, composition, routing), `lib/core/auth`, `lib/core/network`, `lib/core/ui`, and `lib/features/{context,homeowner,provider,hoa,notifications,profile,support}`. Each feature contains models/repository, view model and screens as needed, not empty layers. Tests mirror meaningful boundaries.

## Session and routing

An `AuthSession` interface exposes signed-out/loading/signed-in/error state, sign-in, sign-up, current short-lived API token and sign-out. Auth implementation is chosen in AUTH.md; native Clerk SDK bridges are the leading proposal, with platform SDKs responsible for session lifecycle and secure persistence. Dart must not persist refresh tokens or log bearer tokens. A method/event channel contract needs cancellation, platform-error mapping and activity/view-controller lifecycle tests. Xcode/Swift prerequisites are available locally; real integration remains unproven.

After sign-in retrieve current server profile/context before entering a role shell. A client route guard improves UX but grants no permission. Context changes invalidate role-specific caches. A 401 triggers at most one SDK renewal/retry for safe reads, then a signed-out transition; never replay mutations automatically. A 403 becomes a permission or verification screen, not repeated sign-in. On sign-out immediately clear sensitive view state and pending navigation, and report SDK/server revocation failure rather than claiming successful revocation. Use a session-generation identifier to reject stale responses arriving after logout/account change.

## Network and configuration

Use `http` behind a single service, with explicit timeout, immutable request/response models, dependency injection and redacted diagnostics. Choose exact package versions after SDK resolution and commit `pubspec.lock`; do not invent versions. Typed failures distinguish unauthenticated, forbidden, validation, conflict, not-found, rate-limit, network/timeout, server and malformed response. Respect actual backend envelopes and Retry-After where provided. Do not assume pagination, UTC format or currency units until confirmed in API_CONTRACT.md. Disable duplicate submits in UI; only use idempotency keys if the corresponding endpoint supports them.

Environment names: development, staging, production. Require `BUNDLEEN_ENV`, `BUNDLEEN_API_ORIGIN`, `CLERK_PUBLISHABLE_KEY` and reviewed platform redirect/application IDs. No implicit production fallback. Validate scheme/origin at startup; production requires HTTPS. Development and staging use dedicated backend data/Clerk test configuration, never primary-checkout `.env.local`. Native bundle IDs and associated-domain configuration must match Clerk configuration. App-readable config is not a secret store. Distribution signing stays outside source control.

## Native UX

Derive brand colors/logo/type hierarchy from approved homepage V5 and verify font licenses before bundling. Adapt warm paper/forest/teal and serif headings to native screens; do not clone desktop layouts. Use platform back behavior, safe areas, keyboard avoidance, accessible names, scalable text, generous touch targets and reduced motion. Preserve server terminology and status labels. Every data screen has initial-loading, empty, error/retry, refresh and stale-session behavior. Offline reads may retain memory-only state with an explicit stale indicator; no offline mutation queue in initial scope. HOA navigation appears only after server grants, and manager interest does not grant access.

## First executable slice and verification

First slice: native authentication → server profile/context → homeowner dashboard read (final endpoint/envelope owned by backend inventory) → sign-out and expired-session recovery. Use one staging homeowner plus separate role/ownership-negative identities. A fake transport supports tests but is never live gate evidence.

Before live credentials arrive, implement and review DTO parsers, HTTP failure handling, session-race logic, branded state screens, routing and channel contracts with fakes. Do not call Phase 2 passed without actual native builds and live proof on both platforms.

Test meaningful malformed/optional fields, decimal/time handling per contracts, 401 retry bounds, 403, 429, timeout, late-response-after-signout and duplicate taps. Widget tests cover navigation redirects, loading/empty/error and large text. Device tests cover native auth/deep links, resume, expired/revoked session and server isolation. SDK `integration_test` cannot drive all native dialogs, so supplement with platform UI tests/manual recorded evidence or an evaluated native-capable test runner. See [Flutter testing overview](https://docs.flutter.dev/testing/overview). Independent test/security/UX/code reviewers must validate the resulting evidence.

CI proposal: path-filtered mobile workflow; pinned Flutter, dependency lock enforcement, formatter, analyzer, unit/widget/contract tests, Linux Android debug build, macOS unsigned iOS simulator compile. Separate environment-protected staging device jobs use safe test credentials. Never run root `npm run build` as a compile check because it migrates the database. No distribution uploads or deployment are implied.

## Foundation implementation checkpoint

The first single-screen read-only slice now uses constructor-injected HomeModel/HomeRepository/ApiClient and NativeAuthSession. It implements profile/context identity matching, homeowner dashboard reads, explicit unsupported-role preview messaging, secure-session boundary, bounded response handling and sign-out race suppression. No routing dependency is installed yet; nested navigation remains a later slice. Native SDK pins and build evidence are in AUTH.md. Environment flavor identifiers, final launcher art, production font fidelity and full role journeys remain unfinished. Both native debug/simulator targets compile; this does not close the live auth gate.
