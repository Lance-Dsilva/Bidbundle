# Mobile API contract discovery

Baseline `fb4a245721ffdd69dd0255c0ef021e6b6fbb08ed`, inspected 2026-11-01. Static source evidence, not live-auth certification. Use existing HTTPS backend; no duplicate backend/direct Postgres.

## Exact first-slice contracts

- `GET /api/profile`: no body/query. 200 object: id,email,fullName,role strings; isVerified boolean; phone,address,neighborhood,avatarUrl,avatarUpdatedAt nullable strings; latitude,longitude nullable numbers; createdAt ISO timestamp; communityRadiusMi number. Roles homeowner/provider/hoa_staff/admin. Source `src/lib/server/profile.ts::serializeCommonProfile`.
- `GET /api/me/context`: no body/query. 200: userId,fullName,initials,email,role,roleLabel strings; avatarUrl/providerStatus nullable; assignments[] with communityId,communityName,communityType,role,roleLabel; communities[] with communityId,communityName,communityType,status,isPrimary; canManageCommunity boolean. Source `src/lib/server/communities.ts::resolveViewerContext`. Display/navigation only; server rechecks permissions per operation.
- `GET /api/homeowner/dashboard`: homeowner-only, no body/query. 200 `{cold_start:boolean,active_requests:number,active_bids:number,total_saved_cents:number}`. Every aggregate is scoped to authenticated owner. Savings sums nonnegative budget-max minus agreement amount, not advertised discounts. Source `src/lib/server/homeowner-requests.ts::getHomeownerDashboard`.

Shared `authorizeRequest` handler errors: 401 authentication required, 409 incomplete Bundleen profile, 403 wrong role/inactive admin grant, 500 database lookup failure, each `{error:string}`. Profile additionally 404; dashboard 500 includes reference. All three GETs force dynamic; no pagination or direct rate-limit guards. Middleware calls auth.protect() for /api/me and /api/auth: actual unauthenticated status/content type must be tested; do not assume handler JSON always reaches mobile.

Proposed live slice: Clerk sign-in → profile → viewer context → homeowner dashboard → sign-out and protected-read rejection. Native Bearer acceptance, refresh, revoked tokens and middleware behavior remain staging gates, not proven by source inspection.

## Mutations and domain boundaries

POST /api/auth/profile is onboarding, not login. Requires Clerk identity, JSON and bounded body (MAX_AUTH_BODY_BYTES), validates onboardingProfileSchema in src/lib/validation/profile.ts, derives verified email from Clerk, retains existing database role, rejects suspended providers. Returns `{profileReady:true,role,redirectTo}`; errors include 400 fields, 401,403,409,413,415,429,503,500. Map known web redirectTo destinations to native navigation.

PATCH /api/profile uses strict commonProfileUpdateSchema; email/role/isVerified rejected. GET /api/homeowner/requests returns `{requests,eligibility}`; handler permits any profiled identity, service derives eligibility. POST uses strict createHomeownerRequestSchema: title 1–120, description 1–4000 after normalization, category from service-category vocabulary, budgetMinCents/budgetMaxCents integers 0–100000000 and max>=min. No owner/community/status fields; max body 32768 bytes. Success 201 `{request}`; workflow failure `{error,reason}` with domain status. List cap 100, no exposed cursor.

GET /api/provider/marketplace requires provider and returns `{workspace}` from getProviderHoaWorkspace (coverage, eligible feed, own bids, won agreements, day plans). Role alone is not bidding eligibility. Customer inbox requires homeowner/hoa_staff; GET lists participant-scoped threads; POST startCustomerConversationSchema uses bidId and returns 201 `{thread}` for an eligible quote. Never address arbitrary users by id.

GET /api/me/notifications returns `{notifications}` (default latest 30, no cursor); POST marks all caller notifications read, `{ok:true}`. This is not mobile push. POST /api/ai/chat uses aiChatMessageSchema, max body 4096 bytes, per-account AI limiter; response application/x-ndjson with delta/tool/done/error events. Handle partial chunks/cancellation/errors; history and memory are separate APIs.

Auth resolves Clerk identity to a live database profile. hoa-api gates homeowner/hoa_staff or provider; domain services enforce membership, owner, eligibility and manager grants. hoa_staff alone gives no management authority. Homeowner managers are restricted to their live assigned community. Award/provider selection and price decisions remain server-owned. Owner transitions, manager award/close and provider planning/visit status are distinct state-machine operations; do not infer transitions in Flutter.

