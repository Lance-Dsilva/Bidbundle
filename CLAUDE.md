# Bundleen (Bidbundle) — instructions for Claude

Bundleen is an HOA resident-savings marketplace: HOA managers open requests,
verified providers bid, residents join and pay after each visit.
Stack: Next.js 15 (App Router) · React 18 · Prisma 7 + PostgreSQL · Clerk auth ·
Upstash (Redis, QStash) · Vercel + Vercel Blob · Tailwind · Vitest.

## Danger zones (read first)

- **Merging to `main` deploys to production (bundleen.com).** The production build
  runs `prisma migrate deploy && next build`, so a merged migration is applied to the
  live database. Never merge, and never push to `main`. Work on a branch and open a PR.
- Preview deployments share the production-designated database and **skip** migrations
  (`scripts/vercel-build.sh`). A green Preview does not prove a migration is safe.
- Never run `prisma migrate deploy`, `prisma migrate reset`, `prisma db push`,
  `npm run seed:*` or `npm run test:integration` against any shared database.
  Integration tests truncate tables. Use only a disposable local Postgres.
- Never read, print or commit `.env*`, `/.vercel/`, `/.clerk/`, tokens or keys.
- Payments (Stripe) are **test mode only**. Feature flags for payments/recurring stay OFF.
- Mobile/Flutter work (PR #42) is parked. Do not touch it.

## Commands

| Purpose | Command |
| --- | --- |
| Install | `npm ci` (runs `prisma generate`) |
| Unit + component tests | `npm test` |
| One test file | `npx vitest run tests/<name>.test.ts` |
| Type check | `npm run typecheck` |
| Compile (no migrations) | `npx next build` |
| Full pre-push gate | `bash scripts/preflight.sh` |

There is no lint script. **Known baseline:** 4 failures in
`tests/neighborhood-enrollment-reconciliation.test.ts` exist on untouched `main`.
A change is acceptable only if it adds **zero new** failures (preflight compares).

## Layout

- `src/app/**` routes and API handlers (`src/app/api/**/route.ts`)
- `src/lib/server/**` server-only domain logic (marked `import "server-only"`)
- `src/lib/*.ts` shared types and pure helpers · `src/components/**` UI · `src/hooks/**`
- `prisma/schema.prisma`, `prisma/migrations/<timestamp>_<name>/migration.sql`
- `tests/*.test.ts(x)` unit/component (jsdom via `// @vitest-environment jsdom`)
- `tests/integration/**` real DB — opt-in only
- `docs/engineering/ISSUE_<n>.md` per-issue design/verification checkpoints

## Rules of the codebase

- Authorization comes from the session, never from IDs sent by the browser.
- Money is integer cents. No floats, no fabricated averages shown as real prices.
- Marketing copy must not invent customer numbers, quotes or counts.
- Migrations are **additive** and reviewed. Never edit an applied migration file.
- Fix root causes. Do not silence errors, add placeholder routes or fake data.
- Every behaviour change ships with a test that fails before the fix.

## Team workflow

- Issues are filed by the product owner with labels: priority `P0`/`P1`/`P2` and an area
  (`payments`, `homepage`, `marketplace`, `trust`, `growth`, `notifications`, `analytics`).
- One branch per issue: `<your-prefix>/issue-<n>-<short-slug>` from fresh `origin/main`.
- Before starting, check that no open PR already covers the issue (Lance's `codex/issue-*`
  draft PRs own #43 #44 #48 #49 #50 #56 #57 #59 #60). Do not duplicate or fight them.
- Conventional commits: `fix: …`, `feat: …`, `test: …`, `docs: …`.
- PR body ends with `Closes #<n>` and a **Validation** section with real numbers.
- Post an intake comment on the issue when you start and a handoff comment when the PR is up.
- Merging is a human decision by the repo owner. Claude never merges.
