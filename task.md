# Bundleen HOA-First Product and Implementation Specification

## Instruction to the implementing agent

This document is the authoritative product brief for the next development phase. It replaces earlier broad community-management plans where they conflict with this document.

Build a real, end-to-end application. Do not satisfy a workflow with mock arrays, hard-coded dashboard totals, fake bids, client-only state, or buttons that only change appearance. Every completed screen must use authenticated APIs and Neon/Postgres data. Preserve working foundations already in the repository and migrate them instead of rebuilding blindly.

If a detail is not explicitly settled below, choose the safest simple implementation that preserves data integrity and record the decision here. Do not weaken authorization or mix HOA and non-HOA data to make a UI easier.

## What Bundleen is

Bundleen helps a community combine home-service demand so verified service providers compete for a larger group of homes.

For an HOA:

1. A Bundleen administrator onboards the HOA and its first manager.
2. The HOA manager adds the HOA's homes/units and invites homeowners.
3. The manager opens compulsory recurring service procurements or optional community service opportunities.
4. Eligible providers submit competing bids.
5. The HOA manager awards one bid.
6. Homeowners can see the request, bids, award, schedule, and completion status for transparency.
7. The winning provider plans the order and time of the service visits.
8. Homeowners and the manager receive schedule updates and can review completed work.

The immediate product focus is official HOAs. Keep the existing non-HOA neighborhood logic isolated and working, but do not expand it during this phase.

## Existing technical foundation

Use the current stack unless a documented blocking reason requires a change:

- Next.js App Router and TypeScript
- Clerk for authentication, email verification, sessions, passwords, and invitation tickets
- Neon Postgres through Prisma
- Vercel deployment
- Upstash-backed rate limiting
- Leaflet for maps
- Geoapify/OSM-derived geocoding and tiles behind configurable provider boundaries
- Existing Bundleen admin authorization, append-only audit logging, community models, invitation flow, and HOA portal as the starting point

Do not store passwords in Bundleen. Clerk owns credentials. When the brief says the admin “creates” an HOA manager account, the admin creates the pending Bundleen identity/invitation; the manager follows the private invitation, verifies the invited email, and sets their Clerk password.

## The four product actors

### 1. Bundleen administrator

An internal Bundleen operator, not a public customer role.

The administrator can:

- create, edit, archive, and restore an HOA;
- enter the HOA's legal/display name, primary address, timezone, number of homes, and operational details;
- create or import the initial unit inventory;
- enter the first manager's name, title, email, phone, and optional business/mailing address;
- send, resend, or revoke the first manager invitation;
- replace or revoke the active manager safely;
- see onboarding progress, member counts, requests, providers, and audit history;
- manage provider verification and account status;
- diagnose failed invitations and data problems without seeing passwords or raw invitation tokens.

The administrator must not manually approve algorithmic non-HOA memberships. The existing distance matcher makes those memberships active immediately.

### 2. HOA manager

The HOA manager has a separate, invitation-only account and a dedicated HOA dashboard. There is no public “Become an HOA manager” registration option.

The manager can:

- maintain the HOA's units and homeowner roster;
- invite a homeowner to a specific home/unit by verified email;
- resend or revoke pending invitations;
- see invite, occupancy, and membership status;
- create and publish surveys;
- create compulsory recurring and optional non-recurring service requests;
- see homeowner interest/participation for optional requests;
- see incoming provider bids and accept exactly one bid;
- communicate request and schedule updates;
- review the provider's proposed visit order and timing;
- track service progress and exceptions;
- review completed work for the HOA.

All manager authority is scoped to a specific HOA through a live database assignment. A client flag, editable Clerk metadata, or global `isManager` boolean is never sufficient authorization.

### 3. HOA homeowner

An HOA homeowner joins only through an invitation for a specific HOA unit. The homeowner cannot self-select an HOA by address and cannot be silently inserted by the non-HOA radius algorithm.

The homeowner can:

