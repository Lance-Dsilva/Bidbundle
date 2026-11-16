# Issue 50 — service quality intake (draft)

This is the intake milestone for #50, not the completed Bundleen guarantee.

## Available behind SERVICE_QUALITY_INTAKE=1

Completed HOA visit cards show Report a problem. A current resident may report within 72 hours, checked using the database wall clock after locking the visit and membership. One visit has one claim; concurrent retries return the original owned claim. A different unit, removed/re-added resident, changed membership after completion, or future completion timestamp is rejected. Membership changes that are otherwise harmless may conservatively require contacting support; frozen payer integration from #43 remains necessary before financial actions.

The transaction creates an existing SupportTicket with category service_quality, its first message/event, a separate claim and resident/provider in-app notifications. Providers use /app/provider/quality and can read only their own claim's first resident description, reason and status, not internal support notes or other residents' details. Their response is immutable and appended to support as an internal note. The resident form explicitly says its description is shared with the provider.

Administrators use /app/admin/quality to open the support ticket and record a redo_pending or refund_pending intent. The active admin allowlist is rechecked under a transaction lock. These actions never close the ticket, create a redo visit, call Stripe, move funds or claim that a refund executed. Appending a response or resolution updates support activity/concurrency timestamps and records a timeline event atomically.

## Private evidence

After reporting, the resident may attach up to eight JPEG/PNG/WebP photos of at most 4 MiB each within the same 72-hour completion window, while the claim remains reported. The existing image normalizer strips metadata and rejects malformed/oversized files. Evidence uses the explicitly configured private visit-photo store (VISIT_PHOTO_BLOB_READ_WRITE_TOKEN or VISIT_PHOTO_BLOB_STORE_ID), never a fallback public store. A separate ServiceQualityPhoto table prevents public MediaAsset/marketing routes from exposing claim photos.

Only the original reporting resident with current access, assigned active provider, or verified nonstaff active administrator can read. Managers and other residents are denied. Uploads recheck access and the eight-photo cap under a claim lock after network transport; failed attachments delete only their own generated object. Download access is rechecked after private Blob transport and all responses, including denials, use private/no-store and nosniff headers.

## Provider quality review signals

The admin quality page shows a bounded 30-day completed-visit cohort and its claim rate. Both counts use visit completion time, preventing a mixed ticket-date denominator. The default review signal is strictly above 20% with at least five completed visits, configurable through SERVICE_QUALITY_FLAG_RATE_BPS and SERVICE_QUALITY_FLAG_MIN_VISITS. This is informational only and never suspends accounts or holds funds automatically.

## Unfinished acceptance gates

- Binding to #43's actual payment and frozen payer; completed/paid eligibility and provider transfer hold/reversal.
- Durable no-charge redo scheduling and Stripe full/partial refund execution/reconciliation.
- Public guarantee copy on the homepage/residents/request and final resident terms. Do not publish a financial promise before the execution workflow is working.
- Live authenticated UI/end-to-end checks and reviewed migration rollout.

No shared database migration, external delivery or production deployment is performed by this branch. Keep the feature disabled until remaining release gates are satisfied.

## Validation

Run npm run typecheck, npx vitest run tests/service-quality.test.ts tests/service-quality-ui.test.tsx tests/service-quality-photos.test.ts and direct npx next build (npm run build runs migrations).

For PostgreSQL, create a disposable owned loopback database named quality_test with role quality_test and pass TEST_DATABASE_URL explicitly. Apply all repository migrations to that empty database, then run npx vitest run --config tests/postgres/service-quality.config.mts. It validates real workflow-created completed visits, concurrent claim retries, ticket/notification atomicity, provider replies, pending-only resolution and removed/re-added membership and concurrent private photo limits. Tests never use application environment files or deliver email/Blob requests.
