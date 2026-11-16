# Issue 57: consent-based product analytics

This branch is a **partial, disabled-by-default implementation** of [issue #57](https://github.com/Lance-Dsilva/Bidbundle/issues/57), not a completed pilot funnel.

## Implemented

- Account-level explicit opt-in, equal allow/decline choices, persistent preference control, revocation, and a versioned consent record. No tracking before opt-in; no retrospective replay. Signed-out visitors are not tracked in this phase.
- No third-party browser SDK, analytics cookies, autocapture, session recording, browser URLs, IP, user-agent or form values. Only internal user IDs and allowlisted `communityId`, `requestId`, category and role are exported. Server context comes from authorized stored business records.
- Durable events with deterministic UUIDs; concurrent drains lock rows, recheck consent, suppress revoked queues, and retry transport errors with backoff. Event time and UUID survive retries. Delivered event IDs remain to deduplicate business retries. Withdrawal stops future export; it cannot retract previously sent events.
- Existing signed daily outbox and five-minute reminder workers drain a maximum of ten analytics events per invocation. No new scheduler or external account is provisioned.
- Current hooks: successful provider bid submission (one per bid, not each revision), successful award, completed resident visit, submitted visit review, and committed roster import (one milestone per manager/community). These nonfinancial hooks are best-effort after business commit; outages can lose these optional events. Payment hooks **must** use transactional enqueue instead.

## Enable only after deployment verification

1. Apply `20261116010000_product_analytics` in the approved deployment database. It was tested only in disposable local PostgreSQL; no shared database has been modified by this work.
2. Configure `PRODUCT_ANALYTICS_ENABLED=1`, server-only `POSTHOG_PROJECT_KEY` (the project's `phc_` ingestion key), and the matching region `POSTHOG_HOST=https://us.i.posthog.com` or `https://eu.i.posthog.com`. A personal API key is rejected. Do not put keys in chat, source, browser environment, or logs.
3. Confirm the existing signed outbox workers run, an account can decline/allow/revoke, and approved synthetic events appear in the intended PostHog project. No live PostHog delivery has yet been tested.
4. Reconcile the consented sandbox cohort's payment event UUIDs and counts against the durable Stripe ledger. Analytics excludes nonconsenting accounts, so its payment totals deliberately cannot equal all account-wide Stripe traffic. Operational accounting remains authoritative.

## Integration contract for sibling issues

Use `enqueueProductEvent(tx, { userId, event, eventId, properties })` **inside the same Prisma transaction** as the durable financial transition. `tx` must be an interactive transaction. `userId` is the actual consenting resident/payer, not the operator or webhook caller. `eventId` identifies the stable business transition (for payments, verified Stripe event ID). The same event/user/eventId deduplicates across retries.

For optional already-committed nonfinancial actions, `captureProductEvent(...)` swallows only analytics errors. `captureRequestProductEvent` loads stored community/category context; `captureVisitProductEvent` attributes completion to the resident. Never call any capture helper merely because a browser says a transaction succeeded. Do not accept arbitrary properties from clients.

Remaining hooks and dependencies:

| Events | Required source |
| --- | --- |
| `invite_opened`, `request_viewed`, `join_started` | #48 approved share/invite flows; logged-out consent design still required |
| `joined`, `tier_unlocked` | #49 actual enrollment and committed price changes |
| `card_saved`, `payment_succeeded`, `payment_failed` | #43 verified card association and webhook ledger transitions |
| `rebooked` | #56 actual renewal success |
| `hoa_onboarding_started`, `provider_applied`, `provider_verified` | Existing onboarding/admin paths still to instrument with authoritative actor consent |

All event names are allowlisted now; the existence of a name is not evidence that a hook is implemented.

## Dashboard specification (not yet provisioned)

Create a private PostHog dashboard named **Bundleen pilot conversion** in the approved test project. Use an event-property filter `communityId` on each insight, and a 30-day window. Save:

1. Ordered unique-user funnel: `invite_opened` → `request_viewed` → `join_started` → `card_saved` → `joined` → `payment_succeeded` → `rebooked`. Scope to opted-in cohort and hold `communityId` constant. Show both conversion rate and absolute counts.
2. `bid_submitted` total count broken down by `requestId`. Each provider's single bid counts once; revisions do not create new bids.
3. `payment_succeeded` and `payment_failed` counts by day for the consented test cohort. This is measurement, not an accounting ledger.
4. Roster homes/invited denominator and average savings vs solo price: **pending** authoritative aggregate counts and #49 solo-price data. Do not label `hoa_roster_imported` event count as roster household count, or infer savings from incomplete values.

Full issue acceptance remains blocked on these integrations, dashboard creation, and actual Stripe/PostHog reconciliation. Keep the PR draft and issue open.

## Validation

- `npm test -- tests/product-analytics.test.ts tests/product-analytics-consent.test.tsx`
- `npm run typecheck`
- Dedicated synthetic DB: `DATABASE_URL=postgresql://...@127.0.0.1:53957/bundleen_analytics_test npx vitest run --config vitest.analytics.config.mts`. The suite refuses all other hosts, ports and database names. Transport is mocked; it cannot send real events.
- Full suite at initial implementation: 2486/2490 passed; four known baseline neighborhood enrollment reconciliation failures remain.

References: [PostHog capture API](https://posthog.com/docs/api/capture), [data collection controls](https://posthog.com/docs/privacy/data-collection), [dashboard API](https://posthog.com/docs/api/dashboards).