- create a Clerk account or sign into an existing one using the exact invited email;
- see their HOA, unit label, and membership status;
- see compulsory recurring requests but cannot opt out or alter participation;
- see all valid bids and the winning bid for HOA transparency;
- vote in open surveys;
- opt into or decline optional non-recurring requests before enrollment closes;
- see the winning provider, service scope, their scheduled window, and progress;
- receive schedule/change/completion notifications;
- review a completed visit associated with their unit.

The homeowner cannot create HOA requests, accept bids, view another homeowner's private unit schedule, or manage residents.

### 4. Service provider

A provider has a provider account, verified service categories, and structured service coverage.

The provider can:

- state which services they offer;
- define service regions using supported cities/postal areas and/or a center-plus-radius coverage record;
- see open HOA requests only when category, coverage, provider status, and timing match;
- submit and revise a bid before bidding closes;
- see whether a bid is pending, accepted, or rejected;
- after winning, see only the service locations needed to perform the awarded work;
- propose or arrange the daily stop order on an HOA map;
- assign service windows and update visit status;
- record completion or an exception for each visit;
- see reviews for completed work.

A suspended, unverified, out-of-region, or wrong-category provider cannot bid even if they manipulate the browser.

## Account and authorization model

Keep public account kinds limited to homeowner and service provider. Bundleen admin remains privately provisioned. HOA manager authority is a scoped assignment attached to a separate invitation-only identity.

Required rules:

- Clerk proves identity, email verification, session, and password ownership.
- Neon is authoritative for account kind, HOA membership, unit association, manager assignment, provider status, and every business permission.
- The same email must not map to two Bundleen users.
- A manager invitation must be accepted by the exact verified invited email.
- A manager account must not be reused as an HOA resident account.
- A homeowner may never become an HOA manager through public signup or editable profile data.
- Every server read and write must scope records through the authenticated user's active membership/assignment.
- Route middleware is defense in depth, not the only authorization control.

Suggested routes:

- Bundleen admin sign-in: `/admin/sign-in`
- Bundleen operations: `/app/admin/**`
- HOA manager sign-in: `/hoa/sign-in`
- HOA invitation join/sign-in/accept: `/hoa/join/**`, `/hoa/invitation-sign-in/**`, `/hoa/accept/**`
- HOA manager workspace: `/app/hoa/**`
- HOA homeowner workspace: `/app/homeowner/**`
- Provider workspace: `/app/provider/**`

## Hard HOA/non-HOA separation

Official HOA communities and location-based non-HOA neighborhoods are different products and must not share membership rules.

- `Community.type = hoa`: invitation-only, unit-based membership; never populated by the geolocation matcher.
- `Community.type = neighborhood`: non-HOA homeowners are assigned by the existing server-side radius algorithm; no HOA unit or HOA invitation is involved.
- A homeowner with an active HOA membership cannot be automatically placed into a non-HOA neighborhood.
- A non-HOA homeowner must be removed or explicitly migrated before accepting an HOA invitation.
- Every request, membership, survey, bid, schedule, and dashboard query must filter through the correct community ID and type.
- Keep non-HOA UI behind its existing routes or a feature flag while HOA development is prioritized. Do not delete its data or migrations.

## HOA onboarding workflow

### Admin creates the HOA

Collect and validate:

- legal name and display name;
- primary street address, locality, state/region, postal code, and country;
- normalized address and verified latitude/longitude;
- timezone;
- total number of homes/units;
- optional HOA reference/code;
- optional service notes and known recurring service categories;
- onboarding status: `draft`, `manager_invited`, `manager_active`, `residents_inviting`, `live`, or `archived`.

The number of homes is not the active homeowner count. Store a unit inventory so vacant/uninvited homes are represented honestly.

Support small HOA unit creation in the UI and an idempotent CSV import for larger HOAs. Validate duplicates and show a dry-run summary before committing an import.

### Admin invites the first manager

Collect manager name, title, email, phone, and optional business/mailing address. Create an email-bound invitation with a seven-day expiry. The invitation must be resendable and revocable.

