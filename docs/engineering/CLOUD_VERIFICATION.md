# Cloud preparation verification

Checked 2026-10-25 against the prepared repository files. This is a clean-copy
macOS check using Node 24.9.0/npm 11.19.0, **not execution in Codex Cloud or Linux**.
Docker's daemon was unavailable. Repeat these checks in the actual environment
before publication; use the supported Node 22 line selected by `.nvmrc` there.

The independent test engineer created a temporary copy of intended tracked and
untracked files without `.git`, dependencies, generated output, `.next`, private
environment files, `.clerk` or `.vercel`. Checks ran with a cleared environment
retaining only process/tool paths, HOME and the temporary-directory setting; no
application credentials were provided. The manager synchronized the final setup
and explicit lint configuration into that copy and reran those affected checks.

| Check | Result and limit |
| --- | --- |
| `bash scripts/cloud/setup.sh` | PASS, exit 0; final script installed 647 packages with dev/optional dependencies and generated Prisma 7.9.1. No database migration or credential file copying. Registry access needed sandbox network escalation on this Mac. |
| `npm run typecheck` | PASS, exit 0, independently verified. |
| `npm test` | PASS, 79 files / 1,426 tests, independently verified. No production source changed after these checks. |
| `npm run lint` | FAIL, exit 1, 10 existing errors and 34 warnings. Strict checks run; nothing was suppressed to turn them green. |
| `npm run build:check` | PASS, exit 0; compiled routes and generated 54 static pages without application credentials or migration. This does not prove database, auth or external-service runtime correctness. |
| `npm run start -- --hostname 0.0.0.0 --port 3187` | Process starts and reports ready. HTTP GET `/` returns 500 with Clerk's missing publishable-key error. A usable preview is BLOCKED pending development Clerk configuration. Test server stopped afterward. |
| `npm run test:integration` without configured services | Expected prerequisite failure, exit 1, listing `TEST_DATABASE_URL`, canonical Upstash variables and limiter salt. Real integration behavior remains BLOCKED/unexecuted. |
| `npm run build` | Not run: it performs database migrations. Compile verification used `build:check` instead. |
| Independent code review | No CRITICAL, MAJOR or MINOR findings in preparation changes. TOML/schema, lockfile, setup shell syntax, links and whitespace checks passed. |

## Existing lint errors

- `src/app/app/admin/profile/page.tsx`: unescaped apostrophe.
- `src/components/homeowner/NeighbourhoodWorkspace.tsx`: two internal anchors that
  the Next Link rule rejects.
- `src/components/layout/BottomNav.tsx`: internal anchors reported six times.
- `src/lib/server/ai/tools/index.ts`: explicit `any` in the intentionally heterogeneous
  tool registry. Assess its existing validation/type-boundary comment when resolving
  this finding; do not blindly substitute an unsafe cast.

These are existing application findings exposed by the new lint command. No product
code was changed as part of cloud setup. The explicit `eslint.checks.config.mjs`
configuration keeps standalone lint strict without silently adding its new gate to
the existing deployment build. Lint remains a required separate engineering check;
compilation is not a lint pass.

## Remaining environment actions

- Publish reviewed repository changes to GitHub so the cloud checkout receives the
  previously untracked engineering system and new setup files.
- Create and publish the actual cloud environment in the Codex UI using `CLOUD.md`.
- Supply development Clerk configuration and preview origins; verify HTTP/browser
  behavior and authenticated flows there.
- Provision isolated integration PostgreSQL/Redis, apply the test schema explicitly,
  and run the integration suite. Verify `btree_gist`/trigger privileges and native
  database network connectivity.
- Resolve the visible lint backlog through the normal scoped engineering process.
- Verify cloud GitHub Issues/PR read/write capabilities and native subagent support.
- Migrate the local daily schedule to a supported cloud destination after publication,
  verify the Chicago timezone and first run, then retire the local heartbeat.

No cloud environment, cloud scheduler, deployment, GitHub PR, migration or issue
implementation was created by these verification commands.
