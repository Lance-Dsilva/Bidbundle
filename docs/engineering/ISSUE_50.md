# Issue 50 — service quality intake (draft)

This is the intake milestone for #50, not the completed Bundleen guarantee.

## Available behind SERVICE_QUALITY_INTAKE=1

Completed HOA visit cards show Report a problem. A current resident may report within 72 hours, checked using the database wall clock after locking the visit and membership. One visit has one claim; concurrent retries return the original owned claim. A different unit, removed/re-added resident, changed membership after completion, or future completion timestamp is rejected. Membership changes that are otherwise harmless may conservatively require contacting support; frozen payer integration from #43 remains necessary before financial actions.

The transaction creates an existing SupportTicket with category service_quality, its first message/event, a separate claim and resident/provider in-app notifications. Providers use /app/provider/quality and can read only their own claim's first resident description, reason and status, not internal support notes or other residents' details. Their response is immutable and appended to support as an internal note. The resident form explicitly says its description is shared with the provider.

Administrators use /app/admin/quality to open the support ticket and record a redo_pending or refund_pending intent. The active admin allowlist is rechecked under a transaction lock. These actions never close the ticket, create a redo visit, call Stripe, move funds or claim that a refund executed. Appending a response or resolution updates support activity/concurrency timestamps and records a timeline event atomically.

## Unfinished acceptance gates

- Resident claim photo upload through the private media pipeline.
- Binding to #43's actual payment and frozen payer; completed/paid eligibility and provider transfer hold/reversal.
- Durable no-charge redo scheduling and Stripe full/partial refund execution/reconciliation.
- Claim-rate metrics and provider threshold flags.
- Public guarantee copy on the homepage/residents/request and final resident terms. Do not publish a financial promise before the execution workflow is working.
- Live authenticated UI/end-to-end checks and reviewed migration rollout.

No shared database migration, external delivery or production deployment is performed by this branch. Keep the feature disabled until remaining release gates are satisfied.

## Validation

Run npm run typecheck, npx vitest run tests/service-quality.test.ts tests/service-quality-ui.test.tsx and direct npx next build (npm run build runs migrations).

For PostgreSQL, create a disposable owned loopback database named quality_test with role quality_test and pass TEST_DATABASE_URL explicitly. Apply all repository migrations to that empty database, then run npx vitest run --config tests/postgres/service-quality.config.mts. It validates real workflow-created completed visits, concurrent claim retries, ticket/notification atomicity, provider replies, pending-only resolution and removed/re-added membership. Tests never use application environment files or deliver email/Blob requests.