Only one active HOA manager may exist per HOA. Replacing a manager must revoke the previous assignment and activate the new one atomically where possible. Never ask an admin to choose an existing resident as the manager; this product requires a separate manager identity.

### Manager accepts and creates credentials

The emailed link opens the dedicated HOA invitation flow. A new manager creates a Clerk password and verifies email. An existing Clerk user signs in and returns to the same invitation acceptance route. Wrong-email sessions receive a clear error and cannot accept.

Acceptance creates or activates the Bundleen user and scoped HOA manager assignment, then redirects to `/app/hoa/dashboard`. It must be idempotent so refreshes and repeated callbacks cannot create duplicate users or assignments.

## Unit and homeowner management

Create a real `CommunityUnit`/`HoaUnit` concept rather than placing a unit number in free-form membership metadata.

Each unit needs:

- HOA/community ID;
- stable unit ID;
- display label such as `Home 14`, `Unit 2B`, or `11804 Cedar Lane`;
- service address fields or an inheritance link to the HOA address;
- verified coordinates when service stops differ by home;
- occupancy status such as `vacant`, `invite_pending`, `occupied`, or `inactive`;
- optional access/service instructions with strict authorization;
- timestamps.

For MVP, one active primary homeowner per unit is enough, but the schema should not prevent multiple authorized residents later. A membership connects a user, HOA, and unit. Enforce that the unit belongs to the same HOA as the membership.

### Manager invitation workflow

The manager selects or creates a unit, enters homeowner name and email, and sends an invitation.

- Bind the invitation to HOA, unit, normalized email, role, inviter, status, and expiry.
- Prefer Clerk-owned invitation tickets; do not store raw tickets.
- If a separate human-readable code is implemented, generate it cryptographically, store only a hash, rate-limit attempts, expire it, and bind it to the invited email and unit.
- Permit resend/revoke while preventing duplicate active invitations for the same unit/email.
- Acceptance requires the exact verified email.
- Successful acceptance activates the HOA membership and unit occupancy directly. There is no Bundleen admin approval step.
- A revoked, expired, already-used, wrong-email, or wrong-HOA invitation must fail safely with a useful screen.

## HOA service model

Recurring compulsory services and optional non-recurring services must not be represented as the same participation rule.

### Compulsory recurring service

Examples: gardening every two weeks, common pest control, or a recurring HOA-mandated exterior service.

- The HOA manager defines frequency, scope, eligible homes, start date, contract duration, bidding deadline, and service expectations.
- Active eligible HOA units are automatically included. Homeowners cannot join, leave, or vote themselves out through Bundleen.
- The procurement request is for a recurring agreement, not only one visit. A bid must state per-cycle price, total/estimated contract price, cadence, capacity, exclusions, and validity.
- Accepting a bid creates an agreement and materializes service occurrences/visits idempotently for the agreed period.
- Homeowners can see the request, all valid bids, the accepted provider/terms, upcoming occurrences, their unit schedule, and completion history.

### Optional non-recurring service

Examples: individual pool cleaning, window washing, pressure washing, or an optional seasonal service.

- The manager may first publish a survey to measure demand.
- A survey informs the manager; it does not automatically create or award a service request.
- The manager opens an optional request with an enrollment deadline and minimum/maximum home count where relevant.
- Homeowners explicitly join or decline while enrollment is open.
- The manager can see counts and participating units; one homeowner cannot see another homeowner's private response or schedule.
- Lock/snapshot the participant set before final bid comparison or award so providers quote against a stable number of homes.
- Only locked participating units become visits after an award.

### Surveys

Support manager-created surveys at a two-week or monthly cadence without hard-coding that cadence as the only option.

A survey includes:

- HOA ID and creator;
- question and two or more unique options;
- opens/closes timestamps;
- optional linked service category;
- status `draft`, `scheduled`, `open`, `closed`, or `cancelled`;
- one current vote per active homeowner, changeable only while open;
- aggregated results for the manager;
- no exposure of one resident's answer to other residents.

