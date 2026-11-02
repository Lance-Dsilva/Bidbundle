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
| budgetMinCents,budgetMaxCents | integer or null; whole US cents under the request budget contract; legacy budgets may be null |
| bestBidCents | integer or null; selected bid amount in cents, but bid currency is omitted from this projection; not safe to label USD |
| bidCount | integer, count of ALL related bids, unlike detail count |
| enrollmentClosesAt | ISO timestamp string or null |
| createdAt,updatedAt | ISO timestamp strings |

BestBidCents selects the lowest numeric amount among submitted/accepted bids; null means none. Because the projection omits bid currency, this is not a supported cross-currency price comparison. Do not label it USD, compute a discount or treat it as an awarded amount. categoryLabel falls back to raw category if not recognized. Status vocabulary currently draft,collecting_interest,open_for_bids,bidding_closed,awarded,scheduled,in_progress,completed,cancelled,failed; keep unknown status display safe without granting actions.

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

## R03 discovery: read-only provider Home overview

Source inspection only, 2026-11-01. No live requests, server changes or R03 app implementation performed. This is a proposed next slice, not delivered parity. Sources: `src/app/api/provider/overview/route.ts`, `src/lib/server/provider-api.ts`, `src/lib/server/provider-overview.ts`, `src/lib/server/provider-reviews.ts`, `src/lib/server/conversations.ts`, `src/lib/server/hoa-api.ts`, `src/lib/server/auth.ts`, `src/hooks/useProviderOverview.ts`, `src/app/app/provider/dashboard/page.tsx`, `src/components/layout/ProviderShell.tsx`, `src/components/layout/ViewerIdentity.tsx`, and `prisma/schema.prisma`.

### HTTP contract and read gate

`GET /api/provider/overview`: no body, query, provider/user id, filters or pagination. HTTP200 `{overview: ProviderOverview}` (required envelope). Nodejs, force-dynamic, no direct read-rate-limit guard. Handler first calls `requireProviderConsole()`, which calls `requireProviderUser()` → `authorizeRequest(['provider'])`, then looks up `ProviderProfile` by the verified session's Bundleen user id. All overview queries carry that id in their WHERE clauses, including participant-scoped conversations. Do not supply identity from mobile.

A real provider profile must exist. Its `accountStatus` enum is `pending | active | suspended`. **All three may read their own overview**, history and personal account. Pending is not an API failure; suspended does not mean delete/hide history. The separate mutation gate blocks suspended accounts with403 and applies mutation rate limits, but is not invoked for this GET. Active status alone is not proof of license/insurance vetting, bid eligibility, coverage or email verification. This slice must not enable bid/message/account-status mutations based on a status label.

Errors:401 `{error:'Authentication required.'}`;403 wrong role `{error:'You do not have access to this resource.'}`;409 missing common Bundleen user `{error:'Complete your Bundleen profile before continuing.'}`;409 missing provider profile `{error:'Finish setting up your provider account to use this.'}`. Shared common-profile lookup500 is JSON. Errors thrown by `getProviderOverview` are normalized by `hoaErrorResponse` (generic500 JSON, known domain statuses where applicable). **ProviderProfile lookup inside `requireProviderConsole` happens before the handler's try/catch**, so its database failure may be framework-generated500/non-JSON; retain existing transport rejection rather than inventing a successful empty overview. Middleware may also precede handler responses. No successful-empty404 contract exists for this aggregate endpoint.

There are two provider-profile reads (gate, then aggregate): if the profile disappears between them, the aggregate's fallback is `companyName:null,accountStatus:'pending'`, not another409. Do not confuse the internal aggregator fallback with the route's normal missing-provider409 behavior.

### Exact required overview fields