Guard failures: 429 with Retry-After or 503 when limiter unavailable. Canonical quotas src/lib/server/rate-limit.ts: registration 20/15min; HOA mutations 60/5min; endpoint-specific AI/support/media/broadcast buckets. Production fails closed on missing limiter. Do not retry ambiguous writes automatically: no universal idempotency key contract found.

## Gaps and required follow-up

Native auth/middleware must be proved with isolated staging and safe identities; none established here. No versioned OpenAPI/Dart contract exists. First-slice DTOs above are implementable; later slices must expand referenced schema and service types into exact fixtures before coding. Inventory below is exhaustive at route level, not a claim of exhaustive payload review. Pagination is inconsistent: requests capped 100, notifications 30, conversation service limits/offsets are not automatically public query parameters. No push registration/delivery or account deletion API route found. HOA invitation accept/join and Clerk continuation use server-rendered pages and need reviewed native deep links/contracts. Multipart uploads require route-specific size/content/ownership tests. All admin/jobs APIs excluded from public mobile.

## Complete route inventory

Generated from exported handlers in every src/app/api/**/route.ts. References are direct schema/guard identifiers; nested service authorization still requires slice review.

| Path | Methods | Direct schema/guard references |
|---|---|---|
| `/api/admin/access/[grantId]/permissions` | PUT | adminPermissionsSchema, requireAdminOwnerMutation |
| `/api/admin/access/[grantId]` | DELETE | requireAdminOwnerMutation |
| `/api/admin/access` | GET, POST | adminAccessGrantSchema, requireAdminOwnerMutation |
| `/api/admin/audit` | GET | auditListQuerySchema |
| `/api/admin/communications/broadcasts/[broadcastId]/retry` | POST | guardBroadcastMutation, guardFailureResponse, requireAdminPermissionMutation |
| `/api/admin/communications/broadcasts/[broadcastId]` | GET, PUT, DELETE | broadcastDraftSchema, requireAdminPermissionMutation |
| `/api/admin/communications/broadcasts/[broadcastId]/send` | POST | broadcastSendSchema, guardBroadcastMutation, guardFailureResponse, requireAdminPermissionMutation |
| `/api/admin/communications/broadcasts/[broadcastId]/test` | POST | guardBroadcastMutation, guardFailureResponse, requireAdminPermissionMutation |
| `/api/admin/communications/broadcasts` | GET, POST | broadcastDraftSchema, requireAdminPermissionMutation |
| `/api/admin/communications/preview` | POST | previewSchema |
| `/api/admin/communities/[communityId]/candidates` | GET | inspect handler/service |
| `/api/admin/communities/[communityId]/hoa-profile` | GET, PUT, PATCH | hoaOnboardingStatusSchema, hoaProfileSchema, requireAdminMutation |
| `/api/admin/communities/[communityId]/manager-invitations/[invitationId]` | DELETE | requireAdminMutation |
| `/api/admin/communities/[communityId]/manager-invitations` | GET, POST | hoaManagerInvitationCreateSchema, requireAdminMutation |
| `/api/admin/communities/[communityId]/members/[membershipId]` | PATCH, DELETE | membershipUpdateSchema, requireAdminMutation |
| `/api/admin/communities/[communityId]/members` | POST | membershipCreateSchema, requireAdminMutation |
| `/api/admin/communities/[communityId]` | GET, PATCH | communityUpdateSchema, requireAdminMutation |
| `/api/admin/communities/[communityId]/staff/[assignmentId]` | DELETE | requireAdminMutation, staffRevokeSchema |
| `/api/admin/communities/[communityId]/staff` | POST | requireAdminMutation, staffAssignSchema |
| `/api/admin/communities/[communityId]/units/[unitId]` | PATCH, DELETE | requireAdminMutation, unitUpdateSchema |
| `/api/admin/communities/[communityId]/units/import` | POST | requireAdminMutation, unitImportSchema |
| `/api/admin/communities/[communityId]/units` | GET, POST | requireAdminMutation, unitCreateSchema |
| `/api/admin/communities` | GET, POST | communityCreateSchema, communityListQuerySchema, requireAdminMutation |
| `/api/admin/community-interest` | GET | communityInterestListQuerySchema |
| `/api/admin/geocode` | POST | addressSearchSchema, requireAdminMutation |
| `/api/admin/homeowners` | GET | inspect handler/service |
| `/api/admin/overview` | GET | inspect handler/service |
| `/api/admin/providers/[userId]` | GET, PATCH | providerAdminUpdateSchema, providerProfileUpdateSchema, requireAdminMutation |
| `/api/admin/providers/[userId]/tickets` | POST | adminProviderTicketCreateSchema, requireAdminMutation |
| `/api/admin/providers` | GET | providerListQuerySchema |
| `/api/admin/staff/[grantId]` | DELETE | requireAdminPermissionMutation |
| `/api/admin/staff` | GET, POST | adminAccessGrantSchema, requireAdminPermissionMutation |
| `/api/admin/support/tickets/[ticketId]/ai-draft` | GET, POST, PUT, DELETE | aiDraftApprovalSchema, aiDraftDiscardSchema, guardFailureResponse, guardSupportAi, requireAdminMutation |
| `/api/admin/support/tickets/[ticketId]/ai-explanation` | GET, POST | guardFailureResponse, guardSupportAi |
| `/api/admin/support/tickets/[ticketId]/messages` | POST | adminTicketMessageSchema, requireAdminMutation |
| `/api/admin/support/tickets/[ticketId]` | GET, PATCH | adminTicketUpdateSchema, requireAdminMutation |
| `/api/admin/support/tickets` | GET | adminTicketQuerySchema |
| `/api/ai/chat` | POST | aiChatMessageSchema, requireAiChatMutation |
| `/api/ai/history` | GET | requireAiUser |
| `/api/ai/memory` | DELETE | requireAiUser |
| `/api/auth/me` | GET | authorizeRequest |
| `/api/auth/profile` | POST | guardFailureResponse, guardRegistration, onboardingProfileSchema |
| `/api/community-interest` | POST | communityInterestSchema, guardCommunityInterest |
| `/api/hoa/agreements/[agreementId]/review` | POST | requireHoaMutation, reviewCreateSchema |
| `/api/hoa/amenities/[amenityId]/availability` | GET | availabilityQuerySchema |
| `/api/hoa/amenities/[amenityId]/bookings` | POST | bookingCreateSchema |
| `/api/hoa/amenities/[amenityId]/closures/[closureId]` | DELETE | inspect handler/service |
| `/api/hoa/amenities/[amenityId]/closures` | POST | amenityClosureSchema |
| `/api/hoa/amenities/[amenityId]/gallery` | POST | amenityCoverSchema, amenityGalleryOrderSchema |
| `/api/hoa/amenities/[amenityId]/issues` | POST | issueCreateSchema |
| `/api/hoa/amenities/[amenityId]/photos` | POST | inspect handler/service |
| `/api/hoa/amenities/[amenityId]/reviews` | GET, POST | amenityReviewSchema, reviewListQuerySchema |
| `/api/hoa/amenities/[amenityId]` | GET, PATCH | amenityUpdateSchema |
| `/api/hoa/amenities/[amenityId]/status` | POST | amenityStatusSchema |
| `/api/hoa/amenities/bookings/[bookingId]/cancel` | POST | bookingCancelSchema |
| `/api/hoa/amenities/bookings/[bookingId]/decision` | POST | managerBookingDecisionSchema |
| `/api/hoa/amenities/bookings/[bookingId]/reschedule` | POST | bookingRescheduleSchema |
| `/api/hoa/amenities/bookings` | GET | inspect handler/service |
| `/api/hoa/amenities/broadcast` | POST | amenityBroadcastSchema |
| `/api/hoa/amenities/issues/[issueId]/messages` | POST | issueMessageSchema |
| `/api/hoa/amenities/issues/[issueId]/photos` | POST | inspect handler/service |
| `/api/hoa/amenities/issues/[issueId]` | GET, PATCH | issueUpdateSchema, issueWithdrawSchema |
| `/api/hoa/amenities/issues` | GET | inspect handler/service |
| `/api/hoa/amenities/manager` | GET | inspect handler/service |
| `/api/hoa/amenities/media/[mediaId]` | GET, DELETE | inspect handler/service |
| `/api/hoa/amenities/reviews/[reviewId]/moderate` | POST | reviewModerationSchema |
| `/api/hoa/amenities/reviews/[reviewId]/photos` | POST | inspect handler/service |
| `/api/hoa/amenities/reviews/[reviewId]/response` | POST | reviewResponseSchema |
| `/api/hoa/amenities/reviews/[reviewId]` | PATCH, DELETE | amenityReviewSchema |
| `/api/hoa/amenities` | GET, POST | amenityCreateSchema |
| `/api/hoa/communities/[communityId]/invitations/[invitationId]` | DELETE | requireHoaMutation |
| `/api/hoa/communities/[communityId]/invitations` | POST | hoaResidentInvitationCreateSchema, requireHoaMutation |
| `/api/hoa/communities/[communityId]/requests` | POST | hoaRequestCreateSchema, requireHoaMutation |
| `/api/hoa/communities/[communityId]/surveys` | POST | hoaSurveyCreateSchema, requireHoaMutation |
| `/api/hoa/communities/[communityId]/units/[unitId]` | PATCH | requireHoaMutation, unitUpdateSchema |
| `/api/hoa/communities/[communityId]/units` | GET, POST | requireHoaMutation, requireHoaUser, unitCreateSchema |
| `/api/hoa/occurrences/[occurrenceId]/close` | POST | emptyMutationSchema, requireHoaMutation |
| `/api/hoa/requests/[requestId]/award` | POST | awardSchema, requireHoaMutation |
| `/api/hoa/requests/[requestId]/bids` | GET | requireHoaUser |
| `/api/hoa/requests/[requestId]/join` | POST | participationResponseSchema, requireHoaMutation |
| `/api/hoa/requests/[requestId]` | PATCH | hoaRequestTransitionSchema, requireHoaMutation |
| `/api/hoa/surveys/[surveyId]` | PATCH | hoaSurveyStatusSchema, requireHoaMutation |
| `/api/hoa/surveys/[surveyId]/vote` | POST | hoaSurveyVoteSchema, requireHoaMutation |
| `/api/hoa/visits/[visitId]/review` | POST | requireHoaMutation, reviewCreateSchema |
| `/api/homeowner/bids` | GET | requireHoaUser |
| `/api/homeowner/dashboard` | GET | authorizeRequest |
| `/api/homeowner/inbox/[threadId]/messages` | POST | conversationMessageSchema, requireHoaMutation |
| `/api/homeowner/inbox/[threadId]/read` | POST | requireHoaMutation |
| `/api/homeowner/inbox/[threadId]` | GET | requireHoaUser |
| `/api/homeowner/inbox` | GET, POST | requireHoaMutation, requireHoaUser, startCustomerConversationSchema |
| `/api/homeowner/neighbourhood` | GET | requireHoaUser |
| `/api/homeowner/requests/[requestId]/award` | POST | neighborhoodAwardSchema, requireHoaMutation |
| `/api/homeowner/requests/[requestId]/participation` | POST | participationSchema, requireHoaMutation |
| `/api/homeowner/requests/[requestId]` | GET, PATCH | ownerRequestMutationSchema, requireHoaMutation, requireHoaUser |
| `/api/homeowner/requests/[requestId]/transition` | POST | neighborhoodTransitionSchema, requireHoaMutation |
| `/api/homeowner/requests` | GET, POST | authorizeRequest, createHomeownerRequestSchema, guardFailureResponse, guardHoaMutation |
| `/api/jobs/outbox` | GET, POST | inspect handler/service |
| `/api/jobs/reminders` | GET, POST | inspect handler/service |
| `/api/me/context` | GET | authorizeRequest |
| `/api/me/managed-communities` | GET | authorizeRequest |
| `/api/me/notifications/[notificationId]` | POST, DELETE | authorizeRequest |
| `/api/me/notifications` | GET, POST | authorizeRequest |
| `/api/onboarding/coverage` | POST | guardOnboardingCoverage, onboardingCoverageSchema |
| `/api/profile/avatar` | POST, DELETE | authorizeRequest, guardAvatarUpload, guardFailureResponse |
| `/api/profile/homeowner` | GET, PATCH | authorizeRequest, homeownerProfileUpdateSchema |
| `/api/profile/provider` | GET, PATCH, PUT | authorizeRequest, providerFullUpdateSchema, providerProfileUpdateSchema |
| `/api/profile` | GET, PATCH | authorizeRequest, commonProfileUpdateSchema |
| `/api/provider/inbox/[threadId]/messages` | POST | conversationMessageSchema, requireProviderConsoleMutation |
| `/api/provider/inbox/[threadId]/read` | POST | requireProviderConsoleMutation |
| `/api/provider/inbox/[threadId]` | GET | inspect handler/service |
| `/api/provider/inbox` | GET, POST | requireProviderConsoleMutation, startConversationSchema |
| `/api/provider/marketplace/earnings` | GET | requireProviderUser |
| `/api/provider/marketplace/occurrences/[occurrenceId]/plan` | POST | dayPlanSchema, requireProviderMutation |
| `/api/provider/marketplace/requests/[requestId]/bid` | PUT, DELETE | bidSubmitSchema, requireProviderMutation |
| `/api/provider/marketplace` | GET | requireProviderUser |
| `/api/provider/marketplace/service-areas/[areaId]` | PUT, DELETE | requireProviderMutation, serviceAreaSchema |
| `/api/provider/marketplace/service-areas` | POST | requireProviderMutation, serviceAreaSchema |
| `/api/provider/marketplace/visits/[visitId]/status` | POST | requireProviderMutation, visitStatusSchema |
| `/api/provider/overview` | GET | inspect handler/service |
| `/api/provider/ratings` | GET | inspect handler/service |
| `/api/provider/service-areas/[areaId]` | PUT, DELETE | providerServiceAreaSchema, requireProviderMutation |
| `/api/provider/service-areas` | GET, POST | providerServiceAreaSchema, requireProviderMutation, requireProviderUser |
| `/api/support/tickets/[ticketId]/messages` | POST | customerReplySchema, requireSupportMutation |
| `/api/support/tickets/[ticketId]/reopen` | POST | customerReplySchema, requireSupportMutation |
| `/api/support/tickets/[ticketId]` | GET | requireSupportUser |
| `/api/support/tickets` | GET, POST | createTicketSchema, requireSupportMutation, requireSupportUser |

