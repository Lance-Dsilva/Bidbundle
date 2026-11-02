# Mobile parity matrix

Baseline fb4a245 (2026-11-01). Source: src/app/app/**/page.tsx and API handlers; current web behavior remains source of truth. Foundation, R01–R04 and local R05 read-only implementation are identified below; other rows remain PLANNED. No authenticated mobile feature is live verified yet. Detailed route/method inventory: API_CONTRACT.md. Sequence preserves dependency order; each slice needs exact payload fixtures, independent authorization/test/UX/code evidence before completion.

| Role | Web screens / features | Existing API families | Mobile slice / acceptance |
|---|---|---|---|
| All public | Homepage, information/help, community onboarding, post-request entry | community-interest | Native welcome/help and coverage interest; marketing web pages may open system browser; no invented availability |
| All identities | sign-in, get-started sign-up/profile, auth/continue | Clerk + auth/profile; profile; me/context | Native SDK/auth shell and profile/context read code implemented; live auth unverified. Full onboarding remains Phase 3, including verification and profile completion. |
| Homeowner | dashboard | homeowner/dashboard | Implemented summary read/UI with cold start/loading/errors; savings display withheld pending currency-aware aggregate contract; real authenticated runtime proof pending. |
| Homeowner | request/new, requests/detail | homeowner/requests + id + transition + participation + award | R01: read-only own-request list and authorized neighborhood detail implemented; legacy HOA detail explicitly unsupported. Create/edit/cancel, participation and lifecycle remain PLANNED; no award authority inferred. |
| Homeowner | bidding-room, bids | homeowner/bids; homeowner/requests/id/award; hoa/requests/id/bids | Requester/participant bid comparison; provider selection only by the server-authorized community manager; no auto-award |
| Homeowner/resident | neighbourhood, community | homeowner/neighbourhood; HOA requests, join, surveys/vote | Coverage, membership, community requests/participation/surveys; no resident manager rights |
| Homeowner | chat | homeowner/inbox + thread/messages/read | Participant-only conversations, unread, send/retry/empty states |
| Homeowner | profile/preferences/avatar | profile, profile/homeowner, profile/avatar | Address/coverage/preferences/upload; no mutable role or verification |
| Provider | dashboard | provider/overview; provider/marketplace | R03 local: status/activity counts, nullable published rating and decided-bid win rate. Independent local review and exact-head native CI passed. Money/trends and inbox deferred; marketplace/eligibility remain PLANNED. |
| Provider | job-feed, bids, hoa | provider/marketplace; requests/id/bid | R05 local: server-eligible feed with inline details, bounded candidate semantics and no private awarded-work projection; independent review/253tests passed, resulting-head CI pending. Bid submit/update and full workflow remain PLANNED. |
| Provider | schedule | provider/marketplace; occurrences/id/plan; visits/id/status | Assigned agreements/visits/day plans and valid lifecycle updates |
| Provider | earnings | provider/marketplace/earnings | Real recorded data only; do not imply payment processing beyond backend |
| Provider | messages | provider/inbox + thread/messages/read | Same participant rows as customer; isolation tests |
| Provider | reviews | provider/ratings | Server-backed ratings/reviews, honest empty state |
| Provider | profile/business/verification/service areas | profile/provider; provider/service-areas and marketplace/service-areas; profile/avatar | Onboarding and editable allowed fields, document/status restrictions; map/permission-denial UX |
| Authorized HOA manager | dashboard/community management | me/managed-communities; hoa/communities/id/units/invitations/requests/surveys | Scoped manager assignments, units/invitations, requests/surveys; delegated roles checked server-side |
| Authorized HOA manager | requests/bids/awards/close | hoa/requests/id, bids, award; hoa/occurrences/id/close | Preserve live service lifecycle and manager/provider authority; missing participant address errors |
| HOA resident/manager | agreement and visit reviews | hoa/agreements/id/review; hoa/visits/id/review | Eligible participants only, exact server review rules |
| HOA resident | amenities list/detail, availability/gallery | hoa/amenities; id; availability; gallery | Native list/detail, server community access |
| HOA resident | amenity bookings | id/bookings; amenities/bookings; booking/cancel/reschedule | Availability/booking/conflict and cancellation/reschedule outcomes |
| HOA resident | amenity reviews/issues/photos/messages | id/reviews; reviews/id/photos; id/issues; issues/id/photos/messages; media/id | Upload permission/failure, ownership, reporting, review edit per API |
| Authorized HOA manager | amenities operations | amenities/manager; id/status; id/closures; booking/decision; issues/id; reviews/id/moderate/response; amenities/broadcast | Scoped operations, closures, decisions, moderation, responses/broadcast; not public admin powers |
| Supported customer roles | account / in-app notifications | profile; me/notifications + notificationId | R02 local: own account details and recent notification list with server read state; independent local review passed, resulting-head CI pending. Editing, mark-read/dismissal and native destination mapping remain PLANNED; NOT device push |
| All supported customer roles | support list/ticket/messages/reopen | support/tickets + id + messages + reopen | R04 local read-only list/customer-visible conversation: server scopes own or actively managed community tickets. Independent review/200 local tests and exact-head native CI passed. Create/reply/reopen remain PLANNED; no attachment contract exists. |
| Customer roles incl HOA manager | AI assistant surfaces (HOA assistant page and shared assistant) | ai/chat/history/memory | NDJSON streaming, cancellation/history/memory; role-restricted tools remain server-side; never hide feature omission |
| Internal admin | dashboard, access, staff, audit, communications, communities, providers, support/AI drafts, assistant, profile | admin/* | EXPLICITLY DEFERRED from public mobile; keep existing internal web portal |
| Server automation | reminders/outbox | jobs/* | EXCLUDED: server-only jobs, no app UI or embedded job credentials |

## Explicit product boundaries and unresolved gaps

No entire public feature family is silently dropped. Phase 3 rows remain backlog until reviewed and tested. The only proposed permanent exclusion is internal administration/server jobs; manager duties in existing HOA customer portal stay in scope. Public marketing detail may remain on web, with core product workflows native. Notification preference named notifyPush is not evidence of push infrastructure. No mobile device-token API found; defer actual push pending backend design. No account-deletion API found; release readiness requires a supported account-deletion path and privacy inventory. No standalone mobile payment feature is inferred from earnings/payout fields.

## Slice acceptance matrix

For every row record implementation PR/head, exact route schemas, role and cross-community/owner denials, format/analyze/tests, Android runtime screenshot and iOS runtime screenshot (or explicit blocked status), loading/empty/error/offline/expired session, text scaling/screen-reader/keyboard/back navigation, independent reviewer and manager decision. A mock fixture satisfies unit tests only. Every API write test uses safe nonproduction identities/data. Frontend hiding or client canManageCommunity never substitutes for server authorization.

## Complete web-page index

These pages were enumerated so aliases, invitation flows and internal-only screens remain visible during parity review.

- `/[info]`
- `/admin/access-denied`
- `/admin/join/[grantId]/[[...sign-up]]`
- `/admin`
- `/admin/sign-in/[[...sign-in]]`
- `/app/admin/access`
- `/app/admin/assistant`
- `/app/admin/audit`
- `/app/admin/communications`
- `/app/admin/communities/[communityId]`
- `/app/admin/communities`
- `/app/admin/community-interest`
- `/app/admin/dashboard`
- `/app/admin/profile`
- `/app/admin/providers/[userId]`
- `/app/admin/providers`
- `/app/admin/staff`
- `/app/admin/support/[ticketId]`
- `/app/admin/support`
- `/app/hoa/amenities`
- `/app/hoa/assistant`
- `/app/hoa/dashboard`
- `/app/homeowner/amenities/[amenityId]`
- `/app/homeowner/amenities`
- `/app/homeowner/bidding-room`
- `/app/homeowner/bids`
- `/app/homeowner/chat`
- `/app/homeowner/community`
- `/app/homeowner/dashboard`
- `/app/homeowner/neighbourhood`
- `/app/homeowner/profile`
- `/app/homeowner/request`
- `/app/homeowner/requests`
- `/app/provider/bids`
- `/app/provider/dashboard`
- `/app/provider/earnings`
- `/app/provider/hoa`
- `/app/provider/job-feed`
- `/app/provider/messages`
- `/app/provider/profile`
- `/app/provider/reviews`
- `/app/provider/schedule`
- `/app/support/[ticketId]`
- `/app/support`
- `/auth/continue`
- `/community-onboarding`
- `/get-started/[[...sign-up]]`
- `/get-started/profile`
- `/help/[slug]`
- `/hoa/accept/[invitationId]`
- `/hoa/access-denied`
- `/hoa/invitation-sign-in/[invitationId]/[[...sign-in]]`
- `/hoa/join/[invitationId]/[[...sign-up]]`
- `/hoa/sign-in/[[...sign-in]]`
- `/.`
- `/post-request`
- `/sign-in/[[...sign-in]]`