| Field | JSON type / source meaning |
|---|---|
| companyName | string or null; nullable provider trading name |
| accountStatus | string enum pending/active/suspended; database account state |
| activeBids | nonnegative integer; ServiceBid status submitted only |
| jobsCompleted | nonnegative integer; ServiceAgreement status completed count, all time |
| activeJobs | nonnegative integer; ServiceAgreement status active count |
| revenueTotalCents | nonnegative integer; sum of snapshotted amountCents on all completed agreements |
| revenue30dCents | nonnegative integer; completed-agreement amountCents with updatedAt >= server now minus30 days, within bounded recent query |
| previous30dCents | nonnegative integer; same for updatedAt >= now minus60 days and < now minus30 days |
| revenueChangePct | integer or null; rounded ((current-prior)/prior)*100 when prior>0, otherwise null; negative and >100 values are valid |
| monthlyRevenue | array of6 `{month:string,cents:nonnegative integer}`; YYYY-MM UTC month keys, oldest first, ending in server current month; zeros inserted by server |
| currency | string; newest recent completed agreement's currency, otherwise `usd` |
| winRatePct | integer0..100 or null; rounded accepted/(accepted+rejected)*100; null if no decided bids; submitted/withdrawn/expired do not count as losses |
| averageRating | finite number1..5 or null; published reviews only, rounded to1 decimal; null when no published reviews |
| reviewsCount | nonnegative integer; count of published reviews (removed reviews excluded) |
| unreadMessages | nonnegative integer; all unread messages from other people in conversations where caller is provider OR customer; not an in-app notification count |
| recentThreads | array, at most3 ConversationThread records ordered by lastMessageAt descending nulls last, then createdAt descending |

No `userId`, `providerId`, completion timestamp, `asOf`, next cursor, payout balance, paid amount, future revenue estimate or permission boolean is returned. Currency and nullable comparisons must not be replaced with invented USD/0% defaults on malformed data. Unknown accountStatus must display a neutral unavailable/unknown state or fail strict parsing; never promote to active.

ConversationThread required strings: `id,requestId,requestTitle,communityName,otherPartyName`; `otherPartyRole` customer/provider; nullable strings `lastMessagePreview,lastMessageAt`; nonnegative integer `unreadCount`. `lastMessageAt` is ISO UTC when present. The three previews are not a complete inbox; the global unreadMessages value is independently counted and need not equal their sum. Opening this aggregate never marks messages read. A later messaging slice needs separately authorized transcript routes; a preview is not authority to view a guessed thread.

### Money, time and completeness limitations

These are **completed-agreement values**, not observed payments, settled payouts, cash received or bank balances. Amounts are accepted agreement snapshots, not current bid amounts. The server dates completion using agreement `updatedAt` (last write), not a dedicated immutable paid/completed timestamp. Do not reproduce the web's 'Total earned' wording as proof of collected funds.

The all-time completed sum is an aggregate across all matching rows. Period/trend fields instead use **at most500 newest completed agreements** with updatedAt >= the earlier of now-minus60days or the first UTC day of the trailing6-month window. Thus heavily active providers can have truncated period/trend sums; the response exposes no truncation flag. Month buckets use UTC calendar months; do not shift YYYY-MM keys into the previous local month, infer daily timestamps or replace years with month-only ambiguous labels. RevenueChangePct can be -100, zero, positive, or far above100; null means no valid prior-period comparison. Do not recompute client-side business arithmetic or substitute0% for null.

**Currency gap:** the aggregator sums `amountCents` across agreements without grouping/filtering currency, then labels the entire result using `recent[0]?.currency ?? 'usd'`. Schema fields are strings with USD defaults, not a single-currency database constraint. Current bid/award paths normally propagate the USD default/snapshot, but this source inspection does not prove every historical/imported row is USD. Unknown or mixed currencies are therefore not safe to convert/relabel as one currency. A strict money UI must not assume this response establishes single-currency accounting. No backend change is authorized by this discovery.

### Proposed bounded R03 scope and gates

Recommended first provider Home slice: server company name (fall back to existing matched profile name when null), explicit Pending review/Active/Suspended account state, active bids, active/completed agreements, published rating plus review count, decided-bid win rate with null 'Not available yet', and optional plain unread-message count with messaging explicitly unavailable. No actionable inbox previews are needed for this bounded slice. Document revenue/trend and conversation previews as deferred if excluded; they are not silently completed parity. Given the currency/completeness gaps above, **prefer deferring money/trend presentation until the manager accepts precise limited wording or a separate reviewed backend contract resolves those gaps**. Do not display estimated payout or claim all-time/period paid income.

