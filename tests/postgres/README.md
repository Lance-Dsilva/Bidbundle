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