## Bounded Phase 3 preparation: homeowner request browsing (read-only)

Inspected 2026-11-01 after foundation head `249ed4f`. This section authorizes DTO/UI preparation only; live Phase 2 gates remain open. No create/edit/join/award/transition action belongs to this browsing slice.

### List: GET /api/homeowner/requests

No request body, query, owner id, cursor or filter. Handler calls authorizeRequest() with no role argument. HTTP 200 `{requests: HomeownerRequestView[], eligibility: HomeownerRequestEligibility}`. `listHomeownerRequests(sessionUser.id)` filters createdByUserId, orders createdAt descending and takes at most 100. Do not invent infinite scrolling or claim the result is an uncapped history. The filter itself does not restrict community type: context can be hoa or neighborhood for existing/legacy owned rows. It does not recheck membership for each listed record.

HomeownerRequestView required keys:

| Keys | Wire type / meaning |
|---|---|
| id,title,category,categoryLabel,description,status,communityId,communityName | string |
| context | `neighborhood` or `hoa` |
| budgetMinCents,budgetMaxCents,bestBidCents | integer or null; whole US cents; legacy budgets may be null |
| bidCount | integer, count of ALL related bids, unlike detail count |
| enrollmentClosesAt | ISO timestamp string or null |
| createdAt,updatedAt | ISO timestamp strings |

