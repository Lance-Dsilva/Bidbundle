# Codex Cloud environment

This repository targets a Linux cloud workspace with Node 22 (at least 22.13), npm,
Git and Bash. Read `.nvmrc` and `package.json` for the supported runtime. Use the
checked-out repository root, not a developer's home directory. No macOS application,
Homebrew installation, local browser session or copied `node_modules` is required.

## Create and publish in Codex

First commit and push the reviewed preparation files, including previously untracked
`AGENTS.md`, `.codex/` and `docs/engineering/`, to a GitHub branch available to the
environment. A cloud clone cannot see this Mac's uncommitted files. Use a reviewed
PR to make the setup available on the default branch; environment publication does
not publish repository changes to GitHub.

In the current Codex UI:

1. Choose **Work in > Cloud > Select environment > Create environment**, or
   **Settings > Codex Cloud > Environments > Create environment**.
2. Connect GitHub if prompted and select `Lance-Dsilva/Bidbundle`, then **Get started**.
   Ensure the checked-out revision contains these setup files.
3. Ask setup to use Node 22.13 or newer in the Node 22 line, run the install command
   below, configure the required environment values and network destinations, and
   use the startup procedure below as its Start skill.
4. Have setup run lint, typecheck, unit tests, compile and startup checks. Supply
   development service access for the integration test tier when ready. Review
   results and unresolved checks before saving and selecting **Publish**.
5. Wait for **Environment published**, then **Start a new task**. Ask the manager
   to follow `AGENTS.md` and `GITHUB_ISSUES.md`; verify the selected environment and
   repository revision in that new task.

Current environments record an **Install script** and **Start skill**. New tasks
start from the published prepared filesystem; existing tasks retain separate saved
state. After setup changes, edit and **Republish**, then test a new task. Merely
editing repository files does not create or publish a cloud environment.

