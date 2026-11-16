# Issue 49: provider-backed price ladder

Status: draft, active implementation. Not resolved or ready for release.

The owner chose enrollment only after a provider commits to a maximum price that can fall as more homes join. Tier prices are integer USD cents per home for the complete service term, not per visit. Agreement total is per-home amount multiplied by locked homes. Issue 43 must allocate this exact total across visits without a second occurrence multiplier.

## Implemented HOA pilot

- Primary admin enters a proposed immutable provider scope and tier rows before any participation. The registered provider must explicitly accept the full-term prices and retained-discount policy in My bids before enrollment opens.
- Provider identity, active profile and administrator identity are checked under row locks. Service term fields cannot change beneath the promise.
- Database enrollment cap and downward-only group guarantee preserve the lower price after withdrawals. The provider explicitly agrees to this before enrollment.
- Enrollment close materializes a per_home ServiceBid with tier rows and exact full-term total. Award guards permit only that committed provider/price and preserve the existing credential gate.
- Resident and HOA manager request cards show count, tiers, unlock progress and protected price. Pending proposals cannot be joined.
- Enrollment transaction queues per-tier/per-recipient deduplicated in-app/email intents, respecting email preference.
- Admin pilot uses actual request/provider choices. No production data or keys used.

## Verification

- 51 focused domain/UI/read/form tests passed; TypeScript passed.
- Full unit suite: 2465 passed; four unchanged neighborhood-reconciliation baseline failures.
- All 35 migrations applied from scratch to dedicated loopback issue49_test_v3. Three real PostgreSQL tests passed: exact-provider acceptance; caps/withdrawals/deduplicated notices; locked full-term bid; immutable service terms and tiers.
- Initial build blocked by sandbox Google Font DNS; network-enabled build being checked.
- Independent reviewer found mutable request terms; fixed and added real-database regression.

## Remaining code and completion gates

- Extend provider-authored pricing beyond admin-entered HOA pilot proposals, and neighborhood creation/enrollment (existing neighborhood creator auto-enrollment precedes a provider commitment).
- Issue 48 public share integration consumes accepted commitment tiers/count/guaranteed price only, not private metadata.
- Current-head end-to-end award with credential fixture and issue 43 signed-in sandbox charge verification; concurrency/authority negative tests and live UI check.
- Reconcile integration with PRs 71–73: schema additions and hoa-market award sections overlap. Migration replaces the older bid-mutation function; preserve newer guards while integrating.
- No shared database migration, merge or deployment performed. Keep issue open until all acceptance gates pass.
