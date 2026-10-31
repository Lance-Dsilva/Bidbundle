# Integration tests

These talk to **real** cloud resources and are excluded from `npm test` so an
ordinary run never spends Upstash quota or needs a database.

```bash
npm run test:integration
```

## Prerequisites

Create `.env.test.local` (git-ignored) with:

| Variable                   | What it must point at                                             |
| -------------------------- | ----------------------------------------------------------------- |
| `TEST_DATABASE_URL`        | An **isolated** Postgres database. Its `User` table is truncated.  |
| `UPSTASH_REDIS_REST_URL`   | The Development Upstash resource — never Production.               |
| `UPSTASH_REDIS_REST_TOKEN` | Matching token.                                                    |
| `RATE_LIMIT_IDENTIFIER_SECRET` | Random value used to salt rate-limit identifiers.             |

Apply the schema to the test database before the first run:

```bash
DIRECT_URL="$TEST_DATABASE_URL" npx prisma migrate deploy
```

## Safety

- `TEST_DATABASE_URL` must not be the development or production database — the
  suite deletes rows.
- Rate-limit tests use a unique random identifier per run, so they consume a
  handful of Upstash commands rather than exhausting a shared bucket.
- The integration command fails during configuration when any required variable
  is absent. It must never report success after silently skipping cloud tests.

## Disposable local provider credential concurrency verification

The separate `tests/postgres` suite runs actual provider and admin route handlers
against PostgreSQL. It is excluded from `npm test` and from the cloud suite above.
It accepts only an explicit `TEST_DATABASE_URL` whose host is loopback and whose
database is exactly `bundleen_issue1_test`; it does not load environment files or
fall back to application credentials. Provision this disposable database and
apply the repository migrations before running:

```bash
npx vitest run --config tests/postgres/config.mts
```

Supply `TEST_DATABASE_URL` privately in the command environment. Do not paste a
credential-bearing URL into logs. The configuration points the production lazy
database client at that same isolated target. The suite retains its uniquely
named fixture rows because real audit history is append-only; it never bypasses
audit triggers, deletes audit history, or truncates tables. Dispose of the entire
test database outside the suite when verification is complete. Never use
application data here.

Clerk session identity and remote limiter transport are stubbed. Database-backed
roles, active admin grants, provider guards, claim updates, staff verification,
transactions and audit records execute their production code against real SQL.
A pass-through query hook pauses a real credential read to establish a repeatable
interleaving; it never substitutes a query result or write. This establishes local
database race behavior, not live Clerk/Redis, deployment or browser correctness.
