# Issue 60 — Board review and approval

Issue: https://github.com/Lance-Dsilva/Bidbundle/issues/60

This change is stacked on issue 59 / PR 71. It adds `/app/board` for community-scoped board review; it does not resume the Flutter program.

## Behavior and acceptance

- Managers invite board members using an exact verified email. `hoa_board` is an invitation role backed by a separate `CommunityBoardMember` record. Acceptance preserves existing global roles, profiles and resident memberships. Board membership grants no operational HOA team/settings permissions. Revocation is immediate; a new invitation is required to reactivate membership.
- The manager chooses `manager_only`, `board_majority`, `board_quorum_n` or `board_unanimous`. Majority means more than half of the complete active electorate. The N rule is explicitly presented as **At least N approvals on the same proposal**; it is not a majority of a minimum-turnout group. No empty electorate or missing/zero threshold can approve a bid.
- A review freezes its policy version, verified electorate and shortlisted proposal versions. Board members see named providers, tier prices, whole-job total, inclusions/exclusions, ratings, captured provider profile, credential status, insurance and dates. Historical credential labels say they reflect the opening snapshot; an award always rechecks current credentials.
- Approve/reject ballots may include an explanation and are final within a review. Private discussion is append-only. Policy, membership or bid changes make an open review stale; managers cancel and reopen it. Cancellation preserves history.
- The manager explicitly confirms an award after the required affirmative votes, including after the voting deadline. All existing award entry points and SQL bid-accept/agreement-insert paths enforce the rule. Existing eligibility, approved documents, insurance, participant locks and exact quote-version checks remain in force. Winning-provider approval, recorded result and board notification are atomic with the existing award transaction; existing provider winner/loser notices remain in use.
- PDF minutes include the selected review's comparison, electorate, vote record and private discussion. Bundled OFL fonts support Latin/Greek/Cyrillic/CJK without machine-local fonts. Long content paginates. Unsupported glyphs or export limits fail explicitly instead of silently producing corrupt or incomplete official minutes. The page shows at most 200 comments; export fetches the complete selected discussion up to 1000 messages / 100 pages, otherwise returns an actionable error.
- Credential downloads require current board/manager access and an exact request → review → shortlisted provider → current private document relationship. No Blob path/URL, account email, address or general provider-review authority is exposed.

## Notifications and worker

Opening and confirming a review produce deduplicated private in-app notifications. A durable reminder becomes due at deadline minus 24 hours when the review opens more than 24 hours ahead. Delivery uses the existing authenticated outbox/reminder worker. Its processing transaction rechecks active access, current review, remaining votes and deadline. Changed/cancelled/fully-voted reviews are skipped; infrastructure failures retry. Actual delivery follows the next successful worker invocation, rather than an exact wall-clock guarantee. This change does not alter the scheduler or claim it has been verified live.

Notifications link directly to the selected community/request. No new mail, SMS, analytics or external account is provisioned by this change.

## Deployment boundary

Migration `20261111040000_board_review` is additive: six new tables, the board invitation role, constraints and authoritative triggers. Existing rows are not backfilled or deleted. The board default is manager-only; existing manager-only and neighborhood flows retain their current contract.

Preview currently shares a production database. Both issue-59 and issue-60 branch auto-deployments are explicitly disabled in `vercel.json` because the repository build command applies migrations. Do not enable branch deployment, run the migration against shared resources or merge/deploy this release before review and applicable authorization. Release issue 59 before this stacked change (or review their combined migration sequence).

No new secret names are introduced. Live validation needs the existing Clerk invitation/authentication configuration, database, private provider-document Blob configuration and authenticated outbox worker. Local synthetic fixtures do not prove live invitation delivery, private Blob access or a signed-in cross-role production flow.

## Verification

Use `npm test` and `npm run typecheck`. For compilation without database side effects use `npx next build`, not `npm run build` (which runs migrations).

The independent PostgreSQL suite is `npx vitest run --config tests/postgres/board-review.config.mts`. It requires `TEST_DATABASE_URL` pointing to a newly created owned loopback test database with all migrations applied. Never run destructive fixtures or manually drain the global outbox against shared Preview/production.

The sanitized local checkpoint records the final test/build counts and branch/PR. Verification includes database lock races, direct SQL award bypasses, immutable ballot/audit records, role preservation, current credentials and electorate, canceled/outdated reminders, private download boundaries, Unicode/PDF pagination and failed-comment retention. All database tests use a disposable local database; external delivery is substituted.

Verified on the final implementation: 2,684/2,684 repository unit tests (including 86 board checks), 36/36 actual PostgreSQL integration tests, TypeScript and direct Next.js production build. Font tracing includes both bundled fonts and their licenses. Independent source review passed after fixes. Synthetic component views had no horizontal overflow at 320, 390 and 1280 CSS pixels; desktop and mobile screenshots were captured. Browser interaction completion was blocked by the test browser's native confirmation dialog, so no completed browser vote/award flow is claimed. Live cross-account Clerk/Blob/notification verification remains a release gate.
