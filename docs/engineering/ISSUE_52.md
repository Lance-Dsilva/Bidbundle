# Issue 52 — pool-service bid template

Work is scoped to [GitHub issue #52](https://github.com/Lance-Dsilva/Bidbundle/issues/52). Mobile work remains parked.

## Contract

The pool template is opt-in for optional `pool_care` HOA requests. Each resident must choose one of the creator's applicable pool tiers before enrollment locks. Compulsory requests retain their existing flow: they include vacant homes, which cannot be silently assigned a pool size.

The creator sets a finite number of calendar service months and visits per month, with at most 104 visits per home. Providers quote integer monthly cents for every configured tier and supply start, chemicals, repairs exclusion, route preference, cancellation and validity terms. The authoritative bid total is:

`serviceMonths × sum(locked homes in each tier × monthly cents for that tier)`

`pricingBasis` stays `total`; `perHomeCents` stays null. Mixed-tier prices must not be presented as a uniform per-home or per-visit charge. This feature does not charge cards or implement Stripe.

Planned visits are spaced within calendar-month windows anchored on the accepted start. Month ends clamp independently, so January 31 → February's last day → March 31. Route day is a preference; the provider's existing planner confirms visit scheduling. The pool agreement's end date is the exclusive end of its final service-month window.

Bid revisions are appended automatically in PostgreSQL. The award freezes the template, selected rates and per-household tier/price snapshot. Resident payloads omit other households' identifiers. Optional pre-award name masking is enforced in server DTOs, including the AI bid tool; freeform notes are withheld because they can reveal identity. Managers retain named comparisons. Ratings use published review aggregates; business age is optional provider-reported founding year, not account age. Three verified bids is a comparison target, not an award minimum.

Admins may select eligible registered providers from the community detail screen. Invitations use current category/coverage/verification checks, unique request/provider identity, audited writes and deduplicated notifications/outbox records. Email follows the provider's job notification preference. No lead creation or verification bypass is included.

## Release boundary

The additive migration `20261110120000_pool_bid_template` must be reviewed and approved before application to a shared database. Prior authorization for PR #64's five migrations does not cover this migration. No shared database has been migrated for issue 52.

Preview currently shares the existing database. The existing Preview build script already skips migrations, so compiling new Prisma fields would not make that database schema available at runtime. This branch therefore disables its automatic Git deployment using Vercel's [branch-specific deployment setting](https://vercel.com/docs/project-configuration/git-configuration). Other branches retain their current behavior. After approved schema setup, remove this exact branch rule before requesting a functional preview. Do not merge or deploy without the applicable release approval.

Use a disposable local PostgreSQL database for integration verification. The test configuration rejects remote/non-owned targets and does not load `.env` files. Never run destructive integration fixtures or manually drain global outbox workers against the shared database.

## Verification

- All 33 migration SQL files applied successfully on a fresh, owned PostgreSQL 16 database. The final pool migration SHA-256 is `6d150710967ad679541897ae769dfa9c90463a594d2bc8cfd5df29cef84c1c06`.
- 30/30 real PostgreSQL tests passed: enrollment/locking/capacity, exact pricing, immutable history/snapshots, privacy, calendar boundaries, invitations, provider policy and four actual row-lock expiry/revocation races. SQL, authorization and notification rows were real; Blob transport and delivery scheduling were mocked. No external email or global outbox drain ran.
- Full unit suite: 2,344/2,348 passed, zero skipped, zero new failures. The same four previously reproduced baseline failures remain in `neighborhood-enrollment-reconciliation.test.ts` (automatic opening, competing claims, rollback and the bounded sweep).
- Standalone TypeScript and `next build` passed. The build used synthetic auth configuration and Google Fonts network access; it did not run migrations. There is no standalone lint script in this repository.
- Actual components were checked in a clearly labeled synthetic local browser fixture at desktop 1280px and mobile 390px: contained table scrolling, named manager/masked resident comparisons, price/rating sorting and exact household tier prices. Scripted provider form entry produced the expected $5,430 term total in about 39 seconds. This is automation evidence, not a measurement of human usability or authenticated deployed end-to-end testing.
- Independent backend review and a separate review of the invitation/privacy/profile paths found no remaining blocker. Verification fixed the partial-unique-index join failure, required a reviewed pool bid version, translated enrollment races to 409, and corrected JSON containment precedence before the final database run.

Reproduce unit/type/build checks with the normal dependency installation and generated Prisma client:

```sh
npx prisma generate
npm test
npm run typecheck
npx next build
```

Use test-only Clerk configuration for builds. Do not run `npm run build` merely to compile: that production command also deploys migrations. Google Fonts must be reachable for `next/font`.

For the PostgreSQL suite, initialize a new owned PostgreSQL 16 database on loopback port 54371, with a database name beginning `bundleen_issue52_test_` and synthetic role beginning `bundleen_issue52_runner_`. Apply the migration SQL chain to that empty disposable database, then run:

```sh
TEST_DATABASE_URL='<owned loopback test connection>' npx vitest run --config tests/postgres/pool-template.config.mts
```

The configuration rejects other targets. Never substitute the application's shared connection. The tests preserve fixtures and do not truncate shared tables.

## Checkpoint

Implementation is verified on `codex/issue-52-pool-bid-template`, based on `1abb87361375a7ef77a330c5d2a58df1300edc4d`. The issue remains open pending PR review, approved shared-schema setup, functional preview verification and the resolving merge. No production release is authorized for this issue. Local sanitized evidence was captured under `/private/tmp/bundleen-issue52-evidence`; the checks and release boundary above are retained in the repository so continuation does not require that local folder.
