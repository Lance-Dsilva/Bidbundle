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

## Receipt and saved-card completion checkpoint

Receipt commit `f776ba7` and saved-card commit `7b92456` are integrated, independently reviewed and tested. Verified original-payer receipt email is immutable and private; legacy null remains unchanged, retries validate recipient identity. Existing cards can be selected only through payer/customer-scoped references, with fresh request consent and SetupIntent, bank-verification handling, retry-safe enrollment and a change-card restart.

Final combined evidence: **2,864/2,864 unit/component/API checks (175 files), 80/80 PostgreSQL checks (6 files), all 52 migrations in the owned synthetic local database, direct production build and TypeScript**. No real Stripe delivery or bank challenge is claimed. Stripe sandbox does not automatically send receipt emails; configuration/recipient and hosted receipt verification are distinct from actual delivery. Owner already reported receipt settings enabled.

Issue43 actionable implementation is parked for the existing private sandbox-key prerequisite and subsequent engineering-owned webhook/live sandbox/authenticated-browser verification. It remains draft and open; no merge or shared migration. Next independent implementation is actual issue44 HOA revenue sharing on an isolated branch stacked on this verified source. Root remains integration owner; mobile42/SMS53 remain parked.

## Sandbox prerequisite resumed

User supplied the private sandbox-key file on 2026-11-21. Scoped API access and balance.livemode=false verified. New owned loopback database bundleen_issue43_test_live has the 52-migration PR73 schema. Official Stripe CLI forwarding reached the actual HTTP webhook inbox: signed customer.created persisted, invalid signature returned400. Local webhook harness holds the listener while the independently owned domain sandbox suite runs. This does not establish authenticated browser, Connect event or full charge/refund/transfer acceptance. Keys and resource evidence remain in owner-only temporary files; no shared database or production change. Next: finish domain sandbox suite, inspect actual onboarding capability gate, then authenticated browser and financial event/retry verification before merge.

Sandbox result: application-domain offer/card flow created and confirmed a real test SetupIntent and saved the test card; customer PaymentIntent list remained empty at setup. Real CLI-signed HTTP webhook test passed and listener stopped cleanly. Connect account creation failed with Stripe400 Accounts-v1 API policy disabled; no account/onboarding link, charge, provider transfer or refund was created. User was asked to sign into the specific Stripe dashboard API-policy page so engineering can inspect scope before any setting change. Existing key prerequisite is satisfied; do not request the key again. Standalone tests suppress repeated known-policy attempts unless STRIPE_CONNECT_POLICY_RECHECK=1 is deliberately set after a changed prerequisite. No money-gate completion is claimed.

Harness limits and prerequisites: card verification seeds a synthetic legacy post-award consent with payments disabled during fixture creation; it does not establish the current protected resident-enrollment browser flow. The opt-in `stripe-live-sandbox.config.mts`/`stripe-live-webhook.config.mts` configs require the exact owned loopback database, sandbox key file, and official Stripe CLI at `/private/tmp/bundleen-stripe-cli/node_modules/.bin/stripe`; webhook signing secret is owner-only at `/private/tmp/bundleen-stripe-webhook-secret`. No secrets or remote account URLs are committed. Historical artifact flags must skip rather than report a fresh successful test without renewed verification.
