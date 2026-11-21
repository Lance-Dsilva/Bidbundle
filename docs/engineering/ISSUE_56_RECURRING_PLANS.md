# Issue 56 — recurring plans

Active implementation branch `codex/issue-56-recurring-plans`, isolated clone `/private/tmp/bundleen-recurring-plans`, base `3a49ee1`. Source issue: https://github.com/Lance-Dsilva/Bidbundle/issues/56 (P1, no existing assignee/comments when selected). This is not a completed issue or a release.

## Approved design

Keep existing finite requests, visits and consent unchanged. A separate open-ended plan references the awarded agreement as its provider/scope template; manager proposes explicit new monthly price, cadence and frozen HOA IANA timezone, and provider must accept. Plan coverage begins strictly after existing finite occurrence coverage. Existing real occurrences/visits gain immutable recurring source references; no historical relabeling. Active open plans prevent finite agreement completion from silently stopping future service.

A subscription freezes original resident, unit and membership and accepts a distinct recurring monthly-cap consent, with a separately verified off-session card. Finite consent never authorizes recurring charges. Pause/cancel/provider end uses 30 local calendar days' notice; resume requires a new subscription and fresh consent. Dates and billing month are HOA-local calendar dates, not UTC completion timestamps.

Generate each plan's service dates from a frozen local-date anchor/cadence. Assign exact monthly price cents across all planned dates for that month, remainder cents to earliest dates. A later skip/cancellation removes its allocated cents and never redistributes them to remaining visits. A monthly bill may seal only after local month-end when every constituent visit is terminal; late completion before sealing remains in its original service period. After sealing, constituents/status/amount are immutable.

A distinct monthly bill/payment identity and immutable real-visit constituent ledger must prevent all legacy per-visit charges. Keys include plan, subscription, unit and month (unit/month alone collides). Monthly refunds/claims must reference their line allocation; aggregate provider/HOA rounding and financial observations must use the real aggregate payment, never synthetic paid visit rows. Existing fee-funded HOA and provider 90% guarantees remain.

## Work sequence / gates

1. Plan/subscription consent, notices, timezone calendar, guarded repeatable visit generation and sealed constituent model. Feature flag off by default; block recurring financial dispatch until adapter is complete.
2. Separate monthly and per-visit recurring payment adapter, durable PI/transfer identity, card recovery, line-scoped refunds/claims, aggregate HOA accounting and reconciliation.
3. Resident/HOA/provider controls, monthly jobs, annual re-bid reminders and scoped histories.
4. Independent unit/real PostgreSQL concurrency tests, full suite/type/build/review, then manager PR handoff. Sandbox end-to-end and release approvals remain separate gates.

No shared database migration, Stripe mutation, push, merge or deployment is authorized to this implementation child. Parent owns integration and external operations. Reviewer approved reusing ServiceVisit only with exact immutable recurring binding and narrowly guarded finite exclusions. Foundation alone does not satisfy acceptance.

## Foundation checkpoint

Draft schema/domain/calendar/job code is implemented; no remote Stripe calls occurred. Safe discovery/action DTOs are provided for the manager's separately owned UI. Recurring visits are rejected by both the legacy completion outbox builder and database payment/outbox guards. New subscriptions use separate off-session SetupIntent metadata and immutable original payer/card/receipt snapshots. Monthly bills seal every real terminal constituent, including zero-charge skipped/cancelled rows.

Focused calendar tests exercise exact cents, full-month denominator, 30 local calendar days, leap/year boundaries and DST noon/billing-boundary conversion. Independent lifecycle/card tests are in `tests/recurring-plan-independent.test.ts`. Final foundation verification passed 2,953 unit tests across 181 files, typecheck and diff checks. Independent PostgreSQL verification passed 4/4 cases across the 58-migration owned chain, including exact 8,001-cent sealed billing, history-preserving pause/resume, and future/initially-closed occurrence rejection. Temporary fixture helpers were removed (zero functions/tables/triggers remain). These are foundation checks, not live payment or release evidence.

09000 was applied only to the owned issue56 test database; its preserved SHA256 is `13d81f56951481f847dad88c06fc10cca91e1604bc4db61c8cb91979264090fe`. Independent PostgreSQL testing found an invalid interval literal during visit generation. Additive 10000 replaces that function with the corrected interval and also closes provider-ended subscriptions and blocks future/after-notice completion. 10000–12000 were reviewed and applied only to the owned test database. 11000 preserves canceled subscription history with separate active-visit uniqueness; 12000 serializes occurrence closing against generation and rereads occurrence state after the agreement lock. Do not edit applied migration history. Reviewer reports no remaining foundation source/SQL blockers. Parent owns combined UI build and integration; the next implementation step is the financial adapter.

## Approved financial continuation

After the reviewed foundation commit, implement `RecurringCharge` with exactly one monthly-bill or completed per-visit source. Freeze constituent identity, original payer/customer/card/receipt, provider/account, amount/currency, platform fee and fee-funded HOA share. Unique visit ownership prevents both monthly/per-visit duplication and aliasing into the old finite payment ledger.

Persist the PI before confirmation and use stable create/confirm identities. Fresh retrieval reconciles known succeeded/processing/action-required outcomes before retry. Distinct, immutable refund operations allocate only within the affected constituent's remaining gross and provider/HOA entitlements. Aggregate webhook observations attach to the aggregate charge, with financial holds for unknown/disputed adjustments. HOA accrual has exactly one earned source per aggregate charge and cumulative reversals; provider entitlement retains the 90% guarantee. No monthly financial dispatch is enabled until this full adapter and its claim/refund/reconciliation paths pass review and tests.
