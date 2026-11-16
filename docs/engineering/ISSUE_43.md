# Issue 43 — sandbox payments checkpoint

PR: https://github.com/Lance-Dsilva/Bidbundle/pull/73

This is incomplete, disabled-by-default work. It must not be represented as working payments or deployed with live keys.

Implemented:
- Immutable integer per-visit allocation and original payer snapshots at award.
- Exact-price, versioned resident consent with locked residency/completion rechecks.
- Signed test-only webhook intake with durable event deduplication; no payment processing yet.
- Sandbox Customer and card-only off-session SetupIntent, idempotent requests, exact consent metadata.
- Server-side verification and persistent card references, transactionally bound to extant consent/current payer. Revoking consent cascades the binding.
- Resident payment setup page under `/app/homeowner/billing`, explicit checkbox and exact visit prices. Retry verification without reconfirming an already successful SetupIntent; show saved brand/last4 on refresh.
- Provider sandbox Express onboarding and authoritative status refresh. Sandbox status is separate from the existing payout status to avoid representing test onboarding as live activation.

Configuration (no values in source):
- `STRIPE_SECRET_KEY`: sandbox key only (`sk_test_` or scoped `rk_test_`).
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`: sandbox `pk_test_` only.
- `STRIPE_TEST_CARD_SETUP=1`: enables resident test setup; leave unset outside isolated tests.
- `STRIPE_TEST_CONNECT=1`: enables provider test onboarding.
- `STRIPE_TEST_APP_URL`: trusted HTTPS Preview origin, or loopback HTTP for local tests. Never derived from a request Host header.
- `STRIPE_TEST_WEBHOOK_INTAKE=1`: intake only, not payment execution. Leave off until processor exists.
- `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET`: distinct sandbox destination signatures.

Remaining acceptance gates:
1. Integrate provider-backed enrollment cap (#49), saving the card at join and binding final charges to accepted prices.
2. Award gate using verified active sandbox payouts; do not infer activation from onboarding redirect.
3. Durable Payment/operation records; transactional completion outbox; exactly-once economic effects through persistent operation identity and Stripe idempotency/recovery.
4. Process signed events, charge only completed eligible visits, transfer 90% after success, handle failed/action-required payments without transfers.
5. Admin refund and matching transfer reversal, audit/history/earnings and notifications; integrate HOA share (#44), claims (#50), monthly billing (#56).
6. Real sandbox full-flow verification, including concurrent retries, minimum not reached, authorization, refunds and webhook delivery. Shared database migrations and production activation are separate from local tests.

Validation: focused unit/UI tests, isolated PostgreSQL consent/allocation/card tests, TypeScript and direct `next build` (never `npm run build` for local verification because that applies migrations). `tests/postgres/stripe-billing.config.mts` accepts only the explicitly named loopback disposable test target. No production database or real-money operations used.
