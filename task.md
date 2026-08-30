# Task: Complete the non-HOA marketplace and simplify address-based HOA onboarding

## Objective

Implement the complete service lifecycle for non-HOA, location-based neighborhood communities while preserving the existing HOA workflow. A non-HOA homeowner request must no longer stop at `collecting_interest`: eligible providers must be able to discover it, bid, be selected, schedule the participating homes, complete the work, and receive reviews.

Also simplify Bundleen admin HOA onboarding. Admin users must enter normal street-address information only. Bundleen must resolve and store latitude/longitude in the background; latitude and longitude must not appear as routine fields in the admin interface or CSV workflow.

This is production functionality, not a prototype. Use the existing Clerk authorization, Prisma/Postgres database, Geoapify integration, provider service-area system, notification outbox, audit log, and established dashboard design. Do not build a parallel mock marketplace or preserve legacy endpoints that are not backed by real Route Handlers.

Before starting, preserve the uncommitted support-ticket and homeowner-request fixes already in the working tree. Review and integrate with them rather than reverting or replacing them.

---

## Product rules

Bundleen has two distinct community types that share providers and selected marketplace infrastructure.

### Official HOA

- An invited HOA manager creates compulsory recurring or optional group requests.
- HOA homeowners receive transparency and participate only where the existing HOA rules permit.
- HOA awards create agreements, occurrences, and visits targeting HOA `CommunityUnit` rows.
- Existing HOA behavior and permissions must remain intact.

### Non-HOA neighborhood

- Homeowners are assigned algorithmically to a radius-based `neighborhood` community using their saved home coordinates.
- One active homeowner member may be assigned `neighborhood_manager` by a Bundleen admin. There may be no more than one active neighborhood manager per community, and the manager must remain an active resident of that same community.
- An active non-HOA homeowner may submit a service request for their neighborhood.
- The requester is automatically joined. Other active homeowners in the same neighborhood may join or decline while interest collection is open.
- The neighborhood manager manages the group-service lifecycle from the normal homeowner account. Do not create a third public account type or separate neighborhood-manager login.
- The manager can close enrollment/open bidding, close bidding, compare transparent bids, and award one bid. An authorized Bundleen admin may perform recovery actions, but ordinary residents cannot award or promote themselves.
- A request can proceed with one participating home when it is an individual request. Do not require multiple homes unless that request explicitly has a higher `minHomes` rule.
- Official HOA residents and non-HOA homeowners must never be mixed into the wrong workflow merely because both requests share tables.

---

## Current confirmed gaps

The current partial non-HOA implementation creates a row in `HoaServiceRequest` with:

```text
community.type = neighborhood
kind = optional_group
status = collecting_interest
totalOccurrences = 1
```

That reuse is acceptable, but the remaining lifecycle is HOA-only:

- `getProviderHoaWorkspace` filters opportunities to `community.type = hoa`.
- `submitBid` rejects requests whose community is not an HOA.
- request transitions and awards call `requireManagedHoa`.
- `open_bidding` only counts participations with a non-null HOA `unitId`.
- `awardBid` requires participating HOA units.
- every `ServiceVisit` requires a `CommunityUnit`.
- Provider Job Feed calls legacy paths including `/api/provider/job-feed`, `/api/provider/bids`, and `/api/requests/[id]/bids`, which do not have current Route Handlers.

Do not merely remove the HOA checks. That would create bids that cannot be awarded and visits with no valid service target.

---

## Part 1 — Model a safe shared HOA/non-HOA lifecycle

### Shared aggregate and invariants

Continue using shared request, bid, agreement, occurrence, and visit concepts unless migration analysis proves a split is safer. Context must be derived from `Community.type`, never a client body.

Names such as `HoaServiceRequest` may be refactored only through a safe migration when the benefit justifies the risk. Behavior and authorization matter more than a cosmetic rename.

Enforce these database and server invariants:

- HOA request → participation/visit target uses `CommunityUnit`.
- Neighborhood request → participation/visit target uses an active neighborhood homeowner and verified service address.
- Exactly one valid visit target is present.
- The target belongs to the same community/request as the agreement.
- One bid per provider/request, at most one accepted bid per request, and one agreement per request remain enforced.
- Money remains integer cents with consistent currency handling.

