# Issue 54 — private visit photos and delayed ratings

Implements [issue #54](https://github.com/Lance-Dsilva/Bidbundle/issues/54). It was developed independently of the pool-template PR #65; the latest user-approved production release combines PRs #65 and #66. Mobile development remains parked.

## Behavior

Awarded providers can upload JPEG, PNG and WebP before/after photos to a scheduled or active visit. Input and normalized output are capped at 4 MiB, with eight active images per purpose per visit. The existing image normalizer verifies bytes, bounds decode dimensions and removes EXIF metadata. New images always use private Blob access, an immutable visit-specific pathname, and an empty server-only storage URL field. Failed database commits clean up only their own uploaded object.

Every image read authenticates and rechecks the exact resident household, awarded provider, scoped manager or active admin. Responses are private/no-store. Other residents and amenity-media routes cannot read home-visit photos. Photo subjects, bytes and associations cannot be changed after upload. Providers may remove a mistaken image before completion; completed evidence cannot be removed or restored.

Category photo policy applies to future requests only. Pool care initially requires an after photo; other supported categories initially do not. Admins can change these defaults for future requests. The database snapshots the requirement when a request is created and copies it to awarded visits. Existing requests/visits remain exempt. Completion locks current provider/visit authority and checks after-photo evidence in the same transaction; UI gating is additional guidance.

Residents see their own photos and may grant or withdraw marketing permission for each exact immutable photo/checksum. A manager/provider role cannot grant resident permission. An original consenter may withdraw their own permission after moving away, without gaining photo-read access. Giving permission does not publish anything: this change introduces no public-photo or marketing-export path.

Completion produces an immediate visit notice. One durable outbox event becomes due two hours later. Its frozen completion-recipient ID prevents a replacement resident from receiving the prior occupant's prompt. Processing rechecks completed status, timing, current household membership, homeowner role, existing review and email preference. Inbox and email share stable deduplication identities; email failures retry without duplicating the inbox. Ratings remain 1–5; comments are optional. Published ratings flow through existing provider profile data and the bid/request comparison aggregates. SMS is separately gated in issue #53 and is not enabled here.

The resident hub now includes bounded recent completed visits alongside nearest live visits, so a completion prompt can reach the photo/rating card even when more than twenty recurring visits were created together. Managers see private per-request completion galleries and published rating averages.

## Existing worker

The existing authenticated `/api/jobs/reminders` worker drains due events. Read-only production request metadata on November 10, 2026 showed six HTTP 200 calls at approximately five-minute intervals from 12:25 through 12:50 UTC. No worker was invoked manually and no scheduler configuration was changed. The new event is due at completion +2h; actual delivery follows the next successful worker pass and email delivery/retries. This is separate from the local eight-hour Engineering Manager automation.

## Verification

- All 33 migration SQL files applied to a fresh owned PostgreSQL 16 database, including genuine pre-migration legacy visit fixtures. New migration SHA-256: `8328bb3036ca1a73c30de2b5dc72ba90ec2dc14e65379f5f52274789618785d0`.
- 34/34 PostgreSQL tests passed: private ownership and cross-purpose denial; bounds and concurrent final-slot uploads; immutable targets/bytes; consent, revocation and membership races; provider suspension/agreement cancellation/slow-upload reassignment; completion after evidence removal; delayed prompt timing, retries, concurrency, opt-out and frozen/replacement/role-changed recipients; actual 21-visit visibility regression. SQL and domain services were real. Blob transport and delivery scheduling were substituted; no real external delivery or global outbox drain ran.
- Full unit suite: 2,337/2,341 passed; zero new failures and zero skipped. Four previously reproduced baseline failures remain in `neighborhood-enrollment-reconciliation.test.ts` (automatic opening, competing claims, rollback and bounded sweep).
- Standalone TypeScript and final `next build` passed with synthetic auth and Google Fonts network access. No standalone lint script exists.
- Seventeen focused component tests passed. Actual components were checked in a clearly synthetic local browser fixture at desktop 1280px/mobile 390px: loaded images, no document overflow, required-after completion disabled, rating without a comment, exact-photo consent/revocation, and expanded manager gallery with no resident consent controls. This is not authenticated deployed end-to-end or a real Blob round-trip test.
- Independent backend review and a separate review of private media, prompts and policy found no remaining blocker after recipient-role and completed-visit discoverability fixes.

### Combined release verification

After reconciling PRs #65 and #66, the combined PostgreSQL suites passed **65/65**, and the full unit suite passed **2,387/2,391** with four unchanged enrollment-reconciliation baseline failures. Standalone TypeScript and `next build` passed. The feature-only results above remain historical evidence. Shared migrations, the remote private Blob round-trip and production verification are pending.

Normal checks after dependency installation and Prisma generation:

```sh
npx prisma generate
npm test
npm run typecheck
npx next build
```

Use test-only Clerk configuration and Google Fonts access when compiling. `npm run build` also applies migrations; use `next build` for compilation alone. PostgreSQL verification requires an owned loopback database on port 54371, named `bundleen_issue54_test_*`, with a synthetic `bundleen_issue54_runner_*` role. Apply the SQL migration chain only to that empty disposable target and run:

```sh
TEST_DATABASE_URL='<owned loopback test connection>' npx vitest run --config tests/postgres/visit-photo-proof.config.mts
```

The configuration rejects other targets and does not load application environment files.

## Release boundary and next owner

The latest explicit user instruction to deploy to production authorizes the combined release of [PR #65](https://github.com/Lance-Dsilva/Bidbundle/pull/65) and [PR #66](https://github.com/Lance-Dsilva/Bidbundle/pull/66), the necessary reviewed migrations and configuration using the existing private Blob store. This supersedes the earlier feature-branch approval hold. It does not resume mobile PR #42 or authorize unrelated future releases.

The combined candidate is `codex/release-65-66`; its branch deployment holds are removed. The existing private store is reused, and its nonsecret identifier is configured for Production and Preview. Private storage authentication accepts either the scoped server-only `VISIT_PHOTO_BLOB_READ_WRITE_TOKEN`, or the explicit `VISIT_PHOTO_BLOB_STORE_ID` with a short-lived Vercel OIDC identity. There is no fallback to generic public-media or provider-document credentials. Shared credentials stay in Vercel and must not be exported or committed. Uploads fail closed if neither supported authentication configuration is available.

The shared database has not yet received the combined release migrations, and remote smoke verification is pending. Preview shares that database, so a deployment without the approved schema setup is insufficient for authenticated feature verification. Next perform the reviewed migrations and a synthetic private Blob write/read/anonymous-denial/cleanup check, then verify provider, resident and manager flows against the deployed release. Do not use customer photos or run destructive integration fixtures/global workers for smoke testing.

The storage smoke script is explicitly opt-in and must run with the intended Vercel-managed configuration:

```sh
VERIFY_PRIVATE_VISIT_STORAGE=1 node --conditions=react-server scripts/verify-visit-photo-storage.mjs
```

The command is not evidence that the remote check has run. Preserve its sanitized result, clean up only its synthetic object, and keep credentials in Vercel. Neither draft PR status nor local test success closes an issue; confirm the resolving merge and actual completion gates before marking it resolved.

Local sanitized evidence was captured under `/private/tmp/bundleen-issue54-evidence`; this document retains the contracts, commands, results and release boundary for continuation without that local folder. Owned test servers/container were stopped, and all disposable database evidence was retained.
