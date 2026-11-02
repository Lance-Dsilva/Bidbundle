# Mobile product progress

Snapshot: N04 actual Android navigation evidence, 2026-11-01. No percentage is assigned: API routes and web pages are an inventory, not equal-sized completed features.

| Screen / flow | Implemented behavior | Verification limit |
| --- | --- | --- |
| Startup | Invalid/missing config fails closed with a usable explanation | Development/staging side-by-side unconfigured launches captured on fresh Android/iOS devices |
| Sign in / create account | Official native Clerk hosted flow bridges, cancellation/error retry, session renewal/sign-out handling | Native compile + mocked-channel tests; real auth unverified |
| Homeowner Home | Profile/context identity matching; active request/bid counts from existing GETs; savings display withheld pending currency-aware contract | Source-contract/fixture tests; live data unverified |
| Homeowner Requests | Own-request list, source status/category/budget/bid/date fields, empty/error/retry/refresh; up to100 server rows | Synthetic contract/widget/screenshots only until staging |
| Neighborhood request detail | Separate authorized GET, description/counts/deadlines; platform routes/back; denial never uses list fallback | iOS gesture/scroll/session-race simulations, not native authenticated proof |
| Homeowner Community | Active-membership snapshot, active member count and up to50 current visible request summaries with inline descriptions | R07 reviewed; combined R07/R08 native CI41370634693 passed; no participation/manager actions |
| Provider Published reviews | First20 published reviews and server-wide summary, explicit more-available state; plain reviewer text | R08 reviewed; combined native CI41370634693 passed; no response/moderation or verified badge |
| Provider Service areas | Saved active coverage labels, primary flag, coarse locality, radius/postal coverage and dates; no maps/edits/eligibility inference | R06 reviewed; native CI41369833584 passed |
| Provider Opportunities | Server-eligible feed with inline description/details; limited candidate catalogue, no bid actions or private awarded-work fields | R05 reviewed; native CI41369260469 passed |
| Provider Home | Server account status, active bids, active/completed agreements, nullable published rating and decided-bid win rate | R03 independent review,153 tests and exact-head native CI passed; money/trends and inbox deferred |
| Inbox | Up to100 recent participant conversations and latest50-message transcript, fresh authorized reads; no send/read receipts | R09 reviewed; native CI41371209164 passed |
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
- Confirmed external native registrations, final brand assets/fonts, complete accessibility/performance/offline hardening, real-device journeys, release signing and beta/store handoff.

## Current gate and next slice

Draft PR42 holds the reviewed foundation and read-only preparation. Real Phase1/2 auth gates and all business-write/release gates remain open. Parent Engineering is the first contact for safe staging; its Vercel dashboard access needs the human's manual sign-in before resource verification can continue. A READY Preview and environment-variable target metadata are not proof of isolated services or matching Clerk configuration.

R02 is checkpointed at d22b291 with106 local tests and independent review; its exact-head native CI result is recorded in the PR handoff. R03 provider overview passed independent local review,153 tests and exact-head native CI. Provider-console errors preserve personal Account access; session expiry clears all private views. Revenue/trends are deferred because the contract can aggregate differing currency strings and caps period rows without completeness metadata. This is a source limitation, not evidence of mixed production data or incorrect customer totals. Parent owns any separate backend contract work. Live access remains unresolved.

R04 reviewed local implementation: customer Support list/detail source contracts prove read-only GETs and server-scoped own/managed-community visibility. Native presentation excludes internal notes/AI draft data, requester emails, staff assignments and unfiltered message counts. Replies are plain text; no actions, attachments or links. Existing1MiB transport limit can reject very long unpaginated conversations; compatible pagination remains separate backend work. Independent code/security/fixture UX review passed;200 full-suite tests, formatter and analyzer passed. Resulting-head native CI remains required.

R05 reviewed local implementation: provider Opportunities uses the server-eligible current feed with inline detail and no direct-ID endpoint, bidding or other mutations. Shared workspace private awarded-work fields are discarded; the existing1MiB cap remains. Request budgets have an explicitUSD source contract; this first feed omits them by scope. Earlier Home savings and lowest-bid monetary displays are now withheld because their summaries lose currency information. This is a contract limitation, not an observed production incident. Independent source/security/fixtureUX review and253 full-suite tests passed; formatter/analyzer clean. Resulting-head native CI remains required.