### Generalize visit targets safely

Extend `ServiceVisit` so it represents either:

- an HOA unit target; or
- a non-HOA homeowner target.

For neighborhood visits, create an immutable service-location snapshot at award time containing the address and coordinates required to perform and route the work. Retain an authorized relation to the participating homeowner where appropriate.

Do not make `unitId` nullable without an exactly-one-target database constraint. Do not reread a mutable profile address for historical work; later profile edits must not rewrite an awarded location.

Exact addresses, access notes, and coordinates may be returned only to the resident, properly scoped manager/admin, and awarded provider for the agreement they won. Unawarded providers receive approximate community location and distance only.

### Safe migration

Create forward-only Prisma migration(s) that:

- preserve all HOA requests, bids, agreements, occurrences, visits, reviews, and audit history;
- add/backfill required context, target, snapshot, and relationship fields;
- add check constraints, foreign keys, unique indexes, and feed/schedule indexes;
- use staged nullable → backfill → constraint changes where necessary;
- apply through the normal production migration command without manual database edits.

Include an operational recovery note. Do not delete or reinterpret existing HOA data.

---

## Part 2 — Complete neighborhood enrollment and bidding

### Request creation and participation

When an eligible non-HOA homeowner creates a request:

- derive owner and neighborhood from the Clerk session and active membership;
- create a one-off optional request in `collecting_interest`;
- automatically create a joined participation for the requester using the homeowner target, not an HOA unit;
- set an enrollment deadline and a default `minHomes` that permits one home;
- notify eligible active neighbors without revealing the requester's exact address;
- make duplicate submission idempotent.

Add participation API/UI so active members of that exact neighborhood can join or decline while enrollment is open. Repeated calls must be idempotent. Outsiders receive `403` without learning private details.

### Lifecycle ownership

Create context-aware authorization rather than weakening `requireManagedHoa`:

- HOA transitions continue to require the scoped HOA manager.
- Neighborhood transitions require the active `neighborhood_manager`, who must also be an active resident of that community.
- Authorized Bundleen admins may use an audited recovery path.
- The creator may edit/cancel only during defined pre-bidding states; creating a request does not grant manager authority.

The neighborhood manager must be able to:

1. review joined/declined counts;
2. close enrollment and open bidding after checking `minHomes`;
3. set a future bidding deadline;
4. close bidding;
5. compare submitted bids;
6. award exactly one bid;
7. monitor scheduling, visits, completion, and reviews.

Deadline handling must be deterministic. A scheduled reconciliation may advance expired windows, but the same domain functions must be safely callable from the manager UI. Repeated/concurrent transitions must not duplicate records or notifications.

### Provider discovery and service-area matching

Replace the split/legacy provider feed with one real provider marketplace contract returning eligible open HOA and neighborhood opportunities.

Compute eligibility server-side from:

- active provider account status;
- matching trade/category;
- active provider service-area circles/postal codes;
- verified request/community location;
- `open_for_bids` status and a non-expired deadline.

For neighborhood requests, use a server-approved approximate point without exposing participant coordinates. Return locked home count, scope, permitted budget range, approximate distance, deadline, pricing choices, and the provider's own bid. Do not return competitor amounts or exact stops to an unawarded provider.

Remove or migrate nonexistent legacy endpoints. Use Prisma string IDs consistently. Do not create a second provider bid store or number-ID compatibility layer.

### Bid submission

Eligible active providers must submit, revise, and withdraw bids for either community type through one canonical server contract.

Validate provider status/identity, category, service-area eligibility, request state/deadline, integer-cent amount, pricing basis/per-home breakdown, scope, exclusions, cadence, proposed date, duration, validity, and uniqueness.

Notify the correct manager and participants according to preferences without leaking commercial details to competitors.

### Transparency and award

The neighborhood manager and joined participants may see bid comparisons. Non-participants may not see private bid data. Only the neighborhood manager or authorized Bundleen admin may award.

Award must be atomic and idempotent. It must:

