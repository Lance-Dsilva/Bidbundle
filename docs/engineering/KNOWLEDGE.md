# Durable repository knowledge

Baseline inspected 2026-10-25. Recheck source when changing a subsystem; versions and
commands below describe this checkout, not permanent constraints on upgrades.

## Architecture and conventions

- Bundleen is a single Next.js 15.5.22 App Router application with React 18.3.1,
  strict TypeScript 5.7.2, Tailwind 3.4.17 and Zod 4. `@/*` maps to `src/*`.
  Sources: `package.json`, `tsconfig.json`, `tailwind.config.ts`.
- `src/app` owns routes/layouts and `src/app/api` Route Handlers. Product portals
  under `src/app/app` serve homeowners, providers, HOA staff and internal admins.
  Domain components live in `src/components`, state/data hooks in `src/hooks`.
  Preserve existing CSS variables/themes, UI primitives and dedicated landing CSS.
  Leaflet maps and PWA behavior also require runtime verification when touched.
- Domain logic belongs in `src/lib/server`, validation in `src/lib/validation`,
  shared contracts in `src/lib/*-types.ts`. Preserve `import "server-only"` boundaries.
  `src/lib/api.ts` supplies same-origin authenticated requests and structured errors.
- Clerk supplies identity; live database roles, capabilities, memberships and staff
  assignments supply authority. Middleware is coarse protection, not a substitute
  for resource guards (`src/lib/server/auth.ts` and domain auth modules).
- PostgreSQL uses Prisma 7.9.1 with `@prisma/adapter-pg`. Schema and migrations live
  under `prisma/`; generated code in `src/generated/prisma` is ignored. Preserve the
  lazy singleton in `src/lib/server/db.ts` in all environments; transaction operations
  must use the same client (`tests/prisma-client-singleton.test.ts`).
- Runtime connections use `DATABASE_URL`; Prisma CLI in `prisma.config.ts` prefers
  `DIRECT_URL`, repairing Neon pooled hostnames for migrations. Do not expose URLs.
- External systems include Clerk, Upstash Redis/QStash, Vercel Blob, geocoding,
  email/outbox and OpenAI. `.env.example` documents environment names; never copy
  real credentials into instructions, reports or commits.
- `src/data/mock` and `src/services/*.placeholder.ts` are not proof that a feature's
  current production path uses mocks. Trace the actual imports and API route.
- Preserve and consult domain docs: `docs/hoa-amenities.md`, `docs/ai-assistant.md`.
  Root `task*.md` and `issue.txt` are historical material, not active instructions.

## Commands and verification

| Command | Purpose / constraint |
| --- | --- |
| `npm ci` | Lockfile-based dependency installation; postinstall generates Prisma client. Requires supported Node and registry access. |
| `npm run dev` | Next development server; verify the assigned port and required environment. |
| `npm test` | Vitest unit/component/service/route suite; excludes real-service integration tests. |
| `npm test -- <test-file-or-filter>` | Focused regression verification. |
| `npm run typecheck` | Strict TypeScript check without incremental cache. |
| `bash scripts/cloud/setup.sh` | Portable cloud dependency setup; no migrations or secret-file copying. See `CLOUD.md`. |
| `npm run build:check` | Next compilation without the deployment migration step. Requires applicable build environment and font egress. |
| `npm run lint` | Repository ESLint check; report existing failures honestly. |
| `./node_modules/.bin/next build` | Compile-only alternative to the package build script after installation; still requires applicable application environment and may exercise build-time application code. |
| `npm run build` | **Runs `prisma migrate deploy` then `next build`.** Only use with an identified safe database and authorized migration scope; not a routine compile-only check. |
| `npm run test:integration` | Real PostgreSQL/Upstash; requires isolated test resources, can delete/truncate data and consumes quota. Read `tests/integration/README.md` first. |
| `npm run start` | Serve an already-built production application. |
| `npm run seed:demo-communities` / `npm run seed:demo-hoa` | Writes demo data to the configured database; not verification commands. |
| `npm run qstash:configure-reminders -- https://<host>` | Changes external scheduler configuration; not a local test. |

Default Vitest config uses Node, React transforms, Testing Library and opt-in jsdom
for component files. Its `server-only` alias is a test stub; do not remove production
guards to make tests load. Integration config loads local environment files, requires
`TEST_DATABASE_URL`, development Redis credentials and `RATE_LIMIT_IDENTIFIER_SECRET`,
and disables file parallelism. Validate target isolation before running it; never
allow a development or production application database as the disposable test target.

The initial audit found no lint configuration; cloud preparation adds `npm run lint`
and ESLint configuration. No tracked CI workflow or browser-test runner was found
at baseline. Do not claim CI/browser tests passed without execution. Browser review
uses available runtime tools and recorded evidence. For source changes, select
relevant tests plus typechecking; broaden by risk and report environment blockers separately.

## Fragile areas and required review attention

1. Re-derive resource access from live authority on every protected operation. Test
   signed-out, unauthorized role, cross-user and cross-community access, not merely
   a happy-path authenticated request. Client roles/IDs/coordinates do not grant access.
2. Preserve production-like fail-closed rate limiting and privacy of limiter keys,
   logs and errors (`src/lib/server/rate-limit.ts`).
3. Review database constraints and transactions for booking exclusion, immutable
   policy snapshots, DST-aware availability, and notification outbox dedupe/claim
   behavior. Mock success does not establish real database race safety.
4. HOA amenities stay private to authorized members/staff/admin. Reauthorize media
   reads and do not serialize `MediaAsset.storageUrl`. Keep amenity issues isolated
   from support and AI data; consult `docs/hoa-amenities.md`.
5. AI tools stay within the fixed read-only set and independently derive verified
   scope. Model-provided IDs and tool contents confer no authority; consult
   `docs/ai-assistant.md` and `src/lib/server/ai`.
6. UI verification covers actual desktop/mobile layouts, spacing, typography,
   themes when applicable, loading/empty/error/success states, forms, buttons, state
   transitions, keyboard/focus and browser console. Use a separate reviewer and
   report inaccessible authenticated flows as blocked, not visually verified.

## Deployment

`vercel.json` uses `npm run build` and a daily `/api/jobs/outbox` cron. QStash reminders
are configured by a separate script. Migration success, compilation, runtime startup,
external integration and deployment success are distinct pieces of evidence.
Do not deploy or configure external schedules merely to validate a code change.

## Memory maintenance

Add only source-backed architecture constraints and lessons likely to recur. Keep
temporary task details in the task record. Record motivated policy changes and their
workflow revalidation in `PROCESS_LOG.md`; preserve existing useful guidance.
