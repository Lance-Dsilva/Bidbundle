# Stripe and service-quality integration handoff

This document records read-only dependency review. No claim integration is implemented by this handoff.

## Verified dependency

Issue #50 is draft PR #76, branch `codex/issue-50-service-guarantee`, inspected at head `2b000a88fdb0c70ba370645164fb6a38a2e350fe` through the GitHub connector. PR #75 concerns issue #57 analytics.

PR #76 adds completed-visit reports within 72 hours, one claim/support ticket per visit, provider replies, private normalized claim photos, administrator pending-resolution requests and informational provider claim metrics. Its persisted resolution states are `reported`, `redo_pending` and `refund_pending`. No terminal resolution state, refund execution or redo scheduling exists at the reviewed head. `SERVICE_QUALITY_INTAKE` defaults off. Blob/auth transport remains unverified live.

Coordinate with the owner of PR #76 before editing its implementation. Recheck its current GitHub head and handoff before integration.

## Source hooks

- PR #76 `src/lib/server/service-quality.ts`: `reportServiceQuality` locks `ServiceVisit` then membership, checks current resident/unit access and membership timestamps against completion, checks the database wall clock, and atomically creates the ticket, claim and resident/provider notifications. Frozen payer/payment integration remains pending.
- `requestQualityResolution` currently locks `AdminAccessGrant` then `ServiceQualityClaim`, records pending intent and support timeline activity, and returns `executed: false`. It does not lock the visit or payment and does not execute money movement.
- PR #76 `prisma/migrations/20261116010000_service_quality_intake/migration.sql`: claim table, one-per-visit uniqueness and pending-only resolution constraints. A later additive migration must introduce execution linkage and terminal outcomes.
- PR #76 `src/lib/server/service-quality-photos.ts` and separate `ServiceQualityPhoto` preserve private evidence. Retain these authorization/transport rules and keep evidence outside public MediaAsset/marketing paths.
- PR #73 `src/lib/server/stripe-test-transfers.ts`: `transferStripeTestPayment` already locks the visit then payment. Add an unresolved-claim check under that visit lock before remote transfer. Check persisted claims even when the intake flag is off.
- `src/lib/server/stripe-test-refunds.ts`: reuse the durable refund/reversal processor after an authorized resolution reserves a uniquely linked operation. `StripeTestRefund` is the execution record; pending intent alone is insufficient evidence of execution.
- `src/lib/server/stripe-test-payments.ts`: use immutable original payer, visit and payment identity. A current replacement occupant must not gain access to the original payer’s financial operation.

## Lock and execution contract

Serialize local financial resolution on `ServiceVisit` then `StripeTestPayment` then claim/operation records, consistently with transfer and claim intake. Recheck current administrator authority under the established User/AdminAccessGrant locks. Avoid claim-first code that later takes a visit lock. Direct database and concurrent writer behavior needs the same invariant.

Transfer processing must refuse unresolved `reported`, `redo_pending` and `refund_pending` claims. The 72-hour period is a reporting window, not a blanket payout delay. A claim received after a transfer already completed requires refund/reversal recovery rather than an invented retroactive hold.

Financial resolution needs an immutable claim-to-payment/frozen-payer link, verified completed/paid eligibility, a unique claim-to-refund operation identity and explicit authorized refund amount within the remaining paid balance. A report may arrive before payment settles; defer its financial execution until payment identity and settlement are verified. Current primary-owner authorization is required to turn a pending resolution into a refund request under the existing refund API contract.

Record the resident refund as successful when Stripe confirms it. Keep the claim unresolved while a required provider reversal is pending. Close the claim/ticket only after the durable ledger confirms refund and required reversal completion, with an atomic support/audit event. Remote success followed by local failure must reconcile the same remote operation rather than reserve another refund.

A redo requires a new visit linked to the original visit and explicitly excluded from payment preparation/outbox charging. Preserve the original completed visit and proof. Do not reset completed work or reuse its original charge identity.

## Minimum acceptance checks

1. Observe the actual database wait for both orderings of claim intake versus transfer release. Every unresolved claim blocks a new transfer, including after the intake flag is disabled.
2. Duplicate resolution/refund requests reserve one ledger operation and one authorization audit. Unknown external refunds/reversals require reconciliation.
3. Refund success with reversal failure leaves truthful refund state and an unresolved claim. Retry and lost-response cases reuse the same refund and reversal identities.
4. The original payer remains the financial subject. Replacement-occupant reports cannot redirect or refund another payer’s charge.
5. A no-charge redo creates service work without a new payment or charge outbox event. Completed original work stays immutable.
6. Terminal resolution releases only an otherwise eligible unrefunded provider balance. Existing transfer restrictions and provider/account checks remain effective.
7. Preserve cross-role evidence privacy, 72-hour post-lock reporting checks, atomic support activity and notification deduplication.

## Remaining completion gates

Integrate and review the overlapping schema/marketplace code on an isolated branch. Apply the full combined migration chain only to an owned disposable database and run the concurrency/identity tests. Complete private Blob and signed-in cross-role browser verification, real Stripe sandbox refund/reversal and transfer verification, payment history/provider earnings and outcome notifications. Public guarantee copy and resident terms should reflect the executed workflow once verified. Shared database migrations, production activation and release still require their applicable authorization. Keep issues #43 and #50 open until their actual completion gates and resolving merges are confirmed.