Prevent duplicate scheduled monthly surveys when the business rule is one per month, but allow an explicit admin-supported correction rather than silently overwriting history.

## Request, bid, award, and work lifecycle

Use server-enforced state machines. Do not let clients write arbitrary status strings.

### Request lifecycle

Recommended states:

`draft -> collecting_interest -> open_for_bids -> bidding_closed -> awarded -> scheduled -> in_progress -> completed`

Terminal alternatives: `cancelled` and, where needed, `failed`.

Not every state applies to every request:

- recurring compulsory requests normally move from `draft` directly to `open_for_bids`;
- optional requests use `collecting_interest`, then lock participants before `open_for_bids`;
- a request cannot be awarded before bidding closes unless the manager explicitly closes bidding early;
- completed/cancelled requests are immutable except for tightly controlled correction records.

### Provider request discovery

Show a request only when all are true:

- provider account is active and required verification is current;
- provider offers the request's service category;
- the HOA location falls within a structured active provider service area;
- bidding is open and not expired;
- provider has not been blocked from the HOA/request.

Before award, providers see the HOA/community location and aggregate home count required to quote, not resident names, emails, unit instructions, or precise household schedules.

### Bids

A bid needs:

- request and provider IDs;
- amount in integer cents and currency;
- pricing basis: total, per home, per visit/cycle, and any tier structure needed for optional counts;
- proposed start date and estimated duration;
- written scope, exclusions, cadence, and validity deadline;
- status `draft`, `submitted`, `withdrawn`, `accepted`, `rejected`, or `expired`;
- version/timestamps so revisions are traceable.

Provider rules:

- one current submitted bid per provider/request;
- revisions allowed only before bidding closes;
- no bid after deadline, suspension, category removal, or service-area removal;
- provider cannot see competitors' exact bid values while bidding is open.

Homeowner transparency:

- active HOA homeowners can see every valid submitted bid for their HOA request, including provider identity, verified status, price breakdown, scope, estimated timing, and eventual winner;
- sensitive provider documents and internal admin notes remain private;
- homeowners cannot accept, reject, revise, or rank bids.

### Award

Only the active HOA manager for that HOA can accept a bid.

Awarding must atomically:

- verify request and bid are still eligible;
- mark exactly one bid accepted;
- mark other current bids rejected;
- snapshot the accepted commercial terms;
- create the service agreement/work order;
- lock the participating unit set;
- append an audit event;
- enqueue notifications through an outbox.

Repeated clicks or network retries must return the same award rather than creating two agreements. A database constraint must prevent more than one accepted bid per request.

## Scheduling, map, and route planning

After award, create one visit/stop per participating unit for each required service occurrence. The provider then plans the day.

Each visit should include:

- agreement/occurrence and unit IDs;
- assigned service date;
- stop rank;
- estimated arrival window and duration;
- status `unscheduled`, `scheduled`, `en_route`, `in_progress`, `completed`, `skipped`, `blocked`, or `cancelled`;
- provider completion note and optional proof attachment;
- timestamps for important transitions.

### Provider day planner

Provide both a map and an accessible ordered list. For ten homes, the provider can drag/reorder or otherwise rank the stops, see the route, and publish the plan.

- Manual provider ordering is always available and remains authoritative after confirmation.
- If automatic optimization is added, use a configured hosted/self-hosted routing engine that explicitly supports routing/matrix/optimization. OpenStreetMap supplies data, not a universal public routing API.
- Keep routing behind a `RouteProvider` interface so Geoapify, OSRM, Valhalla, GraphHopper, or another provider can be replaced.
- Validate coordinate order and bounds. Domain objects use `{ latitude, longitude }`; convert only at provider boundaries.
- Send exact unit coordinates to the routing provider only after award and only when necessary.
- Do not persist an entire raw third-party response. Store the confirmed order, estimated distances/durations, and only route geometry needed by the UI.
- Show visible OSM and tile/routing-provider attribution.
- Provide text/list alternatives, loading/error states, and keyboard-accessible controls.

