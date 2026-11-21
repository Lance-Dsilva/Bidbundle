# Issue 44: association revenue share

Stage: combined backend, UI/API/export and database implementation reviewed and locally verified; draft PR #78 published: https://github.com/Lance-Dsilva/Bidbundle/pull/78. Branch `codex/issue-44-hoa-share`, based on `85d7e170a96a45af30b4fd292ffa901daf9b4bf8` (PR73). Backend commit `e36e053` and UI commit `c34a529` are integrated at `02de030`. Issue remains open; no production deployment or live Stripe call occurred.

## Acceptance and implementation

- Default community share is zero. An authorized owner can explicitly configure a pilot at 500 bps; the rate cannot exceed the platform fee or 1,000 bps. New payments freeze the original rate, fee-funded share and verified enrollment-cap savings. Provider proceeds remain gross minus the original platform fee. Historical zero-share payments are not retrofitted.
- Completed, paid resident jobs create immutable earned entries. Cumulative refund adjustment uses `share - floor(share * refunded / gross)`, with the greater of owned and observed refunded balances. Holds prevent payout even after accrual. A paid association distribution is not recalled automatically: later negative adjustments carry forward against future earnings exactly once.
- Monthly statements freeze complete period totals and opening/closing balances. Export reads all rows (rejects more than 10,000 rather than truncating), exposes no resident or payment identifiers, and rechecks scoped authority.
- Manual distributions require an active, verified, nonstaff owner and immutable reference. Stripe sandbox distributions retain original account, amount, statement and idempotency identity; remote recovery precedes new dispatch checks. Unknown remote outcomes older than 23 hours fail closed rather than recreate. Transfers use `hoa_<communityId>_<YYYY-MM>`.
- Community locks serialize payment/refund/claim changes and HOA payout reservation/dispatch. Database guards freeze financial identities, calculate ledger totals, enforce source binding and server timestamps, and reject unauthorised/manual-held transitions.
- Authorized HOA managers and owners can start/refresh Express test onboarding. Return links lead to their authenticated workspace; status requires fresh account identity/capabilities, never redirect success alone.
- The monthly job has a durable, locked scan cursor (100 communities per batch). It retries older pending payouts before current-month payouts, rotating up to 20 old attempts per community so a blocked attempt cannot monopolize every run.

## Configuration and release gates

- `HOA_REVENUE_SHARE=1` enables configuration, payout actions, UI and monthly processing. Persisted nonzero community rates still govern new payment snapshots if the display/job flag is later disabled; turning off future participation requires an audited rate change to zero.
- Sandbox remote operations also require `STRIPE_TEST_PAYMENTS=1`, a valid test-only Stripe key and configured `STRIPE_TEST_APP_URL`.
- Automatic monthly payout is disabled unless `HOA_SHARE_PAYOUT_ACTOR_ID` names an existing verified nonstaff owner; authority is rechecked each time. No arbitrary administrator is selected. Manual payment remains available within the enabled module.
- Real sandbox Connect/onboarding/transfer validation and actual account configuration remain external release gates; local tests do not establish live delivery. Shared or production migrations have not been applied.

## Evidence

- Backend full unit suite: 2,898 passed across 176 files.
- New domain suite: 32 passed, including authorization, fee boundaries, negative liability, pending holds, identical replay, mismatched remote transfer, retention window, configured actor, cursor progression and old-month recovery.
- Two additional payment snapshot tests verify fee-funded 5% and invalid-rate rejection; receipt tests preserve original payer verification.
- TypeScript typecheck and `git diff --check` passed.
- Independent reviewer approved 07000 and additive 08000 for the explicitly owned synthetic database only. 07000 source checksum remains `73ba481624e96f863cb641dd79d2bcc9446eac546a602e58d7c69295f7f83a72`.
- Independent PostgreSQL verification: 54 migrations applied from scratch to the exclusively owned `bundleen_issue44_test_share`, then 9/9 tests passed. Cases cover audited rates and immutable snapshots; completed/paid accrual and forged entry rejection; cumulative refund rounding; scoped reads; concurrent statement/manual-payment idempotency and negative carry; observed claim-first payout lock; observed refund-first payout lock; current owner/hold/attempt-clock enforcement; forged savings/provider rejection with valid completed-visit controls and specific SQL errors; duplicate zero-delta ledger insertion rejection (not isolated ledger-kind proof). Historical test clock helpers were constrained to exact synthetic fixture IDs and restored.
- A PL/pgSQL CASE-expression syntax error in the initially attempted 08000 was corrected; the owned database was recreated and the entire 54-migration chain rerun successfully. No shared migration history was changed.

Combined evidence: 2,922 unit/component/API tests across 179 files passed, strengthened 9/9 PostgreSQL tests passed, TypeScript and independent combined source review passed. Direct Next production build passed; both statement routes trace the required licensed Unicode fonts. The initial sandbox build could not resolve fonts.googleapis.com; the network-enabled build passed without source changes. No migration script or deployment was run.

Published implementation head: c29da6e9cf981c337422da0c73d6038e8890216d. Current-head Vercel check pending at handoff. PR78 is stacked on PR73. Next: inspect CI and review feedback; Park external sandbox Connect/onboarding/transfer and signed-in browser verification until the usable test key/webhook prerequisite is supplied. Engineering owns final verification and dependency integration; user owns secret provisioning outside chat. Do not close #44 or merge before those release gates and PR73 dependency are satisfied. Continue independent backlog issues while parked.