R06 reviewed locally:300 full-suite tests, formatter/analyzer and independent code/security/fixtureUX review passed. Service areas use the dedicated owner-scoped GET and drop exact coordinates/addresses. Unused savings/best-bid fields are removed from mobile DTOs; retained USD budgets remain validated. Native resulting-head CI remains required.

R07 reviewed locally:343 tests, clean formatter/analyzer and independent source/security/fixtureUX acceptance. Community/null/empty states stay distinct, requests are bound to returned community, private nested data dropped. Large-text heading refined and all affected homeowner captures refreshed for4-tab navigation. Live membership revocation/privacy and resulting-head CI remain separate.

R08 reviewed locally:391 full-suite tests, clean formatter/analyzer and independent code/security/fixtureUX acceptance. Published reviews are first-page only with server summary; no derived page averages or invented verification/anonymity. Next native verification will target the combined pushed R07/R08 head, not falsely certify intermediate commits.

R09 reviewed locally:441 full-suite tests, clean formatter/analyzer and independent code/security/fixture UX acceptance. Inbox uses trusted role-specific customer/provider reads and strict thread/message binding. No send, mark-read, identity lookup or links. Five captures reviewed; current Account captures refreshed. Live participant isolation and combined-head native CI remain separate.

Next priority after the Inbox checkpoint: usable native test-build prerequisites, per parent Engineering. Assess environment-specific identities/callback binding, local assets/fonts and native fixture UI/navigation/accessibility evidence without live accounts; choose one bounded implementation slice. R10 quote source discovery is backlog only, not an implementation commitment. Provisional identifiers remain unconfirmed and no external registration/settings change is authorized.

N01 independently reviewed locally: 467 full-suite tests, clean formatter/analyzer, eight compiled startup scenarios and four native development/staging builds passed. Provisional application IDs and labels coexist on fresh task-owned Android/iOS devices; screenshots and effective metadata are in evidence/native-isolation. Devices were cleaned up. No-config entrypoints fail closed before auth/network construction. SDK source audit records flavor-derived callbacks and private storage defaults; real cross-flavor session persistence remains unverified. Resulting-head four-job CI and engineering artifact upload remain pending.

Prior checkpoint R09 commit 8ffca3595b44ad635dddc28fef9a1745c087c3ee passed exact-head CI41371209164 (macOS125041867425, Ubuntu125041867587), including both native builds. This does not certify the new N01 configuration.

N01 exact-head CI41372909197 passed all four native jobs and artifact uploads at 741b13d54368a172d1e681a613faae172f7246b2. N02 native fixture journeys are approved and in progress, with acceptance matrix in PLAN.md. They will validate synthetic native rendering/navigation only; no live or screen-reader acceptance is inferred.

N02 corrected source 4ac16367ed04206ea76cebecb15a72423c807bdb passed five scenarios on each actual task-owned Android/iOS runtime, covering two roles at 100%/200% and guard self-checks. Initial failed harness source 5efbb41 is not accepted evidence. Test-only fixes addressed scrolling/lazy finders and cleanup; no production source changes. Native synthetic captures and final review are under evidence/native-fixtures. Exact pushed-head CI remains required. Tester BackButton taps and semantics assertions do not prove OS input or assistive-technology operation.

N03 adds the approved canonical company mark to native headers and deterministic launcher assets, retaining platform fonts and provisional flavor identities. Service areas now places errors/Retry above compact read-only/no-eligibility disclosures. Source 15a88ee5075f7eb47f78b7c72f4a26c00334e2d2 passed two affected scenarios on each native platform at 100%/200%, all four normal builds and both OS launcher reviews; independent source/asset reproduction passed. Independent evidence review and 467 regression tests passed, analyzer clean and 62 formatted files unchanged. Resulting-head CI remains pending. No live, screen-reader or release acceptance is implied.

N04 Android system Back is independently exercised at 100%/200% on source b2b6aec: Requests detail, Inbox detail/list, Account-to-Home and separate signed-out Activity exit. Guards/private-state assertions precede process exit; no persisted-session proof. iOS actual edge gestures remain blocked by unavailable locked-host UI control. Semantics metadata is not screen-reader traversal. 467 local tests passed; source-only first-write tracing identifies best-effort dedupe and postcommit ambiguity, with no business writes or server changes. Native and live gates are not fully closed; final evidence CI is pending.
