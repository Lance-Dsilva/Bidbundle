# Issue 43 combined integration checkpoint

Updated 2026-11-21. Branch `codex/issue-43-stripe-payments`, draft PR73. Source integration head `3416ffd`; the following checkpoint commit includes regression tests. Root owns integration. No issue is resolved by this checkpoint.

## Integrated behavior

- PR74/#49 price commitments, immutable enrollment consent, original payer authorization and capped visit allocations.
- Same-PaymentIntent recovery, durable refunds and proportional provider reversals.
- PR76/#50 claims, unresolved-claim payout holds, owner-authorized refunds, zero-charge redo visits and truthful financial resolution.
- Residual provider payout snapshots: after a $4 refund on a $10 payment with $9 provider allocation, the actual transfer is $5.40. History and reversal validation use that actual transfer, not the original allocation.
- Read-only financial webhook reconciliation, atomic event/ledger observations, bounded retry backoff and persistent holds for unexplained financial adjustments.
- Scoped resident/provider/admin payment histories, hosted receipt verification and hold-aware controls.

## Verified gates

- 2,835 unit/component/API tests across 174 files passed.
- All 51 migrations applied to a new owned synthetic local database only.
- 77 combined PostgreSQL checks across billing, pricing, enrollment, claims and histories passed. Deterministic fixture order is explicit in `tests/postgres/stripe-combined.config.mts`; feature flags are scoped per suite.
- TypeScript and direct Next production build passed. Build did not run migrations.
- Independent combined source review approved; independent claims database rerun passed all 8 checks. Added explicit actual-transfer regressions for histories and external reversals.
- Current main `382ec7b` is already an ancestor of this branch; no upstream merge conflict. GitHub reports PR73 mergeable, but acceptance is incomplete and it stays draft.

## Remaining / next owner

Engineering: finish receipt-email acceptance audit and remaining #43 flows; configure sandbox platform/Connect webhooks and verify actual Stripe plus authenticated browser end-to-end behavior before merge. Synthetic transport tests are not live Stripe evidence.

User prerequisite: the Development Stripe secret is write-only. A private local sandbox-key file was requested at `/private/tmp/bundleen-stripe-test-key`; no answer received at checkpoint. Never paste credentials in chat. Broad environment download was rejected and not retried. Preview/Development API-variable metadata exists; webhook signing secrets still require scoped setup.

No shared database migration, production deployment or live financial operation occurred. Do not deploy under historical release approvals. Flutter PR42 and SMS53 remain parked by the user. Other open issues remain open pending their own acceptance and resolving merges. Continue independent eligible backlog work when the Stripe prerequisite is the only remaining gate.

## Continuation after combined push

Combined checkpoint `ff514fb` pushed to PR73; current-head Vercel status is successful. Team audit identified saved-card reuse across requests as a remaining code requirement. Receipt implementation owns `/private/tmp/bundleen-receipt-integration`; saved-card implementation owns `/private/tmp/bundleen-saved-card-reuse`, both isolated. Root owns the payment-history navigation correction (show link when either setup or payments flag is enabled), with TypeScript passed. Review and integrate both slices before re-running combined gates. No live Stripe key file is present yet.