The provider proposes/publishes a plan. The HOA manager can see the full HOA plan. Each homeowner sees only their own visit window plus safe community-level progress, not other residents' private addresses or access notes.

### Schedule notifications

Notify relevant users when:

- a plan is first published;
- a visit date/window changes;
- a day-before reminder is due;
- the provider marks `en_route` where supported;
- a visit is completed, skipped, or blocked.

Use an outbox/job design so database commits do not depend on an email provider call succeeding. Notification jobs must be idempotent and retryable.

## Completion and reviews

The provider records completion per visit. The manager can close the overall occurrence only after all required visits are completed or explicitly resolved as skipped/blocked.

- Keep completion history; do not overwrite prior status timestamps.
- Allow a homeowner to report an issue on their own visit.
- Allow one homeowner review per completed visit and one manager/community review per completed agreement or occurrence.
- Only participants with completed work may review.
- A provider cannot review itself or edit another person's review.
- Rating bounds, text limits, moderation state, and timestamps are server validated.
- Display aggregate provider ratings only from eligible non-removed reviews.

Payment processing is not part of this phase unless real processor credentials, fee policy, refunds, and legal ownership are separately specified. Store bid/agreement amounts accurately in cents, but do not show fake “paid” or payout claims.

## Notifications and communication

At minimum support in-app notification records and an email delivery abstraction for:

- manager invitation;
- homeowner invitation/resend/revocation;
- survey opened and reminder;
- optional request enrollment opened/closing;
- request opened for bids;
- bid received and bidding closed;
- bid awarded/rejected;
- schedule published/changed;
- service reminder, exception, completion, and review request.

Store delivery status and provider message ID, but never store password-reset or Clerk session secrets. Notification preferences must not suppress security-critical invitation/account messages.

## Proposed data model

Adapt existing Prisma names where sensible. Do not create parallel duplicate concepts simply because an older table has a less ideal name.

Required domain records:

- `User`: Clerk identity mapping and global account kind.
- `AdminAccessGrant`: internal admin allow-list.
- `Community`: HOA/non-HOA type, status, name, location.
- `HoaProfile`: legal/onboarding details, timezone, declared home count.
- `CommunityUnit`: HOA home/unit inventory and private service location.
- `CommunityMembership`: homeowner-to-HOA-and-unit relationship.
- `CommunityStaffAssignment`: scoped HOA manager authority.
- `CommunityInvitation`: manager/homeowner invitation, unit binding for homeowners.
- `ProviderProfile`: verification and account state.
- `ProviderServiceCategory`: services the provider offers.
- `ProviderServiceArea`: structured coverage geometry/radius/postal area.
- `HoaSurvey` and `HoaSurveyVote`.
- `ServiceRequest`: recurring compulsory or optional request and state machine.
- `RequestParticipant`: optional participation or compulsory audience snapshot.
- `ServiceBid` and immutable bid revisions/snapshots where needed.
- `ServiceAward`/`ServiceAgreement`: accepted terms and provider.
- `ServiceOccurrence`: one recurring cycle or one non-recurring service date.
- `ServiceVisit`: unit-level stop, schedule, and completion.
- `Review`.
- `Notification` and `OutboxEvent`.
- append-only `AdminAuditLog`/domain activity log for sensitive actions.

Database invariants must cover at least:

- one active HOA manager per HOA;
- active HOA membership references a unit in the same HOA;
- one active primary homeowner per unit for MVP;
- one active invitation per relevant HOA/unit/email/role;
- one current submitted bid per provider/request;
- one accepted bid/award per request;
- unique request/unit participant snapshot;
- unique occurrence/unit visit;
- unique eligible review per reviewer/visit or manager/agreement;
- state/date consistency;
- money is nonnegative integer cents;
- latitude/longitude ranges;
- HOA-only records cannot reference a neighborhood community.

Use reviewed migrations and preserve existing records. Do not edit an already deployed migration; add a new migration.

