# Stripe and price-ladder integration checkpoint

Goal: finish all actionable web issues through independent verification and authorized merges. Flutter #42 and SMS #53 remain parked by the owner. No issue is resolved by this checkpoint.

Integration branch: `codex/issue-43-enrollment-integration`, based on PR73 `af18076` and existing PR74 provider-backed pricing. Root owns this integration checkout. Payment recovery is separately owned in the PR73 checkout and must be integrated after its review; do not overwrite it.

## Completed integration slice

- Preserved Stripe and price-ladder schema models during merge.
- Fixed committed `per_home` ladder awards producing null visit allocations: validate accepted commitment/provider/currency/full-term amount and locked household total, then allocate the full term across visits without multiplying it again.
- Preserved original payer snapshots and flags-off/compulsory behavior.
- 49 focused tests and TypeScript passed. Fresh synthetic local database accepted the entire combined migration chain; 43 PostgreSQL tests passed, including actual credential-backed ladder award, per-home/whole-agreement conservation and original payer identity.
- Full unit suite: 2553 passed, four previously documented neighborhood reconciliation fixture failures. Do not report a clean full suite. PR71 contains fixture updates to reconcile during combined integration.
- Independent source review approved allocation fix. Direct Next production build passed without migration.

## Next required integration

Add immutable request-scoped enrollment consent/card binding: exact payer/unit/provider commitment, USD maximum full-term cents, service terms, consent version/hash and original timestamps. Verify Stripe SetupIntent ownership before atomic join. Under request and authority locks recheck deadline, capacity and current resident/unit before joining; withdrawing invalidates the binding, rejoin requires explicit consent.

At award check every locked household's final amount against its accepted cap and materialize billing authorization from the original enrollment record, never fabricate postaward consent. The billing engine must distinguish capped enrollment authorization from existing exact-price agreement consent. Preserve original verified timestamps and allocate discounted full-term price across visits.

Verify setup/join/close/capacity and residence races, price drops during setup, minimum-not-met no charge, withdrawal/rejoin stale setup, exact sum/remainder and unchanged neighborhood/compulsory behavior. Payment recovery, claim holds, refunds/reversals, HOA share and monthly billing remain unfinished. Real Stripe sandbox verification and authenticated browser flows remain required before merge.

## External configuration

Preview Stripe API variables exist (metadata only verified). Sandbox webhook signing variables still need engineering setup. No secrets are recorded here. No shared database migration, production deployment or live money operation occurred.

The four baseline failures were traced to incomplete approved-credential fixtures and different clocks in nested eligibility checks. Ported the minimal existing PR71 fixture fix (complete credentials and controlled clock), preserving all production code and denial assertions. Independent review approved; the entire 60-test reconciliation file now passes. Full combined suite will rerun after payment recovery integration.
