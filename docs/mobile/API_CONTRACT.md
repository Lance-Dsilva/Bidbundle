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
