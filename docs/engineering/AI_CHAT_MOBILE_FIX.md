# AI request failure and mobile composer fix

User-reported on November 10, 2026: the mobile send control is stretched and overlaps the open launcher; AI requests show “Profile setup is temporarily unavailable.”

The send control was 36px wide while the shared mobile button rule enforced a minimum height of 44px. It is now a nonshrinking 44×44 rounded square with an accessible name, a semantic form and a composer that can shrink. The launcher is hidden while the dialog is open; close/Escape restores focus after it becomes visible again. Clear/close/retry controls meet the mobile touch target, and unavailable responses use a distinct warning treatment.

The AI route authenticates and checks its rate limiter before model execution. Its limiter recognized direct Upstash and legacy KV settings but ignored the replacement connection’s RATE_LIMIT_KV_REST_API_URL/TOKEN. Vercel connection metadata confirmed that the legacy KV variables belonged to an uninstalled resource; the available replacement is connected under RATE_LIMIT_. The obsolete connection and its five obsolete aliases were disconnected after an exact dry-run; all other connections were compared and unchanged. No database or Redis resource was deleted, recreated or purchased; no credential values were exported.

The complete dedicated REST pair now takes precedence. Complete direct/legacy pairs remain compatible, values are trimmed and partial pairs are never mixed. A failed selected store never falls through to a different limiter. Production protection and limits remain enforced. The AI-only 503 response names Bundleen AI and supplies Retry-After:30 and private,no-store; ordinary profile and 429 responses remain unchanged.

## Verification

- 87/87 focused AI, limiter and UI checks passed, including no model/conversation/tool work after a denied rate-limit check.
- Full unit suite: 2,434/2,438 passed; only the four previously recorded enrollment-reconciliation failures, matched by exact test name and first error. Zero new failures or skipped tests.
- Standalone TypeScript and Next build passed after generating the branch-local Prisma client. Build used synthetic Clerk configuration and did not run migrations.
- Actual components were checked in a clearly labeled synthetic browser fixture at 320px, 390px and 1280px. Send measured 44×44, the launcher was hidden while open, no page overflow occurred, and actual Enter submission/close-focus behavior passed. Requests were local stubs; this is not authenticated live AI verification.
- Read-only production-scoped PING/constant-EVAL diagnostic jobs failed at Vercel resource provisioning before their scripts ran. No Redis command or model call was executed by those jobs. Available-resource metadata does not establish live Redis transport health. Do not report a successful chat or deploy from this evidence.

## Handoff

No schema migration or dependency change is included. Issue #59’s partial vendor-sourcing work remains on its separate uncommitted branch and must not be mixed into this fix. The earlier production approval covered the completed PR65/66 release; this fix requires its own release authority and current-head checks. Keep deployment protection enabled. Verify the selected Redis connection and one authorized signed-in AI request when the environment permits; never bypass the limiter to make chat work.
