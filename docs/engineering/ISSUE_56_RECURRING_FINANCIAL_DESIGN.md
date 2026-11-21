# Issue 56 recurring financial adapter — implementation design

Status: active implementation. Foundation ff6c736 passed 2,953 unit tests and 4 independent PostgreSQL cases. Financial adapter has passed scoped independent source/SQL review and local checks; parent integration/build and real sandbox end-to-end remain gates. Do not enable it or claim issue completion yet.

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

## Active implementation checkpoint (after foundation ff6c736)

Financial models and source implement distinct charge identity, original-payer history/receipt, two-phase PI create/confirm, versioned same-PI recovery, line refunds, residual transfers, notifications, financial-event observations, quality-claim linkage, shared HOA accrual and fair financial jobs. `RECURRING_TEST_PAYMENTS=0` remains the default. Jobs check all required flags; no real processor calls or shared migrations occurred in this implementation checkout.

13000–16000 were independently reviewed and applied only to the owned synthetic database (62 migrations total). Preserve applied history. Runtime PG testing exposed generic trigger CASE field binding to a nonexistent `NEW.chargeId`; additive 15000 corrected only the two dispatches to IF/ELSE. 14000 supplies the cursor and recurring claim-refund linkage; 16000 supplies immutable sanitized financial-event observations. No migration in this checkpoint is authorized for shared resources.

Existing-visit lock order is Visit (sorted) before Agreement/Plan and Charge, matching completion and claims. Claim execution discovers aggregate ownership and locks all source visits before the target claim. Financial mutations recheck remote identities and balances. Read-only metadata recovery precedes new mutations. Unknown refund/reversal/dispute/transfer observations produce sticky holds; later matching totals do not silently clear them. Administrative reconciliation requires a separate authorized action. Webhook handling records existing refunds only and never initiates an operation based on metadata. HOA entries have exactly one finite or recurring source, and both families share payout liability/hold locks.

Reviewer-driven fixes include exact persisted PI checks; settled refund/dispute status preservation; fresh original-payer/hold checks before secret release; durable recovery setup sequence/clock with a 23-hour uncertainty cutoff; fresh remote charge/account checks before payout; current owner checks before refunds; immutable clocks and transfer baselines; deferred settled ledger consistency. Bundleen's possible negative one-cent residual fee is represented explicitly, never taken from provider or HOA.

Verification: full backend suite 3,081 tests across 186 files; final affected tests 122/122 and typecheck passed after the last narrow event/identity changes. Independent PostgreSQL suite 8/8 passed over 62 migrations: concurrent single aggregate/source immutability; one HOA accrual and refund ceiling; null-baseline rejection with legal control; observed pending-refund/HOA payout wait; claim wrong-line and pending-reversal rejection followed by truthful completion; observed Visit-before-Agreement ordering; duplicate immutable observations/unknown refund hold; and foreign transfer ownership hold. All processor operations in these tests are synthetic mocks, not live sandbox proof. Historical service dates use the reviewed synthetic fixture helper; this is not production chronology evidence. The HOA wait case establishes lock/recheck behavior with a zero-balance payout rejection, not a successful positive payout. Final cleanup found zero temporary helper artifacts.

Parent owns final UI integration, combined full suite/type/build, PR handoff and any release decision. Root-owned history/event tests and verifier-owned financial tests are included only after their explicit release. Remaining external gate is real sandbox end-to-end with Connect availability, plus applicable deployment/migration approval. No issue resolution or production completion is claimed by this implementation commit.
