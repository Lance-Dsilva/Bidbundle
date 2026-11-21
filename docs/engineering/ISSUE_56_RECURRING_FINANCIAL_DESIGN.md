# Issue 56 recurring financial adapter — implementation design

Status: design only. The foundation is under independent PostgreSQL verification. Do not enable recurring money dispatch or claim this adapter exists yet.

## Immutable source and ownership

`RecurringCharge` has exactly one source: a sealed `RecurringMonthlyBill`, or one completed recurring `ServiceVisit` for a `per_visit` plan. Unique source constraints and `RecurringChargeLine.visitId` uniqueness prevent duplicate billing. Monthly charge lines copy every nonzero completed bill line; skipped/blocked/cancelled and redo work never contributes money. Every line belongs to the same plan, subscription, unit, original payer, currency and service month.

Charge reservation freezes original resident/customer/payment method/receipt, provider/account, accepted recurring terms, amount, platform fee, HOA rate/share, and generated source identity. Original consent/card timestamps must precede service completion. Current occupancy cannot change payer. A live original provider payout verification is required before actual transfer; account replacement cannot retarget an existing operation.

Amounts below Stripe's 50-cent minimum remain an explicit billing-review hold with no network charge. Never round up or carry them into another month without new explicit authorization. Per-visit proposal validation can reject rates that produce subminimum allocations; monthly skipped totals still require the hold.

All new money paths remain sandbox-only and independently feature-gated. Existing finite `StripeTestPayment` flows stay unchanged. No synthetic visit rows represent an aggregate Stripe payment.

## Exact cents and constituent entitlements

Manager-approved rule: compute each line's platform fee as `floor(lineGross * feeBps / 10000)` and HOA share as `floor(lineGross * hoaBps / 10000)`, then sum the immutable line entitlements for the aggregate charge. Provider receives each line's gross minus its fee, always at least 90% on every line and every remaining subset after refunds. HOA share fits inside that line's platform fee. Bundleen absorbs fractional-cent rounding differences; do not redistribute an aggregate fee remainder onto lines, which could reduce a remaining line's provider percentage below 90%. Resident aggregate gross is exactly the sum of completed visit allocations.

For cumulative refunded amount `r` on a line of gross `g`, cumulative provider debit is `floor(providerEntitlement*r/g)` and HOA debit is `floor(hoaEntitlement*r/g)`. Never round each incremental refund independently. Full refunds of every line return exactly all provider/HOA entitlements. A line refund cannot exceed that line's remaining gross; pending reservations consume its refundable balance.

Before the first provider transfer, actual transfer amount is the sum of current net provider line entitlements. Freeze this transfer baseline before network dispatch. After transfer, further refunds reverse only the incremental provider entitlement attributable to the new line refund, with a separate durable reversal identity. Unknown processor-side adjustments do not invent a line attribution: place a reconciliation hold until ownership is established.

## Remote identity and recovery

Create an unconfirmed PaymentIntent with stable `recurring_create_<chargeId>` key, persist its ID, then confirm that same intent using `recurring_confirm_<chargeId>`. Monthly transfer group includes plan, subscription/unit and local month to avoid cross-plan collision. A failed/requires-action charge retains its PI; explicit original-payer recovery creates an immutable replacement-card attempt with its own consent and confirmation version. Always retrieve and validate authoritative amount/currency/customer/method/metadata/test mode/receipt before reconfirming. Client secrets are returned only to the original authenticated payer and never included in notifications, logs or history.

Provider transfer/refund/reversal operations each record identity and attempt clock before network mutation. Recover matching remote records before retry; reject duplicate or mismatched remote identities. Uncertain outcomes outside the idempotency window require reconciliation, not blind recreation. Unresolved service claims, pending refunds and processor holds block transfer dispatch under the same payment authority lock.

## Integration boundaries

- Webhook inbox dispatch resolves `RecurringCharge` independently by exact PI/charge ownership. It must not interpret aggregate amounts as a constituent visit's amount. Financial observations record processor totals separately from owned refund totals and hold unknown refund/dispute/reversal changes.
- Service-quality refund decisions link the actual recurring refund operation and constituent visit. `refund_complete` requires Stripe refund plus required provider reversal success. Free redo remains a distinct zero-charge visit. Existing finite claim execution remains intact.
- HOA earned entries support exactly one source (finite visit payment or recurring charge). A paid aggregate charge creates one earning target, with cumulative line-based HOA adjustments. No per-visit duplicate accrual. Existing negative carry, monthly statements and payout holds include both source families.
- Resident/provider histories expose actual aggregate charge and safe constituent descriptions, not card/customer IDs. Original payer owns receipt/recovery; an HOA manager sees scoped subscriber counts and association accounting.
- The monthly worker seals only ended local months with all constituents terminal, then reserves/charges exactly once. It fairly retries older unprocessed/failed bills rather than only the newest month. Per-visit mode dispatches only its own completed source through the new adapter.

## Required evidence before enabling

Independent tests must cover aggregate source collision, per-visit exclusion, exact prorating and rounding, card/owner mismatch, monthly charge replay, lost remote response, requires-action recovery, partial/full line refunds before/after transfer, claim races, duplicate and unknown webhooks, one HOA accrual, immutable receipt, and actual database concurrency. Full unit/type/build and sandbox end-to-end gates follow. Foundation completion alone is not issue completion.
