# Verification strategy and evidence ledger

No result below is assumed from a plan or mocked SDK. Every run records head, command, tool versions, platform/device, environment alias, exit status, sanitized artifact and reviewer. Tests that need credentials remain separate from local deterministic tests. Never copy production .env.local; never use npm run build for compile checks.

## Layered acceptance
| Layer | Required cases | Evidence |
| --- | --- | --- |
| Config/DTO unit | Invalid/missing origin, HTTP/redirect rejection, unknown roles, nullable profile/context, malformed JSON/number types | Flutter test output |
| Transport unit/contract | Actual first-slice fixtures, timeout, 401 bounded refresh, 403, profile409, 404, 429 Retry-After, HTML middleware response, 5xx, no cross-host token | Injected client tests; separate staging HTTP evidence |
| Session/viewmodel | Double sign-in, cancellation, logout during request, role/account switch, stale response suppression, auth failure vs network failure | Deterministic async tests |
| Widget | Loading/empty/error, keyboard, semantic labels, 48px actions, 200% scale, auth-route redirect/back | Widget tests and screenshots |
| Native SDK | Sign-up/in/renew/out, enabled MFA, cold/warm callback, wrong/replayed callback, resume/process death, secure persistence/backup/logs | iOS and Android device logs/screenshots, redacted |
| Live API | Native bearer through middleware, profile/context/dashboard, wrong instance/expired/revoked token, role demotion, community cross-access | Safe staging identities and server revision |
| Lifecycle writes | Server eligibility, award authority, duplicate/ambiguous submissions, upload failures, cancellation | Slice-specific real safe test data; no production submissions |
| Release | Both release builds, signing prerequisites, dependency licenses, data inventory/deletion, store checks | Exact artifact SHA/version and owner checklist |

## Current ledger
- Source baseline verified: fb4a245721ffdd69dd0255c0ef021e6b6fbb08ed.
- Public homepage and email-first Clerk sign-in visually inspected in browser, no form submissions. Protected product journeys not exercised.
- Route/page inventory: source inspection only; see API_CONTRACT/PARITY.
- Flutter formatter/analyzer pass; 41 independent unit/widget/contract/capture tests pass (TEST_RESULTS.md).
- Android debug APK and iOS simulator builds pass. Four fake widget captures preserved under evidence/. Live staging/auth, secure persistence runtime and platform journey/accessibility tests remain unrun. Runtime launch-only smoke is recorded separately when completed.
- Independent architecture/code/fixture-UX review accepted draft prerequisite milestone; see REVIEW.md.

CI will run only path-scoped mobile jobs and safe server regressions relevant to any backend adaptation. Root test credentials/services must be audited before integration tests; no unreviewed seed/migration scripts. Local successful fake tests never substitute for mandatory live/platform gates.
