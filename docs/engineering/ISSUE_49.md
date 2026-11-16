# Issue 49: provider-backed price ladder

Status: draft; implementation and local verification complete for the administrator-nominated provider pilot. Not resolved; public-share/payment integration and live acceptance gates remain.

The owner chose enrollment only after a provider commits to a maximum price that can fall as more homes join. Tier prices are integer USD cents per home for the complete service term, not per visit. Agreement total is per-home amount multiplied by locked homes. Issue 43 must allocate this exact total across visits without a second occurrence multiplier.

## Implemented pricing flow

- Primary admin nominates a provider and proposed immutable scope before any participation. The named provider can author final validated tiers. The registered provider must explicitly accept the full-term prices and retained-discount policy in My bids before enrollment opens.
- Provider identity, active profile and administrator identity are checked under row locks. Service term fields cannot change beneath the promise.
- Database enrollment cap and downward-only group guarantee preserve the lower price after withdrawals. The provider explicitly agrees to this before enrollment.
- Enrollment close materializes a per_home ServiceBid with tier rows and exact full-term total. Award guards permit only that committed provider/price and preserve the existing credential gate.
- Resident, neighborhood and HOA manager request cards show count, tiers, unlock progress and protected price. Visible resident/neighborhood enrollment views refresh counts every 15 seconds without resetting form state. Pending proposals cannot be joined.
- Enrollment transaction queues per-tier/per-recipient deduplicated in-app/email intents, respecting email preference.
- Admin pilot uses actual request/provider choices. No production data or keys used.

## Verification

- Focused domain/UI/read/form tests passed; TypeScript passed.
- Full unit suite: 2468 passed; four unchanged neighborhood-reconciliation baseline failures.
- All 35 migrations applied from scratch to dedicated loopback issue49_test_v5. Seven real PostgreSQL tests passed: exact-provider acceptance; caps/withdrawals/deduplicated notices; locked full-term bid; immutable service terms and tiers.
- Network-enabled direct Next build passed (no migrations). The final neighborhood/provider extension also built successfully.
- Independent reviewer found mutable request terms; fixed and added real-database regression.

## Remaining code and completion gates

- Neighborhood requests can opt in at creation; no creator auto-enrollment occurs before accepted pricing. Existing quote-first requests retain their behavior.
- Public share integration lives in issue 48; its PR stacks on this branch.
- Issue 48 public share integration consumes accepted commitment tiers/count/guaranteed price only, not private metadata.
- Actual credential-backed award, provider-authored immutable tiers, and neighborhood owner enrollment verified on local PostgreSQL. Remaining end-to-end gates: issue 43 sandbox charge verification and signed-in live UI.
- Named providers author and accept tiers in My bids. Administrator nomination remains the pilot selection workflow.
- Reconcile integration with PRs 71–73: schema additions and hoa-market award sections overlap. Migration replaces the older bid-mutation function; preserve newer guards while integrating.
- No shared database migration, merge or deployment performed. Keep issue open until all acceptance gates pass.