The existing web provider dashboard combines overview **and a separate marketplace read**. Its discovery cards, estimated job revenue, bid chips and upcoming stops derive from `/api/provider/marketplace`, not this overview. They are outside this slice. Its shell obtains viewer context separately and `ViewerIdentity.roleLine` labels pending as 'Service provider · Pending review', suspended as 'Service provider · Suspended'; active has no special verification badge. Mobile can state status explicitly without borrowing authority from shell labels.

Integration recommendation: after existing HomeRepository verifies matching profile/context ids and roles, request this overview only for role provider; no provider GET for homeowner/hoa_staff/admin/unknown. Extend HomeData with a nullable provider projection alongside the existing homeowner dashboard. Preserve Account for matched public-role providers even if the overview read returns missing-provider409 or a recoverable read failure; avoid making a provider-console problem erase otherwise authorized personal account navigation. This may warrant a separately typed provider-overview substate/failure rather than failing the entire identity/context load. Any401/failed forced renewal must still globally clear Home/Requests/Account and every route. Role/account refresh, sign-out and late response fences must prevent old-provider data reappearing. Pending/suspended are successful read states with honest labels and no made-up upgrade/activate buttons.

Independent tests should cover the200 envelope; nullable company/rating/percent; all3 statuses and unknown status; zero/positive counts; negative/decimal/overflow/NaN-invalid numbers; nullable vs zero win rate; -100/>100 revenue change if parsed;6 UTC month labels across year boundary; unknown currency; non-provider no-read; missing-provider409 distinguished from successful pending; HTML/framework500 and generic retry; account navigation retained after overview-only failure;401 global clearing and renewal failure; sign-out/account/role-switch late responses; no mutation endpoints;200% text and screenshots with synthetic data. Existing server tests `tests/provider-console-reads.test.ts` assert arithmetic/query ownership and `tests/provider-console-routes.test.ts` cover route gates; inspect/run relevant safe tests if server adaptations are ever separately approved. Live provider identity isolation and native runtime still require staging evidence and do not pass from mocks.

## R04 discovery: read-only Support list and visible conversation

Source-only inspection, 2026-11-01; no R04 implementation, live call or server change. Candidate flow: Account → Support requests → Ticket conversation, for existing matched public roles. Sources: `src/app/api/support/tickets/route.ts`, `src/app/api/support/tickets/[ticketId]/route.ts`, `src/lib/server/support-api.ts`, `src/lib/server/support.ts`, `src/lib/validation/support.ts`, `prisma/schema.prisma`, `src/components/support/SupportCenter.tsx`, `src/components/support/SupportThread.tsx`, `src/components/admin/support/supportPresentation.ts`, and customer support page/layout files.

### Read-only feasibility and authority

Both GET routes call `requireSupportUser()` → `authorizeRequest()` with no role allow-list, then session-scoped read services. The source call graph performs database reads only: active staff assignment lookup, ticket read, optional visible-message read, pure serialization/time calculations. It does **not** update read status, lastActivityAt, notifications, audit rows, SLA state, AI drafts or outbox, and sends no email. Mutating functions elsewhere in the same service are not called by these GETs. There is no support-message readAt field. This makes a bounded read-only mobile slice viable without hidden write consent. No direct read-rate-limit guard. Both routes declare nodejs; neither explicitly declares force-dynamic (the authenticated route path still invokes auth); do not introduce client caching of private ticket data.

**Visibility is broader than only the caller's own tickets.** `requesterVisibilityWhere(userId)` queries CommunityStaffAssignment where userId matches, status=active and role in hoa_manager/hoa_team. It then allows requesterUserId=userId OR communityId in those assignment community IDs. There is no client-supplied requester/community filter and no 'all tickets' branch. The query does not add community.status or global-role conditions to those assignments. Thus active assigned staff, including qualifying homeowner accounts, can see community tickets raised by someone else; a generic resident does not gain that access. Do not label every result 'your ticket', infer authority from global role, or try to client-authorize by requesterEmail/name. Use 'Support requests' and describe records as tickets available to this account, including authorized community tickets where applicable.

`getTicketForRequester` re-runs the same visibility condition with the requested id. Missing and unauthorized tickets both produce404, concealing existence. Revoked assignment after list fetch can therefore produce404 on detail; never fall back to the list as a conversation or claim ownership. Encode id as a single path segment and match the returned detail id. Do not request admin support APIs. Although the raw support gate accepts any signed-in valid role, public mobile navigation should remain homeowner/provider/hoa_staff only; admin and unknown roles keep the established excluded public-navigation policy. Customer web detail redirects admin to the separate admin queue.