BestBidCents is cheapest submitted/accepted bid only; null means none. Do not compute a discount or treat it as an awarded amount. categoryLabel falls back to raw category if not recognized. Status vocabulary currently draft,collecting_interest,open_for_bids,bidding_closed,awarded,scheduled,in_progress,completed,cancelled,failed; keep unknown status display safe without granting actions.

Eligibility is a discriminated union: `{canCreate:true,communityId:string,communityName:string}` OR `{canCreate:false,reason:string,message:string,actionLabel:string,actionPath:string}`. Reasons: wrong_role,hoa_resident,membership_pending,no_profile_location,no_community. Eligibility refusal is still HTTP 200, not a list failure. The message is server-owned. Action paths currently homeowner community/profile, provider dashboard or admin dashboard; whitelist native destinations, never blindly launch a server string or expose public admin navigation. For hoa_staff wrong_role currently uses admin dashboard fallback, so do not infer role from actionPath.

Eligibility checks role homeowner; active HOA membership takes priority over neighborhood; pending neighborhood blocks; active neighborhood plus routeable address enables creation; missing address or no coverage remains blocked. For this read-only slice canCreate is explanatory, not permission to add a create button without its separate reviewed flow.

Errors: shared 401,403 where applicable,409 missing Bundleen profile,500 profile lookup. List service exception is 500 `{error:"We could not load your requests. Please try again.",reference:string}`. No direct read limiter. Force-dynamic. Sources: src/app/api/homeowner/requests/route.ts; src/lib/server/homeowner-requests.ts (HomeownerRequestView, serialize, listHomeownerRequests, getRequestEligibility).

