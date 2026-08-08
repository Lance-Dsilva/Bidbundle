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