### GET /api/support/tickets

No body, query parsing, cursor, filters, owner or community parameters. HTTP200 `{tickets: SupportTicketSummary[]}`; newest lastActivityAt first, **at most100**. No totalCount/hasMore/nextCursor. Label 'Up to 100 recent support requests', not all history. Empty array is success.

All Summary keys are required:

| Fields | JSON type / meaning |
|---|---|
| id,ticketNumber,subject | strings; opaque id and human ticket number (generated BDL-sequence) |
| category | account,billing,service_request,bidding,scheduling,provider_issue,community,technical,other |
| status | new,open,pending_customer,pending_internal,resolved,closed |
| priority | low,normal,high,urgent |
| requesterName,requesterEmail | strings; requester information, not proof current viewer owns ticket |
| requesterRole | role string captured when ticket was created, not current viewer authority |
| communityId,communityName | string or null |
| assignedAdminUserId,assignedAdminName | string or null; unnecessary for proposed public mobile projection |
| messageCount | nonnegative integer, **unfiltered count of all messages**, including internal notes |
| awaitingAdminReply,firstResponseOverdue | booleans computed server-side |
| ageHours | nonnegative finite number, rounded to1 decimal; server time calculation |
| lastActivityAt,createdAt,updatedAt | ISO UTC timestamp strings |

**Do not display or retain messageCount in the mobile projection.** `ticketSelect._count.messages:true` is not filtered by `customerMessageWhere`; it can exceed visible messages and expose an internal-note count. Do not show 'N replies' from it or compare it to detail messages. Similarly, lastActivityAt is ticket activity, not necessarily the last visible reply: name it 'Last activity'. Omit requesterEmail, admin assignment identity, priority/SLA flags and computed age from the minimal customer UI. Those fields are present in the wire DTO, but this slice does not need to expose them or promise response times.

Web customer status labels map new→Received, open/pending_internal→With our team, pending_customer→Waiting on you, resolved→Resolved, closed→Closed. Because authorized community viewers may not be the requester, prefer neutral **Waiting on requester** for pending_customer in this mobile read-only view. Unknown statuses/categories should be safe inert labels or strict parse failures; never derive permission or a write action. Subject max160 and message max10000 are current write-validation constraints, not permission to render HTML.

### GET /api/support/tickets/{ticketId}

HTTP200 `{ticket: SupportTicketDetail}`. Detail is Summary plus these required keys:

| Fields | JSON type |
|---|---|
| messages | SupportMessageView[], createdAt ascending; **no pagination or take limit** in current query |
| relatedRequestId,relatedBidId,relatedVisitId,reopenedFromTicketId | string or null; stored contextual ids, not route authorization |
| canReply,canReopen | booleans, calculated server-side for actual requester and lifecycle |

