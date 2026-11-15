# Issue 49: provider-backed price ladder

Status: implementation in progress; not ready to merge or resolve.

The owner chose enrollment only after a provider commits to a maximum price that can fall as more homes join. Prices in this implementation are integer cents per home for the complete service term, not per visit. The eventual agreement total is the per-home amount multiplied by the locked enrolled homes. Stripe must allocate that exact total across visits without a second occurrence multiplier.

## Implemented foundation

- Strict ordered price tiers, beginning at one home so every enrollment has a backed maximum.
- Threshold progress and exact remaining home counts.
- Award calculation honors the lowest enrolled price cap even after neighbors withdraw. Provider commitment must explicitly cover this ratchet before this helper is used in production.
- Accessible reusable ladder presentation and stable outbox dedupe keys.
- 15 focused domain/UI tests and TypeScript pass.

The component is not yet mounted: showing an unenforced price promise would be misleading.

## Next implementation gates

1. Add ServiceBid tier rows and a single immutable selected provider commitment per request, with provider/authorized admin entry and audit. Existing SQL guards reject bids before participant lock and all per-home awards. Add a narrowly scoped ladder lifecycle without weakening legacy whole-job/pool guards.
2. Require provider commitment before optional ladder enrollment, store each household's join-time maximum under the request lock, and prevent commitment changes or withdrawal once enrollment begins. Preserve lower unlocked prices on opt-out.
3. Resolve the immutable reached price during audience close/award, snapshot exact per-home amount and total, and integrate with issue 43 allocation and explicit payer consent.
4. Mount ladder on request cards/HOA dashboard and issue 48 share page, sourcing only the selected persisted commitment. Add provider/admin form and authorized endpoints.
5. Enqueue each tier unlock once per commitment/tier/recipient in the enrollment transaction; verify concurrent join, leave/rejoin, and retry behavior on disposable PostgreSQL.
6. Run real signed-in preview and sandbox charging checks. The shared database has not been migrated and no release was deployed.