## Map, geocoding, routing, and privacy rules

- Keep tile, geocoding, and routing endpoints configurable.
- Restrict browser-safe Geoapify keys to Bundleen origins. Keep secret routing/provider credentials server-only.
- Do not use public Nominatim autocomplete or bulk/background geocoding.
- Do not use `tile.openstreetmap.org` for bulk prefetch, offline download, or commercial SLA assumptions.
- Preserve visible `© OpenStreetMap contributors` and provider attribution.
- Cache permitted stable geocoding results and avoid repeatedly sending resident addresses to third parties.
- Exact unit coordinates, access notes, emails, and visit times are private. Expose them only to the assigned provider after award, the scoped HOA manager, the resident for their unit, and authorized Bundleen admins.
- Never place precise resident locations, invitation emails, or route payloads in immutable audit metadata or application logs.
- Include a non-map address/ordered-stop view for accessibility and service outages.

## API and security requirements

- Authenticate and authorize every server read/write using live Neon records.
- Prevent IDOR: possession of an HOA/request/unit ID never grants access.
- Use strict Zod schemas, request body limits, normalized email, bounded text, coordinate, date, and money validation.
- Reject unknown fields for sensitive mutations.
- Rate-limit invitations, code attempts, votes, bids, awards, schedule publishing, and status changes.
- Use short transactions suitable for serverless Postgres.
- Use idempotency keys or unique constraints for invitation acceptance, award, recurring occurrence generation, outbox delivery, and completion.
- Handle concurrent award/join/vote/update attempts and return clear `400`, `401`, `403`, `404`, `409`, and `429` responses.
- Do not expose Prisma/Postgres/Clerk internals in UI errors.
- Audit manager assignment/revocation, invitations, unit import, request publishing, participant lock, award, schedule publication, forced status corrections, provider verification, and review moderation.
- Keep audit metadata allow-listed and free of addresses, coordinates, raw email content, tokens, and access notes.
- Sanitize file uploads, limit size/type, use private URLs where documents contain resident/service details, and never trust client MIME alone.
- Suspended providers immediately lose new-bid and schedule-mutation access while historical records remain visible.

## Required UI areas

### Bundleen admin portal

- Overview with real HOA onboarding states and counts.
- HOA list/search/filter.
- Create/edit HOA wizard.
- Unit generation/import with validation preview.
- Manager invite/resend/revoke/replace.
- HOA detail showing manager, units, resident invitation progress, requests, and audit events.
- Provider verification/status/service-region controls.

### HOA manager portal

- Overview: units, active homeowners, pending invites, open surveys, open requests, bids awaiting decision, upcoming work, exceptions.
- Home/unit roster and invitation tools.
- Surveys and result summaries.
- Recurring service program/request builder.
- Optional service interest/enrollment builder.
- Bid comparison and single award action.
- Award/agreement detail.
- Calendar/map schedule view, homeowner notifications, completion tracking, and issue list.

### HOA homeowner portal

- HOA/unit overview.
- Compulsory requests with transparent bids and award.
- Surveys.
- Optional requests with join/decline state.
- Personal upcoming visit window and safe request progress.
- Completed visits and reviews.

### Provider portal

- Categories, verification state, and structured service-region settings.
- Eligible open request feed.
- Request detail and bid editor/history.
- Won agreements/upcoming occurrences.
- Daily map/list planner with stop ordering and schedule publication.
- Visit status/completion tools.
- Reviews and accurate performance totals.

Use honest loading, empty, error, expired-invitation, wrong-account, suspended-account, and stale-state screens. Remove or clearly quarantine old mock screens once real equivalents exist.

## Seed and test data

Create deterministic, explicitly synthetic fixtures using `.example` emails and fake Clerk IDs that cannot sign in.

Minimum fixture:

