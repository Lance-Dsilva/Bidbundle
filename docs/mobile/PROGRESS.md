# Mobile product progress

Snapshot: R01 read-only Requests preparation, 2026-11-01. No percentage is assigned: API routes and web pages are an inventory, not equal-sized completed features.

| Screen / flow | Implemented behavior | Verification limit |
| --- | --- | --- |
| Startup | Invalid/missing config fails closed with a usable explanation | Actual Android/iOS unconfigured launch captured at foundation |
| Sign in / create account | Official native Clerk hosted flow bridges, cancellation/error retry, session renewal/sign-out handling | Native compile + mocked-channel tests; real auth unverified |
| Homeowner Home | Profile/context identity matching; active requests/bids and recorded savings from existing GETs | Source-contract/fixture tests; live data unverified |
| Homeowner Requests | Own-request list, source status/category/budget/bid/date fields, empty/error/retry/refresh; up to100 server rows | Synthetic contract/widget/screenshots only until staging |
| Neighborhood request detail | Separate authorized GET, description/counts/deadlines; platform routes/back; denial never uses list fallback | iOS gesture/scroll/session-race simulations, not native authenticated proof |
| Session isolation in UI | Sign-out/expiry/role/account refresh clears list/detail/navigation; late replies rejected | Deterministic tests, including failed renewal after401; runtime storage/resume still open |
| Legacy HOA request rows | Listed honestly; detail withheld because selected API has no compatible HOA GET | Explicit partial-scope boundary |

## Still unfinished

- Live sign-in/sign-up/verification/renewal/logout, native callbacks/secure storage/resume, real API token acceptance and role/community isolation.
- Homeowner profile completion, address/coverage onboarding, request creation/edit/cancel, joining/participation, bid comparison and lifecycle actions.
- Provider onboarding/verification, marketplace/discovery, bid submission, service areas, scheduling/visits, earnings and reviews.
- Authorized HOA-manager and resident workflows: communities, invitations/units, requests/awards/surveys, amenities/bookings/issues/reviews.
- Account details UI, in-app notifications, messaging and support. Account/notification read contracts have been inspected for the next independent slice; implementation is not claimed here.
- AI assistant/history/memory interfaces. Internal administration is explicitly excluded from the public app; server jobs remain server-only.
- Environment-specific native IDs/flavors, final brand assets/fonts, complete accessibility/performance/offline hardening, real-device journeys, release signing and beta/store handoff.

## Current gate and next slice

Draft PR42 holds the reviewed foundation and read-only preparation. Real Phase1/2 auth gates and all business-write/release gates remain open. Parent Engineering is the first contact for safe staging; its Vercel dashboard access needs the human's manual sign-in before resource verification can continue. A READY Preview and environment-variable target metadata are not proof of isolated services or matching Clerk configuration.

Next eligible independent slice: read-only Account and Recent notifications using existing own-profile/notification GETs; label email verification accurately, preserve server read/unread state, keep links inert until supported native destinations exist, and do not introduce mark-read/push or editing. This remains presentation/contract preparation while live access is unresolved.