- verify a neighborhood request in `bidding_closed`;
- verify the chosen valid submitted bid;
- snapshot accepted terms;
- lock participants and each service location;
- accept one bid and reject the rest;
- create one agreement and the one-off occurrence;
- create one valid visit per joined neighborhood home;
- update request status/timestamps;
- write audit/domain events and queue notifications.

Design for future recurring neighborhood services without another schema redesign. If any required participant lacks a verified address, create no partial award; return an actionable list/count so addresses can be corrected.

---

## Part 3 — Neighborhood scheduling, completion, and reviews

Generalize the current provider schedule workflow:

- Only the awarded provider can see the agreement's exact stops.
- The provider can rank stops, set dates/windows/estimates, publish a plan, and update visit status.
- Participants and manager receive schedule/change/cancellation/en-route/completion/review notifications as appropriate.
- A homeowner sees only their own exact stop plus allowed group-level progress.
- A manager sees group progress but not private access notes unless authorized.
- Agreement completion is blocked while required visits/occurrences remain unresolved.
- Each homeowner may review their completed visit once. Retain a manager group/agreement review if the product still uses it.

Update Provider **Job Feed**, **My Bids**, **Schedule**, **Earnings**, Homeowner **My Requests**, **My Bids**, notifications, and neighborhood-manager controls so they show the same persisted lifecycle. Remove placeholder/local-only data.

---

## Part 4 — Address-only admin HOA onboarding

### Current problem

`src/components/admin/HoaOnboardingPanel.tsx` asks admins for street address plus raw latitude/longitude. Unit CSV instructions also advertise coordinate columns. This is error-prone and unacceptable for normal onboarding.

### Required experience

Show only human/business fields for an HOA profile:

- legal/display name;
- street and optional second address line;
- city, state/region, postal code, and country;
- total homes and legitimate operational fields.

Remove latitude/longitude inputs. Display the canonical address and a simple **Address verified**, **Verification pending**, or **Needs correction** status. A map pin preview is acceptable, but never require or prominently display coordinate numbers.

When an address is saved or materially changed:

1. normalize and validate it;
2. forward-geocode it on the server through a provider abstraction;
3. reuse Geoapify rather than an OpenStreetMap Foundation public geocoding service or a second provider;
4. distinguish confident exact results from ambiguous/low-confidence results;
5. atomically store normalized address and coordinates for an exact result;
6. return normalized address candidates for confirmation when ambiguous—still no coordinate entry;
7. preserve entered form values and show retry on timeout/quota/unavailability;
8. do not mark the HOA ready/live with stale or missing coordinates;
9. re-geocode every material address change;
10. store verification status/timestamp and provider place identifier where useful.

Coordinates remain internal for matching, maps, distance calculations, and scheduling.

### Server-side Geoapify boundary

Use a server-only abstraction such as:

```text
Geocoder.search(canonicalAddress, locale, limit) -> normalized candidates
Geocoder.resolve(canonicalAddress) -> verified address + latitude + longitude + confidence
```

Requirements:

- Use a server-only variable such as `GEOAPIFY_API_KEY`; do not expose a privileged key in the browser. Existing browser-safe tile/search configuration may remain separate and domain-restricted.
- Keep base URL, timeout, bounded result limit, and cache TTL configurable.
- Validate/encode inputs, use abortable finite timeouts, deduplicate identical in-flight lookups, and cache normalized results according to Geoapify's current plan and retention terms.
- Do not retry validation/4xx errors. Use bounded retries only for transient failures and honor rate-limit responses.
- Never log full customer addresses, keys, raw provider responses, or precise coordinates in ordinary logs/analytics.
- Normalize provider responses at the boundary; do not spread Geoapify shapes through domain/UI code.
- Verify current Geoapify attribution, storage/retention, and production terms before deployment.
- Never silently fall back to an OpenStreetMap Foundation public geocoding endpoint; it is unsuitable for this generic background lookup flow and has strict shared-use rules.

### HOA units and neighborhood geometry

