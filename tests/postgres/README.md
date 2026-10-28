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
