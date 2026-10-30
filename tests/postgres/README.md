# Isolated PostgreSQL bid confirmation verification

This suite uses the generated Prisma client, PostgreSQL adapter, full migrated
schema, and actual `awardBid`, `submitBid`, and `withdrawBid` functions. It does
not mock business rules or database results. An async-context test injection
selects one of two independent real Prisma clients; query-extension barriers
pause only after actual reads to arrange deterministic interleavings.

The late-failure case deliberately creates a physically valid but
domain-inconsistent agreement pointing to another still-submitted bid. This
is fault injection, not a legitimate competing award. A pass-through observer
on the real PostgreSQL driver verifies the selected bid claim affected one row
before PostgreSQL rejected `ServiceAgreement_requestId_key`; the transaction
then restores both bid statuses and leaves no audit or notification effects.
Only operation counts and raw error table/constraint identifiers are reported.

Supply `TEST_DATABASE_URL` explicitly for a **disposable loopback** database named
`bundleen_issue18_test` (or that name with a unique suffix), then run:

```sh
npx vitest run --config tests/postgres/vitest.config.mts
```

The URL must remain in the environment or an external private runner. Never
commit it or a local environment file. The suite neither loads `.env` files nor
runs migrations. Apply the branch's migrations to the identified disposable
database separately. This configuration deliberately does not change the normal
integration suite or pretend Redis resources exist.

Only uniquely named test fixtures are created. They remain in this disposable
database because audit records are append-only; the database/container owner
must destroy that test resource afterwards. No table is truncated and no audit
trigger is disabled. Do not target development or production.

The suite proves the observed domain and SQL behavior for these controlled
interleavings, not exhaustive concurrency correctness or deployed authentication.
It does not perform payment or email delivery. The file suffix `.postgres.ts`
keeps this suite outside routine unit-test discovery.

## Owner request controls (issue #10)

For owner edit/cancel verification, explicitly supply a disposable **loopback**
PostgreSQL database named `bundleen_issue10_test` (or a unique suffix), apply all
branch migrations including `20261028150000_neighborhood_request_creators`, and run:

```sh
npx vitest run --config tests/postgres/owner-request.config.mts
```

This separate configuration refuses remote or differently named databases and
loads no environment files. The suite uses real domain functions, authorization,
Prisma transactions and persisted audit/notification/outbox rows, with two real
clients and barriers around actual reads or immediately before a conditional
claim. It verifies owner changes versus bidding and publication in both
orderings, competing edits, authority revocation, draft privacy, and database
creator constraints without relaxing the HOA survey rules.

One controlled fault-injection test adds a uniquely named audit INSERT trigger
limited to one owned request. A pass-through driver observer records a successful
request UPDATE before PostgreSQL raises the deliberately injected check violation;
the transaction must restore the request and leave no audit or notification effects.
The test removes only its own trigger/function in `finally`. Existing validation
and append-only audit triggers remain enabled. This is a rollback probe, not a
normal business event. Fixtures remain in the disposable database until its owner
destroys it; no shared tables are truncated. No live Clerk, Redis, email delivery,
production deployment or exhaustive interleaving coverage is implied.

## Open-bidding awards (issue #17)

Supply an explicitly identified disposable **loopback** PostgreSQL database
named `bundleen_issue17_test` (or that name with a unique suffix), apply the
branch's complete migration chain including
`20261028190000_early_award_bid_and_visit_guards` separately, and run:

```sh
npx vitest run --config tests/postgres/early-award.config.mts
```

The configuration and suite both refuse remote or differently named databases.
They load no environment files, select no fallback database, perform no
migrations, and remain outside ordinary unit discovery. Credentials belong in
the environment or an external private runner, never committed files or output.
Only unique owned fixtures are inserted; audit records remain append-only and
the resource owner removes the disposable database after verification.

The initial baseline uses actual open-bidding, quote submission, manual closing,
and award domain operations. A successful closed HOA award is the control;
open HOA and closed neighbourhood awards express the expected product behavior.
Neighbourhood participants are active homeowners with address coordinates and
no HOA unit. The database client substitution only chooses an actual Prisma
client per async context; SQL, authorization, transaction results and constraints
remain real. The driver observer records only SQLSTATE and constraint names.

The final matrix covers open and closed HOA/neighbourhood awards, compulsory
unit snapshots and recurrence materialization, deadline/version/provider guards,
authority and tenant denials, both orderings of quote revisions/withdrawals,
first bids/resubmissions, close/cancel, and competing awards. It checks that
late bids leave no manager notifications/outbox rows, new losing bids invalidate
a prepared audience, independent providers can both quote, and ignored inserts
or no-op updates do not manufacture parent snapshot changes. Visit identity and
physical snapshot constraints remain enabled.

Two timing cases hold a selected provider profile row with a second real
transaction. Read-only `pg_stat_activity`/`pg_blocking_pids` inspection proves
the actual bid UPDATE or INSERT is waiting on that lock; the database clock
must confirm release occurs after quote validity or the bidding deadline.
Both operations must then refuse and leave no partial award or late bid/intents.
The bounded fixture transactions always release their own locks in `finally`.

One approved fault probe adds a uniquely named audit INSERT trigger restricted
to one owned community and the award action. This deliberately injected fault is
not a normal business event. A pass-through driver observer must show successful
parent award and accepted-bid updates before the controlled PostgreSQL error;
the request/deadline, bids, agreement, occurrences, visits, audit and notification
outbox must then roll back. `finally` drops only that probe's trigger/function.
No existing trigger is disabled. This is controlled interleaving evidence, not
exhaustive concurrency verification or proof of deployed Clerk/Redis, email or
payment delivery, or a production migration.

# Isolated PostgreSQL community interest verification

Explicitly supply `TEST_DATABASE_URL` for a disposable **loopback** PostgreSQL
database named `bundleen_issue4_test` (or a unique suffix). Apply the full branch
migration chain, including `20261028170000_community_interest`, then run:

```sh
npx vitest run --config tests/postgres/community-interest.config.mts
```

The configuration refuses other database names and remote targets. It loads no
environment files and never applies migrations. Credentials belong only in the
environment or an external private runner, never tracked files or command output.

Tests use actual Prisma clients, full-schema PostgreSQL and the real submission,
deduplication and list functions. Two independent clients submit concurrently.
The public route uses its actual validation/persistence/receipt path; only its
external Redis guard is substituted, independently covered by unit tests.

One fault-injection test adds a uniquely named trigger scoped to an owned
synthetic email to force an existing owned lead ID. Real PostgreSQL must reject
that unrelated primary-key collision, and the application must return failure,
not a blind success receipt. The test removes only its own trigger/function in
`finally`; existing constraints remain enabled. This is a controlled rollback/error
probe, not a legitimate business workflow.

Fixtures remain in the disposable database until its owner destroys it. No shared
tables are truncated. These tests do not contact Redis, Clerk, email services or
production, and do not claim deployed integration or exhaustive race coverage.
