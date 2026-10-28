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