### Detail: GET /api/homeowner/requests/{requestId}

This is NOT the list DTO nor the internal getHomeownerRequest helper. Handler calls requireHoaUser() (homeowner or hoa_staff), then getNeighborhoodRequest(user.id,requestId). HTTP 200 `{request:NeighborhoodRequestView}`. Only neighborhood records are supported, with exact-community ACTIVE membership and active community. Missing row, HOA row, or another user's draft: 404 `{error:"That service request does not exist."}`. Nonmember/pending/removed membership or archived community: 403 `{error:"You do not have access to this neighbourhood request."}`. Other domain errors use hoaErrorResponse; generic service failure 500 `{error:string}`. Shared auth/profile errors still apply. GET has no mutation guard/rate limit, body or query.

Never use the owned-list payload as a detail authorization fallback after 403/404. Existing HOA/legacy owner rows in list must not be sent to this neighborhood-only detail as though supported; show an honest unsupported detail state or route to separately implemented HOA community flow. `/api/hoa/requests/{id}` exports PATCH only, no GET; do not invent an HOA detail GET. `/api/homeowner/neighbourhood` is the neighborhood hub, a different endpoint.

NeighborhoodRequestView required keys:

| Keys | Wire type |
|---|---|
| id,communityId,communityName,title,category,categoryLabel,description,status,createdByName,createdAt | string; createdAt ISO timestamp |
| budgetMinCents,budgetMaxCents,maxHomes | integer or null |
| minHomes,totalOccurrences,joinedCount,declinedCount,bidCount | integer; minHomes serialized fallback 1 |
| enrollmentClosesAt,biddingClosesAt,participantsLockedAt,awardedAt,startDate | ISO timestamp string or null |
| viewerResponse | joined,declined or null |
| isOwner | boolean |
| permissions | object: canRespond,canManage,canViewBids,canEdit booleans |
| bids | BidSummary[] or null |
| participants | NeighborhoodParticipant[] or null |
| agreement | AgreementSummary or null |
| myVisits | VisitSummary[] |
| occurrences | OccurrenceSummary[] or null |