- Manual unit entry and CSV must accept address fields without latitude/longitude columns.
- A unit with no distinct address may inherit the verified HOA location where accurate.
- A distinct unit address is geocoded server-side and stores internal coordinates.
- Batch imports use bounded queued processing, caching/deduplication, progress/error reporting, and retry—not hundreds of simultaneous calls.
- Dry run validates rows without writes or unnecessary external geocoding.
- Do not make the HOA operational or award routeable work while required locations are unresolved.
- Remove coordinate inputs from other routine HOA admin editors.
- Neighborhood radius geometry remains admin-owned, but its center should be chosen through address search/map selection rather than raw coordinate fields.

---

## Part 5 — HOA-only community amenities, reservations, issues, and reviews

This entire section applies only to official `hoa` communities. Do not expose amenities to location-based neighborhoods, providers, unaffiliated homeowners, or the public internet. Every read and write must be tenant-scoped to an active HOA membership, an active staff assignment for that HOA, or a Bundleen admin.

### Amenity catalog and listing-style resident UI

Add an **Amenities** destination to the HOA homeowner experience. The default view should be a production-quality vertically scrollable list similar to a modern places/listing application, using the existing Bundleen design system rather than copying Google's branding.

Each published amenity card should show:

- cover photo;
- amenity name and type, such as badminton court, tennis court, pool, gym, clubhouse, barbecue area, meeting room, or playground;
- open, closed, maintenance, or temporarily unavailable status;
- opening hours or the next open period;
- **Booking required** or **No booking required**;
- next available time when booking is required;
- capacity/party-size information where relevant;
- average rating and review count;
- short location label within the HOA, without exposing access-control details.

The amenity detail page should include an accessible gallery, description, features, operating hours, booking rules, capacity, permitted uses, age/guest restrictions, cancellation policy, map/location label where useful, availability calendar, review summary/distribution, review list, manager responses, and **Report an issue** action.

For an amenity that does not require booking, do not render a fake calendar. Show current availability, hours, rules, closures, photos, reviews, and issue reporting.

Provide loading, empty, closed, maintenance, fully booked, offline, and error states. The list/gallery/calendar must work on mobile, tablet, and desktop, support keyboard navigation and screen readers, and respect reduced motion.

### Amenity configuration and manager controls

Add an **Amenities & spaces** workspace to the invitation-only HOA manager dashboard. A manager may manage amenities only for HOAs they actively manage.

Managers must be able to:

- create a draft amenity and publish it when complete;
- edit name, type, description, features, location label, capacity, rules, and contact/instructions;
- configure whether booking is required;
- configure operating hours per weekday in the HOA's IANA timezone;
- configure slot duration, minimum/maximum duration, buffer/cleanup time, maximum party size, how far ahead residents may book, minimum notice, cancellation cutoff, bookings per resident/unit, and whether manager approval is required;
- represent capacity correctly, including one exclusive court/room or multiple equivalent bookable resources;
- add recurring closures, one-off blackout periods, holidays, maintenance periods, and private HOA events;
- temporarily close/reopen an amenity with a resident-visible reason and expected reopening time;
- reorder gallery photos and choose a cover photo;
- view bookings in day/week/list formats and filter by amenity/status/resident/unit;
- approve or decline requests when approval is enabled, cancel or reschedule with a reason, mark completion/no-show, and export a bounded operational list where appropriate;
- view amenity utilization and issue counts without exposing data across HOAs;
- archive an amenity without deleting its historical bookings, reviews, or issue audit trail.

Destructive or resident-affecting changes require confirmation. A rule change must not silently rewrite an already confirmed booking. Snapshot the rules/timezone relevant to each booking, or define explicit migration/cancellation behavior with affected-resident notifications.

### Admin HOA onboarding integration

Add an **Amenities setup** step to the Bundleen admin HOA onboarding flow. It should appear with the HOA profile, verified address, unit inventory, and manager onboarding—not as raw database fields.

Bundleen admins must be able to:

- record whether the HOA has shared amenities;
- add initial amenities from optional templates such as pool, clubhouse, gym, tennis/badminton court, meeting room, and other;
- set basic details, booking-required status, capacity, hours, and initial operational status;
- save incomplete amenities as drafts for the invited HOA manager to finish;
- see readiness indicators and prevent accidental publication of an amenity with invalid hours/rules;
- hand ownership of ongoing management to the scoped HOA manager after activation while retaining audited admin recovery access.

