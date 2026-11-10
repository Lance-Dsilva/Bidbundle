# Issue 54 — private visit photos and delayed ratings

Implements [issue #54](https://github.com/Lance-Dsilva/Bidbundle/issues/54) independently of the pool-template PR #65. Mobile development remains parked.

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

The shared database has not received `20261110150000_visit_photo_proof`. Prior PR #64 migration approval does not authorize this migration. `VISIT_PHOTO_BLOB_READ_WRITE_TOKEN` is a new required server-only secret for a private Blob store; it is currently absent in Vercel metadata. Configure it securely for the intended environment after review. There is no fallback to public media or provider-document credentials. Uploads fail closed until configuration is present; no paid resource was created.

Preview currently shares the existing database, so automatic Git deployment is disabled only for `codex/issue-54-visit-photo-proof`. Other branches retain their behavior. After explicit schema/private-storage setup approval, re-enable that branch and perform authenticated provider/resident/manager verification, including a synthetic private Blob write/read/anonymous-denial/cleanup check. Do not use existing customer photos for smoke tests.

PR #65 and this work touch shared marketplace serializers/schema on separate branches. Reconcile their final merge order and rerun combined verification before any release. Neither a draft PR nor a passed local test closes its issue. Shared migration, merge and production deployment remain subject to the applicable approval.

Local sanitized evidence was captured under `/private/tmp/bundleen-issue54-evidence`; this document retains the contracts, commands, results and release boundary for continuation without that local folder. Owned test servers/container were stopped, and all disposable database evidence was retained.