There is NO detail context, updatedAt or bestBidCents key. Detail bidCount counts submitted/accepted/rejected; list bidCount counts all bids, so do not assert equality. Permissions are server-derived presentation hints, never authorization. canManage is the assigned neighborhood manager (NOT owner fallback). canViewBids includes manager, owner or joined participant. canRespond requires open unlocked enrollment and not owner. canEdit requires homeowner creator, optional_group, draft/collecting_interest, no lock/agreement/bid.

Bids may be null even when canViewBids=true: serializer catches listRequestBids failures to null. Null is unavailable/not included, not zero bids. Participants contains manager-only `{userId:string,displayName:string,addressReady:boolean,response:joined|declined,isViewer:boolean}`; names only, no addresses. Agreement may be included independently of canViewBids. myVisits contains only caller's own stops. Manager occurrences redact stop locations/access notes. Do not reconstruct or enrich redacted fields from other records.

Nested DTO definitions are canonical in src/lib/hoa-types.ts:
- BidSummary required string keys id,requestId,providerUserId,providerName,status,currency,pricingBasis,scope,submittedAt; boolean providerVerified; integer amountCents,version; nullable providerCompany,proposedStartDate,estimatedDurationLabel,exclusions,cadenceLabel,validUntil; nullable integer perHomeCents; OPTIONAL integer homeCount,totalOccurrences. pricingBasis total/per_home/per_visit; status draft/submitted/withdrawn/accepted/rejected/expired.
- AgreementSummary strings id,requestId,requestTitle,communityId,communityName,providerUserId,providerName,currency,pricingBasis,scope,status,createdAt; integers amountCents,lockedHomeCount; nullable integer perHomeCents; nullable strings providerCompany,cadenceLabel,startDate,endDate. status active/completed/cancelled.
- VisitSummary strings id,occurrenceId,targetKind,stopLabel,status; nullable strings unitId,homeownerUserId,addressLine1,accessNotes,scheduledDate,windowStart,windowEnd,completionNote,completedAt; nullable numbers latitude,longitude; nullable integers stopRank,estimatedMinutes. targetKind unit/homeowner; status unscheduled/scheduled/en_route/in_progress/completed/skipped/blocked/cancelled.
- OccurrenceSummary strings id,agreementId,serviceDate,status; integer sequence; nullable string schedulePublishedAt; visits array. Status planned/in_progress/completed/cancelled.

