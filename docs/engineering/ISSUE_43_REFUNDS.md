# Issue 43 sandbox refund milestone

Stage: reviewed implementation; isolated verification passed; integration into PR #73 pending.
Branch: codex/issue-43-refund-recovery, based on cd1b86d.
Owner: engineering manager. Enrollment remains owned separately in codex/issue-43-stripe-payments.

## Acceptance and implementation

- Verified primary administrator reserves a refund against a frozen paid visit balance with immutable identity and explicit confirmation.
- Concurrent reservations serialize; only one unfinished refund exists per visit. Audit and reservation commit together.
- Processor operations have stable identifiers, durable first-attempt clocks, owned metadata recovery, and a conservative 23-hour uncertainty cutoff. No blind recreation after uncertain old attempts.
- Successful resident refunds remain recorded even if the matching proportional provider reversal fails. Reconciliation retries the reversal without issuing another refund.
- Cumulative integer allocation conserves provider cents across partial refunds. Existing transfer helper refuses sending funds after a refund reservation.
- Admin status UI and API distinguish pending from complete and reuse the original operation after network uncertainty.
- Feature remains disabled unless STRIPE_TEST_REFUNDS=1 with a test API key. No production funds or shared database changed.

## Evidence

- Independent source, SQL, API, UI and test review approved this scoped milestone.
- 2675 unit/component/API tests passed across 159 files.
- 50 real PostgreSQL tests passed, including concurrent reservations, current owner verification on replay, immutable ledger/attempt clocks, direct SQL snapshot rejection and prior billing/pricing regressions.
- TypeScript and direct Next production build passed (no migration or deployment).
- Reviewed 46-migration chain applied only to newly created owned local database bundleen_issue43_test_refunds on loopback port 53952. Synthetic data only.

## Remaining gates and next action

Commit this isolated slice, then integrate with independently verified enrollment into PR #73 and repeat combined schema/type/test checks. Actual Stripe sandbox end-to-end refund/reversal tests, authenticated browser checks and remaining payment/guarantee integration remain required; this milestone does not resolve issue 43. Unknown external refunds, disputed charges, incomplete processor history or old uncertain attempts fail closed and require reconciliation; a new dispute can also prevent automatic recovery of an already successful owned refund.

No additional user prerequisite is needed for this local implementation stage. SMS #53 and Flutter PR #42 remain parked under explicit user instruction.