Coordinates must not be requested for ordinary amenity onboarding. Use the verified HOA/property address or a human location label unless an internal map point is genuinely needed; resolve any internal coordinates through the same address/map workflow described above.

### Booking and availability engine

Create a server-authoritative availability engine. The browser may preview slots, but it must never decide whether a time is bookable.

Availability must account for:

- HOA timezone and daylight-saving transitions;
- weekly operating hours and overnight ranges;
- amenity/resource capacity;
- confirmed bookings and approval-pending holds according to policy;
- slot/duration alignment and cleanup buffers;
- blackout, maintenance, holiday, and private-event periods;
- minimum notice and maximum advance window;
- resident/unit booking limits;
- party size and amenity capacity;
- booking/cancellation status.

Store instants in UTC and evaluate/display them using the HOA's IANA timezone. Handle ambiguous/nonexistent daylight-saving times explicitly.

Booking creation must be atomic and safe under simultaneous submissions. Use a database-enforced exclusion/unique-slot strategy or a correctly locked/serializable capacity algorithm. A check-then-insert performed without database concurrency protection is unacceptable. Test two residents attempting the final slot at the same time; only the allowed capacity may succeed.

Define explicit statuses such as `pending_approval`, `confirmed`, `declined`, `cancelled_by_resident`, `cancelled_by_manager`, `completed`, and `no_show`. Generate a human-friendly confirmation reference while retaining an opaque database ID. Repeated submissions/clicks must be idempotent.

Only an active HOA homeowner may book for themselves/their active unit, subject to the configured rules. A manager may create an operational booking/block for that HOA but cannot impersonate a resident silently. Archived/removed memberships cannot create bookings and their future bookings require an explicit manager policy, not accidental orphaning.

### Booking notifications and 30-minute reminder

Use the existing in-app notification plus outbox/Resend pipeline for:

- booking requested/confirmed;
- approval, decline, cancellation, or reschedule;
- manager-created closure or maintenance affecting a booking;
- reminder approximately 30 minutes before the confirmed start;
- optional completion/review request.

The 30-minute reminder must be durable and server-driven. Do not use `setTimeout`, a service worker, an open browser tab, or the current once-daily `0 13 * * *` recovery cron as the scheduler.

Implement delayed notification delivery by extending the existing durable outbox/scheduled-job design so a reminder is due at `startsAt - 30 minutes`. Run a protected worker frequently enough to meet the promised window (target every 1–5 minutes), using a Vercel plan that supports the cadence or an explicitly configured durable scheduler/queue. Keep the existing daily job only as recovery if desired.

Requirements:

- stable booking/reminder dedupe key;
- concurrent worker safety;
- retry/backoff and observable dead-letter/failure state;
- timezone-independent UTC due time;
- immediate sensible behavior when a booking begins in less than 30 minutes;
- cancellation/reschedule invalidates the old reminder and schedules the new one;
- worker rechecks the canonical booking status/time before delivery so a stale cancelled booking is never reminded;
- in-app and email preferences are honored, while operational cancellation messages follow the documented policy;
- no address, access code, private issue text, or unnecessary personal data in outbox payloads.

### HOA-scoped amenity emails

Allow the HOA manager to compose amenity-related communications from the amenity workspace, scoped only to their HOA. Supported audiences should include all active HOA residents, residents with an upcoming booking for that amenity, and residents whose bookings are affected by a closure/change.

Reuse the existing broadcast/outbox infrastructure with HOA-specific authorization, audience preview, test-send, explicit final confirmation, batching, idempotency, delivery status, and audit trail. The manager must never access the Bundleen global broadcast audience or another HOA's residents. General announcements honor communication preferences; urgent safety/closure overrides must be explicit, justified, narrowly scoped, and audited.

### Amenity issue/complaint tickets

An active HOA homeowner may open an amenity issue from that amenity's page. This is an HOA operations ticket routed to that HOA's manager—not a Bundleen customer-support ticket and not the global Bundleen admin support queue.

Each issue should support:

