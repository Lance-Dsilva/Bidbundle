# Issue 43 — sandbox payments checkpoint

PR: https://github.com/Lance-Dsilva/Bidbundle/pull/73

This is incomplete, disabled-by-default work. It must not be represented as working payments or deployed with live keys.

Implemented:
- Immutable integer per-visit allocation and original payer snapshots at award.
- Exact-price, versioned resident consent with locked residency/completion rechecks.
- Signed test-only webhook intake with durable event deduplication. Bounded worker reconciles owned payment-intent and account events using fresh Stripe reads; unsupported transfer/refund/dispute events remain pending. Pending payment intents are polled to recover missing webhooks.
- Sandbox Customer and card-only off-session SetupIntent, idempotent requests, exact consent metadata.
- Server-side verification and persistent card references, transactionally bound to extant consent/current payer. Revoking consent cascades the binding.
- Resident payment setup page under `/app/homeowner/billing`, explicit checkbox and exact visit prices. Retry verification without reconfirming an already successful SetupIntent; show saved brand/last4 on refresh.
- Sandbox payment identity snapshots, immutable visit/amount/payer fields, no deletion, prepare-before-confirm recovery and completion/outbox integration. Experimental charge execution remains disabled and has not been tested against the real sandbox.
- Provider sandbox Express onboarding and authoritative status refresh. Sandbox status is separate from the existing payout status to avoid representing test onboarding as live activation.

Configuration (no values in source):
- `STRIPE_SECRET_KEY`: sandbox key only (`sk_test_` or scoped `rk_test_`).
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`: sandbox `pk_test_` only.
- `STRIPE_TEST_CARD_SETUP=1`: enables resident test setup; leave unset outside isolated tests.
- `STRIPE_TEST_PAYMENTS=1`: experimental charge worker; leave unset until the remaining acceptance gates pass.
- `STRIPE_TEST_CONNECT=1`: enables provider test onboarding.
- `STRIPE_TEST_APP_URL`: trusted HTTPS Preview origin, or loopback HTTP for local tests. Never derived from a request Host header.
- `STRIPE_TEST_WEBHOOK_INTAKE=1`: intake only, not payment execution. Leave off until processor exists.
- `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET`: distinct sandbox destination signatures.

Remaining acceptance gates:
1. Integrate provider-backed enrollment cap (#49), saving the card at join and binding final charges to accepted prices.
2. Application award payout gate implemented: optional HOA awards with sandbox payments enabled perform a fresh owned Stripe account read and lock/recheck that same active provider/account inside the award transaction. Direct SQL callers are not globally gated by an application environment flag; persisted request billing policy remains part of enrollment integration.
3. Verify durable Payment/operation records and completion outbox against real Stripe. Persistent intent identity and mocked remote-success recovery are implemented; failed-payment retry with a replacement card and notifications remain. USD allocations below 50 cents stop for billing review rather than overcharging.
4. Implement provider transfers after success and failed/action-required resident notifications/recovery. Core charges only completed eligible visits, with signed-event/pending reconciliation; transfers/refunds/disputes are not implemented.
5. Admin refund and matching transfer reversal, audit/history/earnings and notifications; integrate HOA share (#44), claims (#50), monthly billing (#56).
6. Real sandbox full-flow verification, including concurrent retries, minimum not reached, authorization, refunds and webhook delivery. Shared database migrations and production activation are separate from local tests.

Validation: focused unit/UI tests, isolated PostgreSQL consent/allocation/card tests, TypeScript and direct `next build` (never `npm run build` for local verification because that applies migrations). `tests/postgres/stripe-billing.config.mts` accepts only the explicitly named loopback disposable test target. No production database or real-money operations used.

Latest charge-engine checks: 33 real PostgreSQL tests (including actual completion with private-photo fixture, single outbox intent, concurrent preparation, immutable payment identity and card retry timestamps). Full unit run had the four known neighborhood reconciliation failures plus one static API-contract failure; the latter was fixed and its 28-test suite passes. Source typecheck passes. No test key or real Stripe call used.

Reconciliation is bounded to three events plus three pending payments per drain; sandbox failures are reported without failing unrelated notification delivery. Outbox delivered means command handled, never proof of payment. Test Connect calls use bounded network timeouts.

Sandbox transfer milestone: `transferStripeTestPayment` checks the paid, unrefunded, undisputed source charge and current owning provider/Stripe account, sends only the frozen provider share, and stores a durable attempt timestamp before the network operation. Retries reuse one transfer key and stop for manual reconciliation after 23 hours instead of risking a duplicate after idempotency expiry. Transfer IDs and attempt times cannot be overwritten. Ten focused tests and PostgreSQL immutability checks pass.

This helper is deliberately NOT wired to scheduled processing. Before activation it must check unresolved service-quality claims under the same visit lock, implement refund/reversal recovery, and pass real sandbox verification. Issue #50's 72-hour rule is a reporting window; its default extra transfer hold is none. No blanket 72-hour payment hold is implied.

## Resumed team verification

Remote PR head `3e47b3e5cf956d0ff2922e16fa208af1d447058c` was recovered into an isolated checkout after the previous temporary checkout disappeared. GitHub reports the PR open and draft, with Vercel success at that head.

Vercel metadata confirms `STRIPE_SECRET_KEY` is configured for Preview and Development and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` for Preview/Development. Values were not retrieved or printed; key validity has not been proved with Stripe. Neither webhook signing variable appeared in the metadata. The earlier request for API keys is therefore no longer the current prerequisite; engineering must configure and verify sandbox webhooks and full flow.

