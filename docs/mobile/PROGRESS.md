# Mobile product progress

Snapshot: R05 provider Opportunities preparation, 2026-11-01. No percentage is assigned: API routes and web pages are an inventory, not equal-sized completed features.

| Screen / flow | Implemented behavior | Verification limit |
| --- | --- | --- |
| Startup | Invalid/missing config fails closed with a usable explanation | Actual Android/iOS unconfigured launch captured at foundation |
| Sign in / create account | Official native Clerk hosted flow bridges, cancellation/error retry, session renewal/sign-out handling | Native compile + mocked-channel tests; real auth unverified |
| Homeowner Home | Profile/context identity matching; active request/bid counts from existing GETs; savings display withheld pending currency-aware contract | Source-contract/fixture tests; live data unverified |
| Homeowner Requests | Own-request list, source status/category/budget/bid/date fields, empty/error/retry/refresh; up to100 server rows | Synthetic contract/widget/screenshots only until staging |
| Neighborhood request detail | Separate authorized GET, description/counts/deadlines; platform routes/back; denial never uses list fallback | iOS gesture/scroll/session-race simulations, not native authenticated proof |
| Provider Opportunities | Server-eligible feed with inline description/details; limited candidate catalogue, no bid actions or private awarded-work fields | R05 local review/253tests passed; resulting-head native CI pending |
| Provider Home | Server account status, active bids, active/completed agreements, nullable published rating and decided-bid win rate | R03 independent review,153 tests and exact-head native CI passed; money/trends and inbox deferred |
| Support | Server-authorized recent tickets and customer-visible conversations, native list/detail routes | R04 local review/200tests and exact-head Android/iOS CI passed; long unpaginated threads may exceed1MiB; no writes/attachments/links |
| Account | Own profile, email verification, nullable contact fields and membership date for homeowner/provider/HOA staff | Independent fixture/source review passed; live data unverified |
| Recent notifications | Latest30 server records with read/unread state, text, refresh and native back; links inert | R02 source implementation; no mark-read, dismissal, push or complete-history claim |
| Session isolation in UI | Sign-out/expiry/role/account refresh clears list/detail/navigation; late replies rejected | Deterministic tests, including failed renewal after401; runtime storage/resume still open |
| Legacy HOA request rows | Listed honestly; detail withheld because selected API has no compatible HOA GET | Explicit partial-scope boundary |

## Still unfinished

- Live sign-in/sign-up/verification/renewal/logout, native callbacks/secure storage/resume, real API token acceptance and role/community isolation.
- Homeowner profile completion, address/coverage onboarding, request creation/edit/cancel, joining/participation, bid comparison and lifecycle actions.
- Provider onboarding/verification, marketplace/discovery, bid submission, service areas, scheduling/visits, earnings and reviews.
- Authorized HOA-manager and resident workflows: communities, invitations/units, requests/awards/surveys, amenities/bookings/issues/reviews.
- Profile editing, notification actions and destination routing, device push, messaging and support. Account details and recent notification reading are implemented locally; independent local R02 review passed; resulting-head native CI is pending.
- AI assistant/history/memory interfaces. Internal administration is explicitly excluded from the public app; server jobs remain server-only.
- Environment-specific native IDs/flavors, final brand assets/fonts, complete accessibility/performance/offline hardening, real-device journeys, release signing and beta/store handoff.

## Current gate and next slice

Draft PR42 holds the reviewed foundation and read-only preparation. Real Phase1/2 auth gates and all business-write/release gates remain open. Parent Engineering is the first contact for safe staging; its Vercel dashboard access needs the human's manual sign-in before resource verification can continue. A READY Preview and environment-variable target metadata are not proof of isolated services or matching Clerk configuration.

R02 is checkpointed at d22b291 with106 local tests and independent review; its exact-head native CI result is recorded in the PR handoff. R03 provider overview passed independent local review,153 tests and exact-head native CI. Provider-console errors preserve personal Account access; session expiry clears all private views. Revenue/trends are deferred because the contract can aggregate differing currency strings and caps period rows without completeness metadata. This is a source limitation, not evidence of mixed production data or incorrect customer totals. Parent owns any separate backend contract work. Live access remains unresolved.

R04 reviewed local implementation: customer Support list/detail source contracts prove read-only GETs and server-scoped own/managed-community visibility. Native presentation excludes internal notes/AI draft data, requester emails, staff assignments and unfiltered message counts. Replies are plain text; no actions, attachments or links. Existing1MiB transport limit can reject very long unpaginated conversations; compatible pagination remains separate backend work. Independent code/security/fixture UX review passed;200 full-suite tests, formatter and analyzer passed. Resulting-head native CI remains required.

R05 reviewed local implementation: provider Opportunities uses the server-eligible current feed with inline detail and no direct-ID endpoint, bidding or other mutations. Shared workspace private awarded-work fields are discarded; the existing1MiB cap remains. Request budgets have an explicitUSD source contract; this first feed omits them by scope. Earlier Home savings and lowest-bid monetary displays are now withheld because their summaries lose currency information. This is a contract limitation, not an observed production incident. Independent source/security/fixtureUX review and253 full-suite tests passed; formatter/analyzer clean. Resulting-head native CI remains required.