Each message requires `id,kind,body,authorName,authorSide,fromAi,createdAt`. Strings: id/body/authorName; authorSide is you/support/customer; createdAt ISO UTC; fromAi boolean. The shared TypeScript message type permits customer_reply/admin_reply/internal_note, **but the customer read query excludes internal_note**. For this mobile customer projection accept only customer_reply/admin_reply; reject internal_note or unknown kind rather than rendering unexpected privileged content. The customer serializer always calls `toMessageView(...,false)`: support reply authorName becomes 'Bundleen Support' (not the staff author's name), fromAi is always false, and authorSide is resolved on the server. AI draft/explanation tables are not queried. An approved AI-assisted admin reply may appear as normal support text; do not invent an AI draft or staff-internal view from it. A defensive fromAi=true response can fail the customer contract rather than reveal unreviewed metadata.

A manager/team member viewing another requester's community ticket may read its customer-visible conversation, but canReply/canReopen are false unless they are the actual requester. This slice ignores both booleans for actions regardless of value: no composer, reopen, create, send, edit, delete or upload. Preserve message body as plain multiline text and server author-side semantics; no HTML/Markdown rendering or auto-linking.

**Long-thread limit:** the service returns every customer-visible message without a page boundary. The existing mobile transport rejects bodies above1MiB; a large legitimate conversation may therefore fail safely. Do not silently truncate a thread or synthesize a success from list metadata, and do not relax the shared byte limit as an incidental UI change. Native pagination would require a separate compatible backend contract. Record this current limit in the slice checkpoint and exercise the oversized-response state.

### Errors, attachments and unsafe links

Shared401/409 missing Bundleen profile/500 errors apply. Detail404 body is `{error:'That ticket does not exist.'}` for both missing and forbidden ids. `SupportError` propagates its status/error string. Generic support error500 adds a reference and text saying the request 'was not saved' even on reads; prefer existing safe ApiFailure read-error copy rather than repeating that inaccurate mutation wording. Shared error mapper also maps P2025 and P2002/23505 to409, though those are normally write-race cases. Do not treat409 as a successful empty conversation, or403/404 as permission to use stale detail. Native401/failed forced renewal clears all session-scoped models/routes; local read failures preserve Account access.

There is **no attachment URL, attachment collection, upload endpoint or media field** in these inspected customer DTOs or SupportTicketMessage schema. Related ids are plain strings and must stay inert. Message/subject text can contain arbitrary URLs or markup-looking content: render plain text, never launch, preload or fetch it. Do not infer attachments from URLs or route notification linkPath automatically into support. External/admin/unsupported links remain inert under the established policy.

### Recommended bounded R04 and independent acceptance

Use a separately scoped Support child model reached from Account, with native Account→list→detail back navigation and platform gestures. Retain only ticket id/number/subject/category/status/communityName/createdAt/lastActivityAt for list and the same plus customer-visible message projection for detail. Hide unnecessary requester/admin identity metadata and unfiltered counts. Each detail GET must reauthorize and response-id-match; no list-backed conversation fallback. Empty tickets and empty visible-message arrays are genuine empty states. Preserve year+explicit timezone in timestamps, wrapping long text and200% scaling,48px actions, loading/error/retry/refresh and immediate sensitive-state clearing on logout/identity/role refresh. A list read does not establish individual ownership or unrestricted community management authority.

Tests should prove GET-only traffic, encoded ids, response id match, unknown/wrong role no navigation, authorized community ticket wording, own vs community authorSide presentation, null community,100-result limit honesty, all statuses/categories (neutral waiting-on-requester), internal_note/unknown message kind rejection, fromAi contract handling, ignored internal-note count/admin metadata/related ids, text-only malicious URLs/HTML, detail403/404 after a previously visible list, generic500/409/401, forced-renewal expiry, unbounded-server/1MiB-client failure behavior, late list/detail after sign-out or role switch, list→detail scroll reset, Android back/iOS swipe and200% screenshots. Existing source test `tests/support-ai-safety.test.ts` checks customer filter use and exclusion of AI draft tables, but source assertions are not live role-isolation proof. No hidden GET mutation blocks this bounded plan; live staging authorization and the long-thread API limitation remain explicit gates/limitations.

## R05 discovery: provider opportunities, source-only candidate

Inspected 2026-11-01. This is a recommendation, not implemented or live-verified. Sources: `src/app/api/provider/marketplace/route.ts`, `src/app/api/provider/marketplace/requests/[requestId]/bid/route.ts`, `src/lib/server/hoa-api.ts`, `src/lib/server/provider-api.ts`, `src/lib/server/hoa-market.ts` (`requireProvider`, `providerCanSeeRequest`, `getProviderHoaWorkspace`, serializers), `src/lib/server/visit-views.ts`, `src/lib/hoa-types.ts`, and `src/components/provider/ProviderMarketplaceFeed.tsx`.

### Read gate and visibility

`GET /api/provider/marketplace` returns `{workspace}`. It uses `requireProviderUser` (authenticated provider role), then `requireProvider(userId,{allowPending:true})`. Unlike provider overview's console gate, a missing provider record throws **403**, not409. Authentication/profile failures remain shared authorization responses; wrong role403; workflow failures retain their status; generic failure500. The generic unique-conflict mapper can emit409, which should remain a neutral recoverable error rather than inventing a missing-profile explanation.

Pending and suspended records can read their own workspace/history. `workspace.eligible` is false with a server reason for suspended status, non-active status, or absent license/insurance verification timestamps. Order: suspended first; other non-active next; then missing either credential. Account active alone and email `isVerified` are insufficient. Eligibility is not authorization for a mobile mutation. This endpoint does not include accountStatus itself; do not derive a new account status from free-text reasons.

Feed rows additionally require normalized category within provider trades, an active service area covering a server-approved community location, an active community, request status open_for_bids, and bidding deadline null or strictly later than server now. HOA matching uses verified HOA coordinates; neighbourhood matching uses admin-owned community centre, never participant coordinates. Unknown coverage is not a match. Postal-only coverage cannot match a neighbourhood with no community postal address. No client-supplied filters/location/ID establish eligibility. An empty eligible feed may reflect trade, coverage, location, deadline or the candidate cap; do not assert a specific cause.

### Exact feed projection and limits

Workspace fields are eligible:boolean, ineligibleReason:string|null, serviceAreas:array, categories:string[], feed:array, bids:array, agreements:array, occurrencesByAgreement:object. The proposed mobile projection retains only eligible/reason/feed. Required feed fields:

| Field | Source wire type and meaning |
| --- | --- |
| requestId,communityName,title,category,description | string; category normalized when recognized, otherwise raw |
| context | hoa or neighborhood |
| kind | compulsory_recurring or optional_group |
| locality,region,recurrenceLabel | string|null |
| totalOccurrences | integer; visits/occurrences per home |
| homeCount | integer; joined participation count, no participant identities |
| approximateDistanceMi | number|null; rounded miles to community point from nearest service-area centre, not a home location |
| budgetMinCents,budgetMaxCents | integer|null; permitted request budget in US cents under the request validation/schema contract; no separate currency field |
| startDate,biddingClosesAt | ISO UTC timestamp string|null |
| myBid | caller's own BidSummary|null; exclude from first mobile projection |

The service fetches at most **200 open candidate requests before eligibility filtering**, ordered by biddingClosesAt ascending. Thus feed length <=200, possibly far smaller, and it is not a complete or paginated opportunity catalogue. No cursor/total is exposed. Active service areas have no explicit take. Own bids: latest50 by updatedAt descending. Own agreements: latest25 by createdAt descending. Occurrences and nested visits for those agreements have **no explicit count cap**. Feed myBid uses the caller's matching bid (no competing bid amounts); it is not an invitation to fetch arbitrary IDs.

Dates are serialized using toISOString. Mobile should keep existing year+explicit timezone labels, null-not-zero handling and safe finite/nonnegative/count integer validation; do not infer request availability from device time. `approximateDistanceMi` is nullable, not a zero-distance fallback. Existing helper actually takes the nearest centre among active areas, despite comments referring to covering areas; describe only approximate community distance, not exact travel distance.

### Money, privacy and side effects

Request budget fields have an explicit US-cents contract in the underlying request validation comment/schema and migration; a separate currency field is not required to preserve those request budgets as USD (including R01). Web rounds their display to zero fractional digits, which mobile should not copy for exact cents. **Omitting budgets in the first opportunities slice is a bounded-scope choice**, not a missing authoritative budget currency. This does not establish currency for a selected best-bid amount or dashboard savings: bids/agreements carry currency, USD defaults are not a database-wide invariant, and those aggregate serializers omit currency. No revenue/earnings totals or savings. Own bids/agreements do carry their own currency string, amountCents and pricingBasis, with nullable perHomeCents; legacy pricing bases and dimensions make them a separate later contract, not a safe sum or payout. Their omission is deliberate.

Feed projection contains community locality/region, approximate distance, and counts, with no participant/unit/address/access-note list or competing amounts. However the same workspace payload includes the provider's won agreements and serialized occurrence visits with includeLocation=true and includeAccessNotes=true. Those sections can contain precise unit/home address snapshots and access notes, scoped by agreement providerUserId. Pending/suspended reads still retrieve their own history. A mobile opportunities parser must discard serviceAreas/bids/myBid/agreements/occurrences and never retain, log, render or cache their address/route data. This does not reduce network payload size: the existing1MiB client bound can reject a large workspace before projection. That is a concrete endpoint-size limitation; keep a recoverable error, no silent truncation or relaxed cap. A future feed-only server endpoint would reduce unnecessary sensitive transfer and payload risk, but is outside this source-only candidate.

The inspected GET workflow performs database reads and serialization only: no bid/read-status/visit mutations, notification dispatch or audit writes. Shared authentication remains existing infrastructure. The request-specific bid route exports PUT and DELETE only; **there is no provider opportunity GET-by-ID detail route** in this route family. Do not repurpose homeowner/neighbourhood detail endpoints or invent direct-ID access.

### Recommended split and acceptance

A viable first candidate is provider-only **Opportunities list with inline expandable description/details from the current feed**, reached after matched profile/context; local child errors preserve Home/Account. Retain title/community/context/category/kind, recurrence/counts, optional approximate distance, start/deadline and description; omit money, coordinates, own bids and awarded-work sections. Show server ineligible state separately from an eligible empty feed, with read-only wording and no bid/coverage/verification action. Suggested limit text: “Available opportunities from up to200 open requests checked”; never “all nearby jobs.” A separate detail route, if desired later, must explicitly be a current-feed projection refreshed through the same GET, discard selection when missing, and never imply independent server detail authorization. Inline expansion is the smaller initial scope.

Before acceptance test provider-only request isolation; pending/suspended/unverified state with empty feed; missing-record403; neutral409/500; eligible empty state; null dates/distance/recurrence; invalid enums/counts/dates; candidate cap wording; malicious descriptions as inert plain text; no retained private nested sections; oversized workspace failure; retry/refresh that replaces prior feed; no direct-ID or mutation traffic; logout/account/role/401 forced-renewal clearing and late-response fences;200% text and native back. Server coverage/privacy source inspection is not live cross-provider authorization proof. Live gates remain open; no R05 implementation is authorized by this appendix alone.


### Currency display correction after R05 source audit

Request budget fields retain their explicit US-cents source contract, so R01 continues displaying those budgets as USD. The request-list bestBidCents projection selects a numeric bid amount without its currency; the dashboard savings calculation subtracts agreement amounts without preserving currency. Defaults of USD do not establish a database-wide currency invariant for bids/agreements. Mobile therefore omits the “Lowest live bid” monetary display and Home “Recorded savings” card and discount explanation. Existing typed parsing may retain these fields for response-contract compatibility; it does not authorize displaying or aggregating them. R05 continues to omit budgets as a bounded first-slice choice, and omits all own-bid/earnings aggregates. This is a source-review correction, not evidence of a production incident or completed live validation.

## R06 discovery: read-only provider coverage summary

Source-only inspection, 2026-11-01; no implementation or live calls. Sources: `src/app/api/provider/service-areas/route.ts`, `src/app/api/provider/service-areas/[areaId]/route.ts`, `src/app/api/provider/marketplace/service-areas/route.ts`, `src/lib/server/provider-coverage.ts`, `src/lib/provider-coverage.ts`, `src/lib/validation/provider-coverage.ts`, `src/components/provider/ProviderServiceAreasPanel.tsx`, and `prisma/migrations/20260823090000_provider_coverage_map/migration.sql`.

### Endpoint, ownership and differences from other provider gates

Canonical `GET /api/provider/service-areas` returns `{areas:[ProviderServiceAreaView...]}`. It calls requireProviderUser, so shared authentication/profile authorization applies and only the provider role is allowed. **The list function does not call requireProviderAccount or requireProviderConsole**: it directly queries providerServiceArea where providerUserId equals the authenticated user and status=active. Thus a provider-role user without a providerProfile may receive200 with an empty list; do not fabricate missing-record403/409 from other endpoints. Account activation and credential verification are not checked by this read. Pending/suspended providers can inspect saved coverage; saved coverage is not proof of marketplace eligibility.

Rows are ordered primary first, then createdAt ascending. No take, cursor or total is exposed. Canonical creation enforces at most10 active areas, but this is a write-time rule, not a GET result cap or pagination contract; do not discard/reject an otherwise valid read merely because it exceeds10. GET has no workflow writes, audit, geocoding, normalization or primary-area repair. Error mapping is shared hoaErrorResponse: domain status if thrown, generic conflict409 and generic500; normal ownership filtering returns no other account's rows. There is no list eligibility/reason object; an empty array simply means no active rows returned.

The legacy `/api/provider/marketplace/service-areas` route exports POST only; do not invent GET there or fetch the entire marketplace workspace to duplicate this read. Canonical `[areaId]` exports PUT/DELETE only; no detail GET is needed. A separate own-provider-profile fetch is unnecessary for a read-only coverage summary: existing matched Account/profile/context already scopes navigation, and this endpoint contains the relevant display fields. No map/geolocation/geocoder/geometry implementation is proposed.

### Full wire shape and minimal retained projection

Each row requires id:string, label:string, centerLatitude:number|null, centerLongitude:number|null, radiusMiles:number|null, postalCodes:string[], isPrimary:boolean, formattedAddress:string|null, locality:string|null, region:string|null, postalCode:string|null, countryCode:string|null, status:active|removed, createdAt:string and updatedAt:string (toISOString UTC). The active-only list should return status=active; unexpected removed rows should fail the minimal active-coverage contract rather than be displayed as current coverage.

Recommend retaining only id,label,radiusMiles,isPrimary,locality,region,postalCodes,status and updatedAt, with strict required/null/type checks, canonical timestamps and finite radius1..100 when present. Legacy postal-only rows have null coordinates/radius and postalCodes; do not turn them into a default15-mile circle, or infer that every null radius is an eligible coverage match. New circle writes normalize radius to a tenth and require1..100; migration clamps older nonnull radii to that range and constrains geometry. A nullable radius remains “Radius not provided”; saved postal coverage may be shown as plain codes with neutral legacy wording. Do not enforce exactly one primary in the client: migration/index enforces at most one active primary, and GET does not repair missing primary state.

Drop exact centre coordinates, formatted business address, singular geocoded postalCode/countryCode and createdAt if not displayed. These are the owner's private operational data, not customer-visible geography, and are not needed for this summary. Display locality/region and the saved label as plain text; user-entered labels are not guaranteed to be non-sensitive, so no analytics/logging of response fields. The server still transmits the full own-row data before projection; keep existing1MiB total response and timeout limits. No arbitrary links, navigation by area ID, network maps, permissions prompts or location processing.

### Proposed scope and acceptance

Provider-only Account → “Service areas” native backable summary after matched profile/context, using a separate lazy child read. Show each saved label, primary flag, optional coarse locality/region, radius or null state, postal-code coverage if supplied and updated date with year/timezone. Explain that saved coverage is one input to server opportunity matching and does not establish activation, verification or bidding access. No area edit/add/remove/promote/coverage preview controls; no current-location or distance-to-customer claims. Missing areas is a genuine empty state, not an onboarding redirect. A summary can use current Opportunities and Account independently; a coverage read failure must not blank their matched state.

Independent checks: provider-only traffic/navigation; real canonicalGET only; pending/suspended read states without eligibility claims; absent providerProfile-compatible empty response; strict null/radius/status/date validation; postal-only legacy rows; no precise-address retention/rendering; no10-row truncation assumption; response-size limit; retry/refresh and stale-generation fences;401 forced-renewal global clearing; neutral403/409/5xx errors preserving Account; native back/route switching and200% text. No server change is required for this bounded source candidate, though live ownership isolation remains unverified.

### Minimal unused monetary-field removal plan (not implemented here)

After the preceding UI correction, `Dashboard.savedCents` and `RequestSummary.bestBidCents` have no production consumers. Remove Dashboard constructor parsing of total_saved_cents and its savedCents declaration in `apps/mobile/lib/features/home/models.dart`; retain activeRequests/activeBids/coldStart. Remove RequestSummary constructor parsing and declaration of bestBidCents in `apps/mobile/lib/features/requests/models.dart`; retain explicit-USD budgetMinCents/budgetMaxCents. Do not change backend payloads or serializers.

Tests to adjust when assigned: mobile_test's savedCents assertion should instead verify used dashboard fields and that omitted/malformed unused total_saved_cents does not enter the projection. requests_test's malformed-bestBid rejection becomes acceptance/ignored-field coverage while invalid retained budget fields must still reject. Existing synthetic extras can remain in fixtures and UI-absence regressions should remain: they demonstrate the response fields do not render. No migration, dependency, widget-layout or server edit is necessary. This removes unnecessary retained data and avoids rejecting otherwise valid used projections based on unused ambiguous aggregates; it does not redefine the backend's monetary semantics.
