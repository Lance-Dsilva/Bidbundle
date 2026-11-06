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

N04 iOS actual-input remains open after unlock: inventory worked and the fresh simulator booted, but documented Simulator control hung twice and was stopped. The task runtime was removed; no iOS app run or input occurred. Prepared test-only receipt/post-input assertions do not close this gate. Parent owns any next concrete tooling/access prerequisite; no more optional preparation phase or live work is started.

N04 public XCTest prototype compiled/launched without credentials, but both original and one corrected controlled attempt failed readiness before any gesture. Corrected source01bacee proves Dart READY/local semantics and matching native PID, while XCTest sees no Flutter accessibility descendants. This establishes a native accessibility-discovery gap, not a product navigation defect or successful iOS input. Full matrix/signed-out and live gates remain open; no more retry started.


## N04 pointer forwarding checkpoint — 2026-11-05

Previous source `08f3b245c4afee62df5a9f18e3e1a6ca4c7d2820` exposed the genuine Flutter accessibility marker and delivered one public XCTest edge drag, but no Dart destination was observed. It remains failed/partial; separate evidence is preserved under `evidence/native-xcui-prototype/semantics-forwarding`. The old task simulator and processes are gone and both normal flavor configurations were verified as `lib/main.dart`. The anomalous reported build elapsed time is retained without claiming a bounded wall duration.

The approved next correction changes only the integration-test entrypoint: save the binding's device-pointer propagation value, enable it inside the protected body, log/assert it at ready, and restore it first in unconditional cleanup. Independent review accepted the source; no product, SDK or native-host change. One fresh 100% Requests detail-to-list XCTest run is authorized after exact source checkpoint, with one initial launch, bounded watchdogs and no retry. Native input and same-engine Dart destination are both required. Full matrix/signed-out, isolated staging/live auth, business writes and release remain gated.

The return message to the Engineering chat remains blocked by automatic approval review pending direct human confirmation in this chat. Do not retry or relay around that restriction; ordinary repository/test work continues.


### N04 bounded resume stopped before runtime — 2026-11-05

Reviewed source checkpoint `447783746f809d4b1363ee78a57e5b97d6488da6` passed analyzer, formatting/diff checks and 29 focused Requests tests. The one fresh attempt stopped before configuration/build/launch: automatic approval review encountered a stream-disconnected transport/response-decoding error and explicitly reported the configuration action was not executed. This is a service failure, not an unsafe-action determination or a native test failure. Per the bounded-resume instruction, no retry occurred.

The newly created task simulator `A03C2862-A90C-40E3-9931-CDD29A2108ED` was shut down and deleted; boot/cleanup sessions completed. Read-only verification confirms Generated.xcconfig and flutter_export_environment.sh still target `lib/main.dart`; neither was changed by the refused command. There is no app launch, native input or destination evidence for `4477837`. The pointer correction is source-reviewed but runtime-unverified. Resume requires a new explicit bounded assignment after service availability; full matrix and live gates remain open.


## N04 one-route prototype passed — 2026-11-05

A newly authorized single configuration attempt passed normal automatic approval and completed before simulator creation. Exact runtime checkpoint `933a1532ea5ccae25938cf897e31c587a5c99d20` has identical mobile source to reviewed `447783746f809d4b1363ee78a57e5b97d6488da6`. One fresh iPhone17/iOS26.4.1 simulator, one initial XCTest launch and one actual public edge drag passed the 100% homeowner Requests detail-to-list prototype. Genuine native ready/observed markers matched nonce1793892858912970, PID36787 and isolate5144479952354159. The observed marker is gated by independent Dart destination/model/foreground/guard assertions; screenshots confirm detail then list. Standalone Dart console and completed teardown proof are unavailable and not claimed.

Independent reviewer accepted this bounded result; manager verified all14 evidence hashes in `evidence/native-xcui-prototype/pointer-forwarding-passed`. Prior failed/partial and service-blocked evidence remains separate. Config/build/test exited0 within monotonic watchdog deadlines; anomalous wall-clock divergence is preserved without inferring a cause or bounded wall duration. Exact task simulator7346B9BE-510B-440B-8142-1309F0D973BF and owned processes were cleaned up. Both normal development/staging configurations were explicitly regenerated and config/export targets verified as lib/main.dart. No unchanged Android/N02/N03 runtime matrix was repeated.

Exact runtime source933a153 already passed normal four-job CI42023666940. This accepts only the single synthetic100%Requests prototype; full100%/200%navigation, signed-out, screen-reader, real-device and live-auth gates remain open. Next scope requires manager review. Return cross-chat handoff remains separately blocked pending direct human authorization; no retry or relay attempted.


### Full iOS matrix first run — failed/partial

Exactsource39c0dd3323aa6770d5da5962bc212380437ab6a3 passed independent code/security review, analyzer/format/Swift typecheck and29focused tests. The single approved native run delivered three100%XCTestdrags in one engine. Requests detail→list and Inbox conversation→list passed same-identity observed checkpoints. Inbox list→Account completed DEVICE down/move/up but failed a Dart destination finder for top Account helper copy; no step3observed acceptance. Signed-out,200%and finalcomplete were not reached. No retry or code correction followed.

Available Dart log distinguishes the assertion failure from input/semantics failure; subsequent missing marker/black capture followed fixture teardown and is not evidence of a product black screen. Source diagnosis suggests the preserved Account scroll offset and lazy construction can omit the top helper from the finder tree. A proposed future test-only correction would assert Account route/widget and absent Inbox route/clearedstate without requiring offscreen copy; this needs manager review and is not implemented.

Evidence is preserved in evidence/native-xcui-matrix/first-run, including3native deliveries,2native-captured DEVICE summaries,6screenshots and sanitized step3failure facts. Independent review complete; exact simulator6283FABD-C0C6-44C1-98C2-A279DF16A9D4/processes removed and both normalflavor config/export targets explicitly regenerated and verified lib/main.dart. Resulting-head normalCI remains required. Prior evidence preserved; fullmatrix/live/write/releasegates remain open. Returncross-chat handoff remains separately blocked.


### Account correction matrix result — 2026-11-06, failed/partial

Reviewed source b0c815baf5e0518333dd29bf0943a20ac526c527 passed two independently executed retained-scroll widget regressions at100%/200%, analyzer and formatting. The old Account helper omission was reproduced in widget tests and replaced with current visible Account route/page/render plus cleared Inbox assertions. The native run accepted all four100%checkpoints, including Account return and actual signed-out DEVICE input followed by two-second settling and explicit same-engine cleared private state. This remains synthetic auth/API evidence, not Clerk persistence.

Step5 at200% completed actual native input and DEVICE sequence but failed the exact Your requests text finder. Five deliveries, four accepted destinations/native DEVICE summaries, ten captures; no accepted200%destination or finalcomplete. Prior first-run evidence preserved separately; new evidence at evidence/native-xcui-matrix/account-correction-run. Source inspection suggests Requests retained scroll/lazy header is a similar assertion issue, not a proven product failure. Proposed future review: visible Requests route/page checks with retained-scroll regression, plus audit analogous Inbox header assertion. No further fix/retry performed.

Task simulator5216ED9D-02CD-4DD8-AA4E-F98B7A6507CB and owned processes removed; both normalflavor config/export targets restored to lib/main.dart using the restored identical pinned SDK. Resulting-head normal CI remains required. Fullmatrix/live/business-write/release gates and separate cross-chat return authorization block remain open.