- one North Austin HOA with ten units;
- one separate HOA manager account;
- at least six active invited homeowners assigned to six different units;
- vacant and pending-invite units;
- two active in-region providers offering the relevant categories;
- one out-of-region provider;
- one suspended provider;
- one compulsory biweekly gardening request with multiple bids;
- one optional pool-cleaning survey/request with mixed join/decline responses;
- one awarded job with ten ordered visits and realistic schedule windows;
- completed visits and eligible reviews;
- the existing Domain-area non-HOA fixture kept separate.

Seed coordinates directly. Automated tests must mock geocoding, routing, email, and Clerk network calls rather than sending traffic to public/community services.

## Mandatory end-to-end test scenarios

1. Admin creates an HOA, ten units, and a manager invitation.
2. Manager accepts with the exact email, sets Clerk credentials, and reaches the HOA dashboard.
3. Wrong email, expired, revoked, duplicate, and repeated manager acceptance fail or resolve idempotently.
4. Manager invites homeowners to units; exact-email acceptance activates the correct HOA/unit membership without admin approval.
5. A unit cannot accidentally receive conflicting active primary homeowners.
6. An HOA homeowner is never added to the non-HOA radius community.
7. Manager creates compulsory biweekly gardening; every eligible unit is included and homeowners cannot opt out.
8. Homeowners can see gardening bids but cannot accept or mutate them.
9. Manager publishes a pool-cleaning survey, homeowners vote once/change while open, and manager sees correct aggregates.
10. Optional request collects joins/declines, locks participants, and excludes nonparticipants from visits.
11. Active in-region/category providers see and bid; out-of-region, wrong-category, unverified, and suspended providers cannot.
12. Two simultaneous award attempts produce exactly one accepted bid and agreement.
13. All homeowners see transparent bid/award data without seeing other residents' private data.
14. Winning provider sees the awarded units, ranks ten stops, publishes schedule windows, and cannot access another HOA.
15. Each homeowner sees only their own window; manager sees all HOA visits.
16. Schedule changes create one idempotent notification per intended event.
17. Provider completes visits; unresolved visits prevent false full completion.
18. Only eligible homeowner/manager accounts can review completed work, once per allowed subject.
19. Suspended provider loses mutation access immediately without deleting historical bids/work.
20. Refreshes, retries, stale tabs, and concurrent mutations do not duplicate invitations, votes, awards, visits, notifications, or reviews.

Run unit tests, API/service integration tests against an isolated database, and browser-level happy-path tests for all four actors. Test desktop and narrow mobile layouts for auth, manager, homeowner, and provider critical paths.

## Implementation order

1. Audit existing real versus mock data paths and write a migration/backfill plan.
2. Add HOA profile, unit inventory, service area, request/bid/award/agreement/visit/review/outbox schema and database invariants.
3. Complete admin HOA onboarding and manager invitation.
4. Complete manager unit roster and homeowner invitations.
5. Complete surveys and optional participation locking.
6. Complete provider region/category matching and real request feed.
7. Complete bidding, transparent resident views, and atomic manager award.
8. Complete occurrences, visits, provider route/day planner, and notifications.
9. Complete service status, exceptions, reviews, and aggregate reporting.
10. Replace remaining mock screens, seed synthetic scenarios, execute the entire test matrix, run the OSM audit, and perform a final authorization/privacy review.

Do not mark a phase complete if its UI is disconnected from the real lifecycle or if the next state cannot be reached.

## Definition of done

The HOA-first application is complete when:

- Bundleen admin can create and fully onboard an HOA and first manager;
- manager can securely create credentials from an invitation and operate only their HOA;
- manager can create/import units and invite homeowners to specific units;
- homeowners can join securely and receive transparency without management authority;
- recurring compulsory and optional services behave differently and correctly;
- surveys, participation, provider discovery, bids, single-bid award, schedules, completion, and reviews work end to end with real database records;
- providers see only eligible regional work and can plan awarded visits on an attributed map/list;
- notifications are durable, retryable, scoped, and idempotent;
- HOA and non-HOA users/data cannot be mixed accidentally;
- no critical workflow relies on mock data or client-side authorization;
- migrations deploy cleanly, all tests pass repeatedly, production build passes, and the OpenStreetMap integration audit reports no errors;
- security review finds no role escalation, cross-HOA access, invitation takeover, bid double-award, resident-location leak, secret exposure, or unsafe third-party map usage.

