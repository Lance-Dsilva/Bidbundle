# Issue 43 — immutable receipt recipient

Base: `3416ffde71045cbc7cc57fddb905ff3c3ab21537` (PR #73 integration).

New application-prepared sandbox payments snapshot `StripeTestPayment.receiptEmail` from the immutable original payer's locked User record. The address must be normalized, valid, and marked verified. The profile provisioning API derives email and verification from Clerk's authenticated primary email, not request-body fields. The payment snapshot cannot change when a profile email or unit occupant changes.

New PaymentIntent creation sends this snapshot as `receipt_email`, retaining the existing creation idempotency key. Customer creation parameters remain unchanged. Regular retrieval, successful confirmation, card-error retrieval and resident recovery reject a mismatched recipient. Receipt email is not serialized into payment histories.

Migration `20261121006000_payment_receipt_email` deliberately leaves historical rows null. Null remains accepted for legacy/import inserts; any nonnull insert must match the locked verified original payer. All recipient changes, including null-to-value and value-to-null, are rejected. The application requires a verified recipient for newly prepared payments. No retrospective receipt recipient is invented or sent.

Validation:
- 2,844 unit/UI tests across 175 files pass.
- TypeScript `tsc --noEmit` passes.
- 96 focused payment, recovery, receipt snapshot and history checks pass.
- 52 migrations apply cleanly to the owned disposable `bundleen_issue43_test_receipts` database on loopback port 53952.
- Ordered PostgreSQL suite passes 11 checks: 8 existing quality/financial fixture checks and 3 receipt groups covering verified normalized matching, wrong/unverified/malformed email rejection, immutable snapshots, changed profiles and preserved historical null.
- Independent source and SQL review approved. No production or shared database changed; no real Stripe API calls, emails or keys used.

The owner already confirmed Stripe receipt email settings and branding are enabled (issue #43 comment 6763219901); no repeat user action is needed. Stripe's documented sandbox behavior does not automatically email payment receipts. Sandbox acceptance can verify configured recipient and hosted receipt; actual automatic delivery cannot be claimed from these tests. See https://docs.stripe.com/receipts .

Next: manager integrates this scoped commit into PR #73, reruns combined migrations/regressions/build, then performs the still-required authorized Stripe sandbox end-to-end flow. This milestone does not resolve issue #43 or authorize live-mode activation.