Current bounded milestone: enforce active, freshly verified sandbox provider payouts at the application award entry point, with a transaction recheck against account replacement or suspension. Independent implementation, verification and review ownership assigned. Transfers remain unwired.

Independent source review approved the bounded award gate. Direct Next production build passed without applying shared migrations. The PostgreSQL assertion migration is for the owned synthetic test database only; no production or shared Preview schema was changed. Preview key presence is confirmed, not live sandbox completion. Next implementation work remains card-at-join/price-cap integration and refund/reversal recovery before transfer activation.

Final award-gate verification: 145 unique focused tests across 15 files, 36 real PostgreSQL tests, TypeScript, direct Next build and diff whitespace checks passed. Race tests observe the exact mutator PID blocking the assertion before releasing the lock, then verify rejection and transaction rollback. Reviewer found no implementation blocker. Existing synthetic schema has no Prisma migration history, so only the reviewed new function SQL was applied there; no history baseline or shared migration was performed.

## Payment recovery milestone

Implemented original-payer-only payment recovery at `/app/homeowner/billing/payments/[visitId]`: review authoritative status, complete bank authentication, or explicitly authorize a replacement test card for the frozen completed-visit amount. Immutable sequential recovery attempts preserve original customer/payment identity; replacement confirmation always targets the existing PaymentIntent. The attempt is persisted before confirmation, has a constrained terms version and post-lock acceptance time, and cannot reference another payment. Lost responses retry the same attempt and intent. Failed attempts do not automatically reconfirm indefinitely.

Declines and authentication-required outcomes persist rather than rolling back on Stripe card errors. Original payer and active administrators receive deduplicated transactional alerts pointing to the configured sandbox origin, with no processor secrets/errors in messages. This remains sandbox-only and does not activate transfers.

Independent source review approved after sequence/timestamp and foreign-attempt corrections. Verification: 215 affected unit/UI/API tests, 39 real PostgreSQL tests, TypeScript and direct Next build pass. Recovery UI covers explicit exact-amount consent, retry without repeating SetupIntent confirmation and bank authentication. Route tests cover auth, required acceptance, ownership input rejection, no-store and sanitized errors. SQL applied only to owned synthetic cards2 database. No real Stripe call or shared migration.

Next: integrate the reviewed price-ladder allocation branch `codex/issue-43-enrollment-integration`, then implement request-scoped card-at-enrollment consent and its cap-bound award binding. Refund/reversal recovery and claim holds still block transfer activation; full real sandbox testing remains mandatory.

Combined pricing/recovery verification is now clean: 2,627 full unit tests, 46 real PostgreSQL tests, TypeScript and direct build pass; 45 migrations verified on synthetic integration DB. Reviewed price-ladder full-term allocations and baseline fixture repairs are integrated. See ISSUE_43_INTEGRATION.md for current ownership and card-at-enrollment acceptance plan. Issue remains incomplete; no merge to main or production activation.