- immutable HOA, amenity, reporter, and optional related booking references;
- category such as damage, cleanliness, safety, access, equipment, reservation conflict, noise, or other;
- bounded subject/description, priority, status, created/updated/resolved timestamps;
- customer-visible threaded messages between reporter and HOA manager;
- internal manager notes that can never appear to the homeowner;
- assignment to an active HOA manager/team member;
- status history/audit events such as new, acknowledged, investigating, waiting_on_resident, resolved, and closed;
- photo attachments;
- resident withdrawal/reopen rules and manager resolution summary;
- notifications for creation, acknowledgement, reply, status change, and resolution.

The reporter can view only their own issue thread. Authorized HOA staff can view their HOA's issue queue. Bundleen admins may have audited recovery/moderation access. Other residents cannot see complaints or attachments. AI support tooling must not automatically ingest these private HOA issues unless a separately authorized, tenant-scoped tool is deliberately implemented.

### Amenity and issue photos

Reuse the existing Vercel Blob capability through a new shared, server-authorized media service rather than copying the avatar handler. Different media classes need different visibility:

- amenity gallery images are visible only to authorized residents/staff of that HOA;
- review images follow review visibility;
- complaint/issue attachments are private to the reporter, authorized HOA staff, and authorized Bundleen admins.

Do not store sensitive issue images at permanently public unguessable URLs. Use private object storage/authenticated delivery or short-lived signed access. Persist storage path, owner/uploader, HOA, media purpose, MIME type, size, dimensions, checksum, timestamps, and deletion/moderation state—not storage credentials.

Validate file magic bytes rather than trusting extension or declared MIME. Allow only explicitly supported image formats (for example JPEG, PNG, and WebP), enforce per-file/count/total limits, normalize/re-encode when practical, strip EXIF/GPS metadata, reject malformed/decompression-bomb content, rate-limit uploads, generate safe random paths, and clean up orphaned blobs after database failure. Deleting or archiving content must follow a documented retention policy and preserve audit evidence without retaining unnecessary private files forever.

### Amenity reviews and listing quality

Active HOA homeowners may view reviews for published amenities in their HOA. Support:

- integer 1–5 rating;
- bounded written review;
- optional approved photos;
- created/edited label and timestamps;
- verified-booking indicator when linked to a completed booking;
- average rating, review count, and rating distribution calculated server-side;
- newest/highest/lowest sorting and bounded pagination;
- one manager response per review, visibly labeled;
- report/moderation workflow and soft removal with reason/audit.

Choose and document the eligibility rule. Recommended: a resident may review after a completed booking when booking is required, and any active resident may review a non-bookable common area, with at most one active review per resident per amenity unless tied to distinct completed bookings. Prevent duplicate/spam reviews and make edits auditable.

HOA managers may respond but must not silently delete or edit unfavorable resident reviews. Bundleen admins handle moderation under an explicit policy. Reviews and photos remain private to that HOA unless a future product decision explicitly makes listings public.

### Amenity data model and lifecycle

Design normalized models (names may follow repository conventions) covering:

- amenity and amenity media/gallery;
- weekly availability rules and one-off/recurring blackouts;
- optional distinct bookable resources/capacity;
- booking and booking event/audit history;
- amenity issue ticket, messages/events, assignment, and attachments;
- amenity review, manager response, moderation state, and review media;
- delayed reminder/outbox state where the existing model is insufficient.

Use foreign keys and deletion rules that preserve historical bookings/issues/reviews when an amenity is archived. Add indexes for HOA catalog, availability windows, upcoming resident bookings, manager calendars, due reminders, open issues, and paginated reviews. Store no derived average that can drift unless it is transactionally maintained and tested.

Explicitly keep payments, public/nonresident rentals, guest accounts, door-lock integration, and external calendar sync out of scope unless separately approved.

---

## API, security, notifications, and audit

Create cohesive contracts separating homeowner neighborhood requests/participation, manager lifecycle/award, shared provider marketplace/bids, awarded scheduling/visits, admin address verification, HOA resident amenity catalog/bookings/issues/reviews, and HOA manager amenity operations.

For every mutation:

- derive identity/role from Clerk;
- verify active membership, assignment, or provider status server-side;
- validate bounded input with Zod;
- transact state plus audit/outbox work;
- rate-limit and make retry-prone actions idempotent;
- return structured safe errors;
- never trust client-supplied owner, community, manager, provider, status, coordinates, participant count, or totals.