Official references, checked 2026-10-25:
[cloud setup and publishing](https://learn.chatgpt.com/docs/environments/cloud-environments),
[subagent configuration](https://learn.chatgpt.com/docs/agent-configuration/subagents).
If your account still exposes legacy environments, use the same repository install
command for setup and maintenance; legacy setup-only secrets disappear before the
agent phase. Do not persist them into files to bypass that boundary.

## Installation, checks and startup

From the repository root, use this Install script command (also suitable for legacy
setup/maintenance):

```bash
bash scripts/cloud/setup.sh
```

It performs a lockfile install with development and
platform optional dependencies and regenerates Prisma. It must not run migrations,
seed data, configure schedules, copy local environment files or print credentials.

Routine checks after installation:

```bash
npm run lint
npm run typecheck
npm test
npm run build:check
```

Lint uses `eslint.checks.config.mjs` explicitly. The nondefault filename keeps this
new standalone check from silently changing Next 15's existing deployment-build
behavior. Run lint separately as a required engineering check; a successful compile
does not imply lint passed. The initial lint run exposes existing application
errors; see the verification record below. Rules have not been disabled to hide them.

`build:check` compiles Next without migration. Existing `npm run build` intentionally
remains the deployment command that runs `prisma migrate deploy` before compilation.
Use deployment builds only against an identified, authorized database. Compilation
needs Google Fonts egress; this checkout compiles without application credentials.
Usable authenticated previews need a valid development Clerk publishable key. Configure
browser-facing `NEXT_PUBLIC_*` settings before compilation, since they are inlined.
Do not invent working keys or mark a blocked authenticated preview as verified.

Start skill procedure (keep the server in a managed long-running terminal):

```bash
npm run dev -- --hostname 0.0.0.0 --port 3000
```

Open the environment's forwarded preview for port 3000 and check the landing page,
browser console and a relevant route. Use test users and configured preview origins
for authenticated flows. For production-mode startup, compile with `build:check`
then run `npm run start -- --hostname 0.0.0.0 --port 3000`. Starting a server proves
neither database connectivity nor protected feature correctness. Vercel crons and
QStash callbacks are not automatically installed by a Next development server.

## Environment and secret requirements

`.env.example` lists names and explanatory defaults. Set cloud values through the
environment UI or Personal vault; the repository does not contain usable credentials.
Do not copy `.env.local`, `.env.test.local`, `.clerk`, `.vercel`, private tokens or
Mac credential stores into the environment image. Do not use production credentials
or the production admin identity for routine development.

| Tier | Configuration |
| --- | --- |
| Install, unit tests, lint, typecheck | No real application credentials required. Prisma client generation does not migrate or query a database. |
| Compile | No real application credentials were required by the tested checkout; Google Fonts access is needed. Supply required feature-specific public settings before building a usable preview. |
| Usable auth preview | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` from a development Clerk application; browser-side authentication needs configured keys/origins even if compilation passes without them. |
| Authenticated app | `CLERK_SECRET_KEY`, `DATABASE_URL`; development Clerk preview origins/redirects and test users. |
| Schema migrations | `DIRECT_URL` for a direct development/test PostgreSQL session, or the intended `DATABASE_URL` when the provider has one connection. PostgreSQL must support `btree_gist`; the migration role needs extension privileges or an operator must preinstall it. |
| Production-mode mutation APIs | Development `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `RATE_LIMIT_IDENTIFIER_SECRET`. Runtime also accepts the complete `KV_REST_API_URL`/`KV_REST_API_TOKEN` alias pair. Production-like rate limiting remains fail-closed. |
| Integration tests | Disposable `TEST_DATABASE_URL`, canonical `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN`, `RATE_LIMIT_IDENTIFIER_SECRET`. Integration config does not accept only KV aliases. |
| Maps/address verification | `NEXT_PUBLIC_GEOAPIFY_API_KEY` and separate privileged `GEOAPIFY_API_KEY`; allow preview origins. Optional URL/timing/cache overrides are in `.env.example`. |
| Media uploads | Development `BLOB_READ_WRITE_TOKEN`; allow Blob API and the actual store host. |
| Email | Development/test `RESEND_API_KEY` plus `EMAIL_FROM_ADDRESS` or `RESEND_EMAIL_DOMAIN`; optional `EMAIL_REPLY_TO`. Avoid delivery to real customers during tests. |
| Application AI feature | `OPENAI_API_KEY`, optional `AI_MODEL`. This is the app's key, not a prerequisite for signed-in Codex engineering tasks. |
| Workers | QStash signing keys; scheduling administration additionally needs `QSTASH_TOKEN` and optional `QSTASH_URL`. Protected cron/manual calls use `CRON_SECRET` or `OUTBOX_WORKER_SECRET`. Do not configure external schedules during installation. |
| Origins and admin identity | Explicit development `BUNDLEEN_APP_URL`, `APP_URL`, `BUNDLEEN_ADMIN_OWNER_EMAIL`; optional `NEXT_PUBLIC_APP_URL` legacy notification fallback. Clerk path settings are listed in `.env.example`. |
| GitHub CLI fallback | `GH_TOKEN` with the minimum repository permissions below, only if connected cloud GitHub tools do not provide required operations. Cloud checkout access alone is not proof of CLI authentication. |

Use direct environment variables for values the program must parse locally, including
PostgreSQL connection strings, salts, signing keys and Clerk keys. Current cloud
**Network secrets** substitute placeholders only for HTTPS on port 443 to allowed
hosts. They are appropriate only for clients/credentials verified to work with that
substitution; they cannot supply native PostgreSQL authentication or local signing
operations. Never write decrypted secrets into setup artifacts. Saving a domain
allowance does not grant service permissions.

## Integration test tier

`npm test` excludes real services. `npm run test:integration` intentionally fails
when prerequisites are absent and can delete/truncate records and temporarily
disable test-database triggers. Use a dedicated disposable database, not the app's
development or production database, and development Redis. Give the test database
role the migration/trigger permissions required by these tests.

After confirming the target is disposable, provision its schema explicitly:

```bash
: "${TEST_DATABASE_URL:?Set the disposable test database URL first}"
DIRECT_URL="$TEST_DATABASE_URL" ./node_modules/.bin/prisma migrate deploy
npm run test:integration
```

Supply variables through the environment settings, with `TEST_DATABASE_URL` set and
nonempty before running that command. Do not run it as an unconditional install step.
The integration config runs files serially; do not share fixtures with another task
or test process. `tests/integration/README.md` is the detailed safety contract.

A local PostgreSQL service in the cloud task is an alternative to a hosted test
database, if setup provisions PostgreSQL with contrib/`btree_gist`, starts it for
each task and creates a disposable role/database. This repository does not provision
that service automatically. Upstash's REST integration still needs its configured
development endpoint; a raw Redis server is not a drop-in replacement for that API.

## Network requirements

Enable internet access with **Package managers**, then add exact required service
hosts. Test access during setup and in a new published task. Workspace policy may
further restrict destinations or protocols.

| Activity | Destinations/protocol |
| --- | --- |
| npm install | `registry.npmjs.org` over HTTPS; Node provisioning may use `nodejs.org`; Prisma engine downloads may use `binaries.prisma.sh`. |
| Compile Inter font | `fonts.googleapis.com`, `fonts.gstatic.com` over HTTPS, during the build itself. |
| GitHub operations | `github.com`, `api.github.com`; archive/release hosts only when required by the selected tools. Writes need permitted GitHub API methods as well as authentication. |
| PostgreSQL | Exact database hostname and provider port (normally TCP 5432 with TLS); verify native TCP reachability separately from HTTPS allowlisting. Use a provisioned local service or supported private connectivity if native egress is unavailable. |
| Authentication | `api.clerk.com` and the development tenant's frontend API/browser host. |
| Rate limiting/integration | Exact development Upstash REST hostname over HTTPS. |
| Optional features | `api.geoapify.com`, `maps.geoapify.com`, `api.resend.com`, `api.openai.com`, configured QStash endpoint, Vercel Blob API/store hosts as needed. |

A cloud browser has its own network/origin constraints. Validate browser requests,
authentication redirects and preview-host restrictions as well as shell egress.
Do not broadly enable unrelated services merely for lint/unit tests.

## GitHub and the engineering manager

`AGENTS.md` and `.codex/agents/*.toml` are repository-relative and require no local
Codex executable. Verify named-role discovery in the target host. If named roles
are unavailable but subagents exist, the manager reads the saved role instructions
and supplies them in each delegation. If delegation itself is unavailable, report
the limitation; self-review cannot substitute for required independent review.

GitHub repository checkout permission does not establish shell/API issue or PR write
permission. Prefer the cloud host's connected GitHub tools. If GitHub CLI is needed,
request `gh` in the environment's tool setup and supply cloud-scoped authentication
through approved secret settings; never copy this Mac's `gh` login. Verify:

```bash
git remote -v
gh repo view Lance-Dsilva/Bidbundle --json nameWithOwner,defaultBranchRef
gh issue list --repo Lance-Dsilva/Bidbundle --state open --limit 10
gh pr list --repo Lance-Dsilva/Bidbundle --state open --limit 10
```

These are capability smoke checks, not full paginated backlog retrieval. Use the
connector equivalent if shell access is absent. Scope credentials to this repository:
Issues read, PR read/write, Contents write for approved branches, Actions/checks read,
and Projects read only if priority ordering requires it. Never print tokens. Verify
write support before promising autonomous PR publication; never merge without authority.

Run the issue-only workflow in `GITHUB_ISSUES.md`. Resume an existing cloud task for
unpublished work. For cross-task recovery, keep a sanitized acceptance/evidence/
next-action summary in the active PR description and verify its head against remote
branches. Treat `ISSUE_STATE.md` as a checkpoint that can be stale in a new clone.
If no remote checkpoint exists and ownership is uncertain, stop and report it.

The existing eight-hour heartbeat is local. Publishing a cloud environment does not
move that schedule or its chat automatically. After publication, create a supported
cloud-targeted task every eight hours and these
repository-relative instructions; verify its destination and first run, then retire
the local heartbeat to avoid duplicate workers. Do not claim unattended cloud
scheduling is active before that migration. See `SCHEDULE.md` for current status.

## Verification record

See `CLOUD_VERIFICATION.md` for the observed results: clean-copy install,
typecheck, unit tests and compile passed; lint exposes 10 existing errors/34 warnings;
usable HTTP preview needs Clerk configuration and real integration services are
unconfigured. The actual Linux cloud run and publication remain pending.

Record final command results in the setup report and task handoff, distinguishing
clean dependency installation, lint, typecheck, unit tests, compile, startup and
real-service integration tests. A clean macOS snapshot is useful evidence but does
not establish Linux cloud success. Publish only after reviewing the actual cloud
setup report and any blocked tests/services. No real cloud execution is claimed by
this guide alone.