Money remains integer cents. Budget is USD; bids/agreements carry currency and pricingBasis, which must be displayed accurately rather than labeling all quotes per-home. Server timestamps use toISOString; localize instants for display and label timezone where deadlines matter. Visit windowStart/windowEnd are strings, not guaranteed ISO timestamps; preserve them as time-window labels. Do not calculate lifecycle changes from the device clock. Null dates/budgets show an absence label, not epoch/zero.

Sources: src/lib/neighborhood-types.ts; src/lib/server/neighborhood-market.ts (requestSelect, permissionsFor, serializeRequest, visitsFor, getNeighborhoodRequest); src/lib/server/market-auth.ts::requireActiveNeighborhoodMember; src/lib/server/visit-views.ts; src/lib/hoa-types.ts; src/app/api/homeowner/requests/[requestId]/route.ts.

### Acceptance boundaries for this slice

Test list zero/multiple/capped results; both eligibility union branches and every reason; nullable legacy budget/deadline/best bid; unknown category/status; authorized neighborhood detail; 401/409/403/404/500; revoked membership after list; a list context=hoa row; denied/null nested arrays; null bids with canViewBids=true; whole-cent formatting and unknown currency fallback; slow/offline retry without duplicate navigation; session/sign-out clears request state. Do not show mutations, claim scheduling/bidding parity, or expose participant detail beyond returned fields. Contract fixtures are test evidence only; live source-backed reads and cross-user/community isolation still require nonproduction runtime tests.

## R02 discovery: read-only Account and recent in-app notifications

Prepared 2026-11-01 while R01 verification continues. This is contract discovery for a prospective slice, not delivery or live verification. No app/backend writes, mark-read, dismissal, profile editing, push permissions or device-token registration are included. Preserve existing Phase 2/live release gates.

### GET /api/profile: complete Account DTO

No body, query, user id or pagination. `authorizeRequest()` resolves the current Clerk identity to live Bundleen profile; database read uses only that session user's id. HTTP 200 returns the CommonProfile object directly (NO profile envelope). Force-dynamic, nodejs. No direct rate-limit guard.

| Required key | Wire type | Display rule |
|---|---|---|
| id | string | Opaque Bundleen id; not Clerk id; need not show to customer |
| email,fullName | string | Server account details, plain text |
| role | homeowner/provider/hoa_staff/admin | Account type only; cannot infer manager authority |
| isVerified | boolean | Clerk email verification, NOT provider vetting or confirmed residence |
| phone,address,neighborhood | string or null | Explicit unavailable/not supplied state for null |
| latitude,longitude | number or null | Location hints; no need to expose raw coordinates on Account screen |
| avatarUrl | string or null | Optional photo; missing/failed photo must retain initials fallback |
| avatarUpdatedAt | ISO timestamp string or null | Metadata, not necessary to display |
| createdAt | ISO timestamp string | Honest member-since date; localize for display |
| communityRadiusMi | number | Backend-owned fixed radius; not proof of coverage or editable preference |

Source `src/lib/profile-types.ts::CommonProfile`; `src/lib/server/profile.ts::commonProfileSelect,serializeCommonProfile`; `src/app/api/profile/route.ts`. Serializer falls back unknown server role to homeowner, but mobile should still handle unexpected values without enabling privileged routes. Neighborhood is profile text, not a guaranteed live membership; use separate viewer context/community contracts for membership. A verified-email label must not become a generic verified-provider badge.

Errors are `{error:string}`: shared authorization 401 unauthenticated,409 missing Bundleen profile,500 lookup outage; GET own-record race may return404 "Profile not found." and internal read failure500 "Something went wrong on our end. Please try again.". No role restriction is passed to authorizeRequest, so normally no wrong-role403 from this handler. Middleware/transport can still differ; retain API client's general response handling. Do not return an earlier user's cached profile after sign-out/account switch or substitute invented account details after failure.