Admin geocoding endpoints must use the admin guard and must not become an unauthenticated arbitrary-address proxy.

Add preference-aware, idempotent in-app/email events for request opening, participation, enrollment/bidding deadlines, bids, award/rejection, schedule changes, upcoming/en-route visits, completion, reviews, and address-verification failures. Delivery failure must remain retryable without corrupting marketplace state.

Audit manager/admin lifecycle transitions, awards, recovery actions, address decisions, and retries. Do not audit private access notes or raw geocoder responses.

---

## Required tests

Add behavioral tests, not only source-text assertions.

### Neighborhood marketplace

- Eligible non-HOA homeowner creates a request and is automatically joined.
- HOA resident cannot use this path.
- Same-neighborhood resident joins/declines idempotently; outsider cannot view/join.
- Only the active resident neighborhood manager opens/closes bidding and awards.
- Removing/replacing the manager removes old authority immediately.
- Provider feed includes eligible HOA and neighborhood work and excludes wrong-area/trade, expired, pending/suspended, or unauthorized work.
- Provider submits/revises/withdraws a neighborhood bid only while eligible/open.
- Competing commercial data and exact participant locations do not leak.
- Award is atomic/idempotent under double-click and concurrency.
- Award creates one agreement, correct occurrences, and one visit per locked participant.
- Missing participant address aborts with no partial records.
- Existing HOA award/unit behavior remains unchanged.
- Awarded provider alone can plan exact stops.
- Status, completion, earnings, notifications, and reviews work end to end.

### Address-only onboarding

- Admin form and unit CSV contain no latitude/longitude inputs.
- Non-admin users cannot call geocoding/profile writes.
- Exact result stores normalized address and valid coordinates atomically.
- Ambiguous result requires confirmation and stores nothing incorrect.
- Address edits replace stale coordinates.
- Timeout, invalid address, quota, rate-limit, and provider errors are safe/retryable.
- Keys/raw responses never reach HTML, client bundles, logs, or errors.
- Repeated normalized lookups use cache/deduplication.
- Batch unit geocoding is bounded/retryable.
- HOA cannot become operational with unresolved required locations.
- Provider matching uses the resolved internal coordinates.

### HOA amenities and bookings

- Only active residents of the exact HOA can list/view its published amenities.
- Draft/archived amenities are hidden from ordinary residents.
- HOA manager/admin creation, publication, editing, closure, and archival permissions are enforced server-side.
- Availability correctly combines timezone, hours, duration, buffers, capacity, blackouts, booking limits, and existing holds/bookings.
- Concurrent requests for the final capacity cannot overbook.
- Approval-required and instant-confirmation policies both work.
- Cancel/reschedule rules, idempotency, manager changes, archived membership, and DST boundaries behave deterministically.
- A confirmed booking produces in-app/email confirmation and exactly one valid reminder approximately 30 minutes before start.
- Cancelled/rescheduled bookings never send stale reminders.
- Reminder-worker authentication, concurrency, retries, and deduplication are tested with a controllable clock.
- Manager amenity broadcasts cannot target another HOA or the global audience.
- Active resident opens a photo-backed amenity issue; only reporter/scoped staff/admin can read the thread or attachment.
- Internal issue notes never leak to resident APIs, notifications, email, AI context, or search.
- Manager can acknowledge, assign, reply, resolve, and audit an issue.
- Amenity/review photos enforce content, size, count, ownership, privacy, EXIF stripping, cleanup, and authorization rules.
- Eligible resident creates/edits one valid review; aggregates and pagination remain correct.
- Manager can respond but cannot edit/delete the resident review; moderation is admin-audited.
- HOA onboarding can save draft amenities and hand them to the invited manager without publishing invalid data.

### Regression/security

- HOA manager, homeowner, neighborhood manager, provider, and admin permissions remain isolated.
- Cross-community IDs cannot widen access.
- Exact locations are redacted before award and restricted after award.
- Existing support/homeowner-request fixes pass.
- Migration applies to an existing seeded database and preserves HOA data.

Mock external geocoding in automated tests. Never load-test Geoapify or OpenStreetMap Foundation public services.

---

