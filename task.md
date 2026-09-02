# Task: Eliminate Provider Portal 404s and Complete Provider Data Flows

## Goal

Fix the provider portal so every page uses current, real, authorized data sources and navigating the portal produces no API 404s or repeated request loops. Do not hide or catch the errors without fixing their cause.

## Confirmed root cause

The provider UI still calls four legacy endpoints that do not exist:

- `GET /api/provider/dashboard`
- `GET /api/provider/me`
- `GET /api/provider/conversations`
- `GET /api/provider/reviews`

The obsolete calls originate from:

- `src/hooks/useProviderDashboard.ts`
- `src/hooks/useProviderMessages.ts`
- `src/hooks/useProviderReviews.ts`

They are mounted by provider pages and by `src/components/layout/ProviderShell.tsx`. The shell currently invokes provider dashboard data on every provider route, while some individual pages invoke the same hooks again. This produces duplicate requests in addition to the 404 responses.

The Chrome `beforeinstallprompt.preventDefault()` banner message is a separate PWA advisory, not the cause of the red API errors. Preserve the install flow unless it has a real visible bug.

## Required implementation

### 1. Remove obsolete provider API contracts

- Find every reference to all four missing endpoint paths and remove or migrate it.
- Do not add placeholder compatibility routes that return fabricated data.
- Do not preserve the legacy hook interfaces merely to silence the console. They use outdated numeric IDs and snake-case response shapes that do not match the current database/domain model.
- Remove unused hooks after their consumers are migrated.

### 2. Correct data ownership in `ProviderShell`

- The shared shell must not fetch dashboard, profile, conversations, and review data on every page.
- Use the provider identity already resolved by the server layout, or introduce one session-scoped provider context for genuinely shared identity data.
- Load page-specific data only on the page that consumes it.
- Show an unread-message badge only when backed by real conversation data. Otherwise omit it instead of inventing a count.
- Ensure one request per resource per navigation. Avoid duplicate shell/page fetches, retry loops on 404, and state updates after unmount.

### 3. Provider overview and profile

- Inspect the current schema, server services, and existing routes before adding anything.
- Reuse canonical endpoints where appropriate, including:
  - `/api/provider/marketplace`
  - `/api/provider/service-areas`
  - `/api/profile`
  - `/api/profile/provider`
  - `/api/me/context`
- If the dashboard needs aggregated metrics that existing services cannot supply cleanly, add one purpose-built, session-authorized endpoint such as `/api/provider/overview`, using current camelCase/string-ID types.
- The profile page must use current provider profile endpoints. It must not load `/api/provider/me` merely to show identity, status, or statistics.
- Preserve working marketplace, bid, schedule, earnings, service-area, credential, and job-feed behavior.

### 4. Provider reviews

- Back the reviews page with real review records from the current database schema.
- Add a secure provider review-list/summary endpoint only if an equivalent current service does not already exist.
- Derive the provider exclusively from the authenticated session. Never accept a provider ID from the browser as authorization.
- Return only the current provider's reviews, with pagination where appropriate and real average/distribution values.
- Provide production-quality loading, empty, and error states.

### 5. Provider messages

- Inspect the schema first to determine whether a real service-request conversation model already exists.
- If messaging exists, expose it through current, session-authorized routes and migrate `useProviderMessages` to current domain types.
- If it does not exist, implement the minimum complete conversation data model and APIs required by the existing provider/customer messaging UI. Conversations must be tied to a legitimate service request, bid, agreement, or other authorized business relationship. Do not allow arbitrary messaging by submitting another user's ID.
- Enforce participant-only access for listing, reading, sending, and marking messages read.
- Support correct ordering, unread counts, empty states, and pagination where needed.
- Do not reuse Bundleen support tickets as customer/provider job conversations.

### 6. Fetching and error behavior

- Continue using the existing same-origin authenticated API client and Clerk session cookies.
- Do not introduce local-storage bearer tokens or browser-supplied provider ownership fields.
- Abort requests where appropriate and prevent infinite/repeated fetches after failures.
- Display actionable page-level errors for genuine server failures without flooding the console or network panel.

## Security requirements

- All provider APIs must resolve the current user on the server and require an active service-provider account.
- Enforce tenant/participant isolation on every query and mutation.
- Validate all inputs and pagination values.
- Never trust client-provided user, provider, community, conversation, review, bid, or agreement ownership.
- Avoid leaking private homeowner, HOA, provider, credential, or conversation data in response payloads.
- Record an audit event for newly introduced sensitive mutations when consistent with the existing audit system.

## Tests

Add or update tests that cover at least:

1. A repository contract test that fails if any of the four obsolete endpoint strings are reintroduced.
2. Provider shell/page tests proving shared resources are not fetched twice.
3. Provider overview/profile response and authorization behavior.
4. Reviews are limited to the authenticated provider and use real database values.
5. Conversation participant isolation: one provider cannot list, read, send to, or mark another provider's conversation.
6. Message ordering and unread/read transitions if messaging is implemented.
7. Production-quality loading, empty, and failure states.
8. Regression coverage for marketplace, bids, schedule, earnings, service areas, and provider profile settings.

Run and fix all failures from:

```bash
npm run typecheck
npm test
npx next build
```

## Acceptance criteria

- Navigating every route under `/app/provider/**` produces no requests or 404s for the four obsolete endpoints.
- Searching the source finds no references to those obsolete paths.
- Dashboard, profile, reviews, and messages show real authorized data or an honest empty state.
- No provider resource is fetched redundantly by both `ProviderShell` and a page.
- No retry/request loop occurs when an endpoint fails.
- Provider data is isolated by the authenticated session and cannot be accessed by changing request parameters.
- Existing working provider and HOA functionality remains intact.
- The complete test suite, typecheck, and production build pass.

## Delivery notes

- Keep implementation focused on this provider-console defect and its real underlying data flows.
- Preserve unrelated working-tree changes.
- Document any schema migration and exact manual verification steps in the completion summary.
- Do not commit or deploy unless separately requested.