### GET /api/me/notifications: exact recent-list contract

No body or query parsing: no client limit, cursor, unread-only filter, userId or pagination. Handler returns HTTP200 `{notifications:NotificationSummary[]}`. `listNotifications(sessionUser.id)` filters WHERE userId, orders createdAt descending, and requests default30 rows. Service helper internally clamps its optional limit to1..100, but this GET never exposes that parameter. There is no total/unread-count/hasMore/nextCursor field. Call the screen "Recent notifications" and do not imply a complete history, a globally accurate unread badge or infinite scroll. Empty array is a valid successful empty state.

Every notification has required keys:

| Key | Wire type | Meaning |
|---|---|---|
| id | string | Opaque notification identity |
| kind | string | Known values invitation,survey,request,bid,award,schedule,visit,review,account,security,reminder,booking,issue,message; safe generic fallback for future kinds |
| title,body | string | Plain text; canonical notification builder caps200/1000 characters respectively; never interpret HTML/Markdown |
| linkPath | string or null | Stored navigation hint, not authority or proof mobile supports destination |
| readAt | ISO timestamp string or null | null=unread; nonnull=read on server |
| createdAt | ISO timestamp string | Server event timestamp |

GET is force-dynamic and has no direct rate-limit guard. It only reads: opening/refreshing/tapping a card must NOT mark it read in this slice. Read status can change in web; refresh re-fetches authoritative data. There is no notification-detail GET; a native full-text view can use its already-fetched item, with session-scoped memory only. POST /api/me/notifications marks all read; POST /api/me/notifications/{id} marks one; DELETE same path dismisses. Those are explicitly outside R02. Do not call them automatically or add swipe-dismiss.

Shared auth errors apply (401,409,500). Handler list failure500 `{error:"Something went wrong on our end. Please try again."}`. `/api/me/*` is middleware-protected with auth.protect(), so unauthenticated content/status may precede handler JSON; use established API client semantics. No individual404 applies to this collection GET. Ownership is database WHERE userId, never a user id provided by mobile. Sources: src/app/api/me/notifications/route.ts; src/lib/server/notifications.ts::listNotifications; src/lib/hoa-types.ts::NotificationSummary; prisma/schema.prisma::NotificationKind.

### Link targets and routing boundaries

Observed producers point to homeowner dashboard/community/neighbourhood/chat, provider dashboard/hoa/schedule/messages, HOA dashboard/amenities, homeowner amenities/{amenityId}, homeowner amenities/issues, support/{ticketId}, internal admin pages, and `/`; conversation links include a `?thread={conversationId}` query. Broadcast links can add other paths. This is an open stored string, not a closed enum. Some targets have no independent matching page (such as homeowner amenities/issues) or are not yet implemented natively. Do not infer a request id from a neighborhood hub link. Do not claim all notifications are actionable on mobile.

The lowest-risk useful R02 scope is text-only notification cards and optional local full-text expansion with no outbound/deep-link action at all. If navigation is added later, explicitly whitelist fully supported native paths, keep role/ownership revalidation, reject arbitrary schemes/hosts/protocol-relative URLs and unsupported/internal-admin destinations, and show an honest unavailable destination state. Never pass linkPath straight to a URL launcher/router. The notification GET simply serializes the stored path; broadcast input validation elsewhere is not a client security guarantee.

### Recommended minimal native scope and acceptance

Account: server full name, email, phone, address/neighborhood, account type, member-since, specifically labeled email-verification state; optional accessible avatar fallback. Do not add manager controls, profile edit or location permission. Notifications: latest30 server records, chronological title/body/date, accessible read/unread text, pull-to-refresh/retry and meaningful empty/offline/expired-session states. This improves actual parity without pretending profile settings, push or notification mutations exist in mobile.

Tests: direct profile envelope; all nullable fields; true/false email verification label; all roles/unknown fallback without privilege; invalid response handling; notifications empty/mixed read state, unknown kind, long text/text scaling, null/unsupported/malicious link hints rendered inert, no POST/PATCH/DELETE on opening/refresh/selection, accurate recent-list labeling with30 rows, no fabricated total unread, session loss/account switch clears sensitive data, 401/409/404(profile)/500, late response after sign-out. Contract fixtures prove parser/UI behavior only; live identity isolation and actual iOS/Android runtime remain gated separately.