## Explicitly deferred

Unless separately requested, do not add payment processing, HOA accounting, legal e-signatures, multi-level referral rewards, autonomous AI bid awards, or automatic public-OSM editing. Leave clear extension points rather than fake versions of these features.

---

## Implementation decision log (2026-08-16)

Recorded per the instruction above: where the brief left a detail open, the
safest simple implementation was chosen and noted here.

1. **Provider service categories reuse `ProviderProfile.trades`.** The brief
   lists a `ProviderServiceCategory` record, but a structured category table
   would duplicate the existing verified `trades` array. Matching is
   case-insensitive on the request's category string.
2. **Bid revisions update one row with a `version` counter** (unique
   `requestId+providerUserId`), rather than immutable revision rows. "One
   current submitted bid per provider/request" is enforced by that unique key;
   traceability comes from `version`, `submittedAt`, and `updatedAt`.
3. **Request state machine reuses `HoaServiceRequest`** (no parallel
   `ServiceRequest` table). The old `draft/open/closed/cancelled` enum was
   migrated in place: `open` → `collecting_interest` (optional) or
   `open_for_bids` (compulsory), `closed` → `bidding_closed`. `closesAt` was
   split into `enrollmentClosesAt` and `biddingClosesAt` by request kind.
4. **Compulsory audience = every unit not `inactive`,** snapshotted (and
   locked) at publish time into `HoaRequestParticipation` with nullable
   `userId` for vacant homes. Optional participation rows carry the resident's
   unit and a `joined/declined` response; the set locks when bidding opens.
5. **Provider marketplace eligibility requires** `accountStatus = active` AND
   admin-verified license AND insurance timestamps, a category match, and an
   active service area (center+radius circle or postal code) covering the
   HOA profile's location. No area on file means eligible nowhere.
6. **Award is one `$transaction` batch** guarded by two unique indexes (one
   agreement per request, one accepted bid per request). A concurrent or
   repeated award either returns the existing agreement id (same bid) or 409s
   (different bid). Occurrences and visits materialize in the same batch with
   `skipDuplicates` uniques, so retries cannot duplicate them.
7. **Awarding requires `bidding_closed`.** The manager explicitly closes
   bidding (early if desired) via a named transition action; clients never
   write raw status strings.
8. **Occurrence dates are computed as `startDate + (n-1) × intervalDays`**
   (UTC timestamps; the HOA's IANA timezone is stored for display). Capped at
   104 occurrences by CHECK constraint.
9. **Notifications are dedupe-keyed in-app rows plus an email `OutboxEvent`**
   written in the same transaction as the domain change; a claim-based worker
   (`/api/jobs/outbox`, Vercel Cron GET or Bearer-authenticated POST) delivers
   with exponential backoff and 8 attempts. With no `RESEND_API_KEY`, sends
   log to the server console — nothing fakes delivery.
10. **Route optimization is deferred; manual ordering is authoritative.** The
    provider planner is the accessible ordered list with rank controls and
    time windows the brief requires as the baseline; a `RouteProvider`
    integration can be added behind the existing planner API without schema
    changes. No third-party routing calls are made today.
11. **Managers may also add/edit units** (roster maintenance is a manager
    duty in the brief); bulk CSV import lives in the admin portal.
12. **Pre-inventory pending homeowner invitations were revoked by migration**
    (they cannot bind to a unit); existing active HOA memberships got
    backfilled `Home N` units so the one-unit-per-membership invariant holds
    without deleting history.
13. **Historical `hoa_manager`/`hoa_team` staff roles are unchanged**, but
    only one active `hoa_manager` is invitable per HOA (existing partial
    index), and every marketplace authority check requires the live scoped
    assignment.