## Manual end-to-end scenario

1. Admin verifies a neighborhood and assigns one active resident manager.
2. Resident A creates pressure washing and is auto-joined.
3. Resident B joins; Resident C declines.
4. Manager locks participants and opens bidding.
5. An in-radius matching provider sees and bids; wrong-area/trade providers cannot.
6. A second provider bids; joined residents see transparent comparison but cannot award.
7. Manager closes bidding and awards one provider.
8. Exactly two private visit stops are created with snapshotted addresses.
9. Provider orders stops and publishes windows.
10. Each resident receives only their own schedule/private details.
11. Provider completes visits; manager completes the occurrence/agreement; residents review.
12. Provider earnings/bids/schedule, homeowner pages, manager controls, notifications, and admin CRM show one consistent persisted state.

Then test HOA onboarding:

1. Admin creates an HOA account.
2. Admin enters legal/business information and a postal address only.
3. Bundleen resolves it and shows the normalized verified address/status without coordinate fields.
4. Admin imports units using labels/addresses only.
5. Internal coordinates support provider matching and visit planning.

Then test HOA amenities:

1. During onboarding, admin creates draft badminton-court and pool amenities using templates.
2. HOA manager completes hours/rules/photos, enables booking for the court, leaves the pool non-bookable, and publishes both.
3. Resident browses the scrollable catalog, opens the court, sees live slots, and books one.
4. A concurrent resident cannot take the same exclusive slot; another available slot succeeds.
5. Booking confirmation appears in-app/email and the test scheduler emits exactly one reminder 30 minutes before start.
6. Manager places the court into maintenance; affected bookings and residents are notified and stale reminders are cancelled.
7. Resident reports damaged equipment with photos. It appears only in that HOA manager's issue queue, supports a private thread, and can be resolved with an audit trail.
8. After a completed booking, the resident posts a rating, text, and photo; the manager adds a labeled public-to-HOA response.
9. A homeowner from another HOA cannot read the amenity, booking, review, issue, or image URLs.

---

## Verification before handoff

Run and report:

- Prisma format/validate/generate and migration checks;
- lint/typecheck;
- focused marketplace, authorization, migration, geocoding, amenity booking/concurrency, delayed-reminder, media, issue-ticket, review, and privacy tests;
- complete automated test suite;
- production Next.js build;
- responsive browser checks for provider, homeowner/manager, and admin flows;
- OpenStreetMap integration audit:

```text
python3 /Users/lancedsilva/.agents/skills/integrate-openstreetmap/scripts/audit_osm_integration.py /Users/lancedsilva/Documents/neighbid-claude-codex-starter
```

Resolve audit errors and review warnings against current Geoapify/tile-provider terms.

Report schema design, migration/backfill, canonical routes, permission matrix, geocoding configuration/retention decision, test results, and remaining risks.

---

## Definition of done

- A non-HOA request no longer ends at `collecting_interest`.
- Eligible providers can discover, bid on, and be awarded neighborhood work.
- Award produces valid agreements, occurrences, and private visits without breaking HOA unit work.
- The assigned neighborhood manager controls the lifecycle from the homeowner dashboard.
- Scheduling, completion, earnings, notifications, and reviews work for both contexts.
- Clients call no nonexistent legacy bid/feed endpoints.
- HOA onboarding and unit import require addresses, never raw coordinates.
- Geoapify resolves coordinates server-side for matching/routing through a secure configurable boundary.
- Exact locations are protected throughout discovery, award, and scheduling.
- Official HOA residents can browse a polished private amenity catalog and book server-verified available times where required.
- Managers/admins can configure amenities during and after onboarding, manage calendars/closures, and send HOA-scoped amenity communications.
- Confirmed bookings receive durable real-time status notifications and a correctly scheduled 30-minute reminder.
- HOA amenity complaints operate as private manager-owned tickets with secure photo attachments and an auditable thread.
- HOA-scoped ratings, photos, review aggregates, moderation, and manager responses work without exposing one HOA to another.
- Constraints, authorization, audit, idempotency, tests, migrations, and production build pass.

Do not commit, push, deploy, send production notifications, or modify production data until the implementation and migration plan have been reviewed.
