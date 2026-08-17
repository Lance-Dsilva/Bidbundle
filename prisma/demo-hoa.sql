-- Bundleen HOA-first marketplace demo fixture.
--
-- Deterministic and intentionally synthetic:
-- - `.example` email addresses cannot receive mail;
-- - `demo_clerk_cedarbend_*` identifiers are not Clerk accounts and cannot sign in;
-- - coordinates are broad North Austin points, not private residences.
--
-- Idempotent for its fixed `demo_hoa_*` records. Run explicitly with:
--   npm run seed:demo-hoa
--
-- Insert order matters: database triggers require the manager assignment
-- before requests, open requests before participations/bids, and completed
-- visits before reviews. Awarded/decided statuses are applied by UPDATEs
-- after the guarded INSERTs, exactly as the application does.

BEGIN;

-- ── Community and profile ─────────────────────────────────────────────────
INSERT INTO "Community" ("id", "name", "type", "status", "createdAt", "updatedAt")
VALUES ('demo_hoa_community', 'Cedar Bend Demo HOA', 'hoa', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "HoaProfile" (
  "id", "communityId", "legalName", "displayName",
  "addressLine1", "locality", "region", "postalCode", "country",
  "latitude", "longitude", "timezone", "totalHomes", "referenceCode",
  "onboardingStatus", "createdAt", "updatedAt"
)
VALUES (
  'demo_hoa_profile', 'demo_hoa_community', 'Cedar Bend Homeowners Association, Inc.', 'Cedar Bend HOA',
  '11800 Cedar Bend Blvd', 'Austin', 'TX', '78758', 'US',
  30.4021, -97.7266, 'America/Chicago', 10, 'CB-2026',
  'live', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
)
ON CONFLICT ("id") DO NOTHING;

-- ── Unit inventory: ten homes with seeded coordinates ─────────────────────
INSERT INTO "CommunityUnit" (
  "id", "communityId", "label", "addressLine1", "locality", "region", "postalCode",
  "latitude", "longitude", "occupancyStatus", "createdAt", "updatedAt"
)
VALUES
  ('demo_hoa_unit_01', 'demo_hoa_community', 'Home 1',  '11801 Cedar Bend Blvd', 'Austin', 'TX', '78758', 30.40180, -97.72710, 'occupied',       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('demo_hoa_unit_02', 'demo_hoa_community', 'Home 2',  '11803 Cedar Bend Blvd', 'Austin', 'TX', '78758', 30.40195, -97.72695, 'occupied',       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('demo_hoa_unit_03', 'demo_hoa_community', 'Home 3',  '11805 Cedar Bend Blvd', 'Austin', 'TX', '78758', 30.40210, -97.72680, 'occupied',       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('demo_hoa_unit_04', 'demo_hoa_community', 'Home 4',  '11807 Cedar Bend Blvd', 'Austin', 'TX', '78758', 30.40225, -97.72665, 'occupied',       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('demo_hoa_unit_05', 'demo_hoa_community', 'Home 5',  '11809 Cedar Bend Blvd', 'Austin', 'TX', '78758', 30.40240, -97.72650, 'occupied',       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('demo_hoa_unit_06', 'demo_hoa_community', 'Home 6',  '11811 Cedar Bend Blvd', 'Austin', 'TX', '78758', 30.40255, -97.72635, 'occupied',       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('demo_hoa_unit_07', 'demo_hoa_community', 'Home 7',  '11813 Cedar Bend Blvd', 'Austin', 'TX', '78758', 30.40270, -97.72620, 'invite_pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('demo_hoa_unit_08', 'demo_hoa_community', 'Home 8',  '11815 Cedar Bend Blvd', 'Austin', 'TX', '78758', 30.40285, -97.72605, 'vacant',         CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('demo_hoa_unit_09', 'demo_hoa_community', 'Home 9',  '11817 Cedar Bend Blvd', 'Austin', 'TX', '78758', 30.40300, -97.72590, 'vacant',         CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('demo_hoa_unit_10', 'demo_hoa_community', 'Home 10', '11819 Cedar Bend Blvd', 'Austin', 'TX', '78758', 30.40315, -97.72575, 'vacant',         CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

-- ── Accounts ──────────────────────────────────────────────────────────────
INSERT INTO "User" ("id", "clerkUserId", "email", "fullName", "role", "isVerified", "createdAt", "updatedAt")
VALUES
  ('demo_hoa_manager',    'demo_clerk_cedarbend_manager',    'manager@cedarbend.example',    'Morgan Wells (Demo Manager)', 'homeowner', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('demo_hoa_resident_1', 'demo_clerk_cedarbend_resident_1', 'resident1@cedarbend.example',  'Riley Adams',                 'homeowner', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('demo_hoa_resident_2', 'demo_clerk_cedarbend_resident_2', 'resident2@cedarbend.example',  'Jordan Blake',                'homeowner', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('demo_hoa_resident_3', 'demo_clerk_cedarbend_resident_3', 'resident3@cedarbend.example',  'Casey Nguyen',                'homeowner', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('demo_hoa_resident_4', 'demo_clerk_cedarbend_resident_4', 'resident4@cedarbend.example',  'Devon Clarke',                'homeowner', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('demo_hoa_resident_5', 'demo_clerk_cedarbend_resident_5', 'resident5@cedarbend.example',  'Harper Diaz',                 'homeowner', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('demo_hoa_resident_6', 'demo_clerk_cedarbend_resident_6', 'resident6@cedarbend.example',  'Quinn Foster',                'homeowner', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('demo_hoa_provider_1', 'demo_clerk_cedarbend_provider_1', 'greencrew@providers.example',  'Green Crew Lawn Care',        'provider',  true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('demo_hoa_provider_2', 'demo_clerk_cedarbend_provider_2', 'bloomscape@providers.example', 'Bloomscape Gardens',          'provider',  true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('demo_hoa_provider_3', 'demo_clerk_cedarbend_provider_3', 'faraway@providers.example',    'Far Away Landscaping',        'provider',  true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('demo_hoa_provider_4', 'demo_clerk_cedarbend_provider_4', 'suspended@providers.example',  'Suspended Yard Services',     'provider',  true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "HomeownerProfile" ("id", "userId", "createdAt", "updatedAt")
SELECT 'demo_hoa_hp_' || "id", "id", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "User"
WHERE "id" IN (
  'demo_hoa_manager', 'demo_hoa_resident_1', 'demo_hoa_resident_2', 'demo_hoa_resident_3',
  'demo_hoa_resident_4', 'demo_hoa_resident_5', 'demo_hoa_resident_6'
)
ON CONFLICT ("userId") DO NOTHING;

-- Two verified in-region providers, one out-of-region, one suspended.
INSERT INTO "ProviderProfile" (
  "id", "userId", "companyName", "trades", "accountStatus",
  "licenseVerifiedAt", "insuranceVerifiedAt", "createdAt", "updatedAt"
)
VALUES
  ('demo_hoa_pp_1', 'demo_hoa_provider_1', 'Green Crew Lawn Care LLC',  ARRAY['gardening', 'landscaping'], 'active',    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('demo_hoa_pp_2', 'demo_hoa_provider_2', 'Bloomscape Gardens LLC',    ARRAY['gardening', 'pool cleaning'], 'active',  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('demo_hoa_pp_3', 'demo_hoa_provider_3', 'Far Away Landscaping LLC',  ARRAY['gardening'],                'active',    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('demo_hoa_pp_4', 'demo_hoa_provider_4', 'Suspended Yard Services',   ARRAY['gardening'],                'suspended', NULL,              NULL,              CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "ProviderServiceArea" (
  "id", "providerUserId", "label", "centerLatitude", "centerLongitude", "radiusMiles",
  "postalCodes", "status", "createdAt", "updatedAt"
)
VALUES
  ('demo_hoa_area_1', 'demo_hoa_provider_1', 'North Austin',     30.4500, -97.7000, 15, ARRAY[]::TEXT[],      'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('demo_hoa_area_2', 'demo_hoa_provider_2', 'Austin metro',     NULL,    NULL,     NULL, ARRAY['78758','78727'], 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('demo_hoa_area_3', 'demo_hoa_provider_3', 'San Antonio only', 29.4241, -98.4936, 10, ARRAY[]::TEXT[],      'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('demo_hoa_area_4', 'demo_hoa_provider_4', 'North Austin',     30.4500, -97.7000, 15, ARRAY[]::TEXT[],      'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

-- ── Manager assignment (before any request insert; trigger-enforced) ──────
INSERT INTO "CommunityStaffAssignment" ("id", "communityId", "userId", "role", "status", "assignedAt")
VALUES ('demo_hoa_assignment_manager', 'demo_hoa_community', 'demo_hoa_manager', 'hoa_manager', 'active', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

-- ── Memberships: six residents in six specific homes ──────────────────────
INSERT INTO "CommunityMembership" (
  "id", "communityId", "userId", "unitId", "status", "joinedAt", "isPrimary", "createdAt", "updatedAt"
)
VALUES
  ('demo_hoa_member_1', 'demo_hoa_community', 'demo_hoa_resident_1', 'demo_hoa_unit_01', 'active', CURRENT_TIMESTAMP - INTERVAL '40 days', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('demo_hoa_member_2', 'demo_hoa_community', 'demo_hoa_resident_2', 'demo_hoa_unit_02', 'active', CURRENT_TIMESTAMP - INTERVAL '39 days', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('demo_hoa_member_3', 'demo_hoa_community', 'demo_hoa_resident_3', 'demo_hoa_unit_03', 'active', CURRENT_TIMESTAMP - INTERVAL '38 days', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('demo_hoa_member_4', 'demo_hoa_community', 'demo_hoa_resident_4', 'demo_hoa_unit_04', 'active', CURRENT_TIMESTAMP - INTERVAL '37 days', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('demo_hoa_member_5', 'demo_hoa_community', 'demo_hoa_resident_5', 'demo_hoa_unit_05', 'active', CURRENT_TIMESTAMP - INTERVAL '36 days', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('demo_hoa_member_6', 'demo_hoa_community', 'demo_hoa_resident_6', 'demo_hoa_unit_06', 'active', CURRENT_TIMESTAMP - INTERVAL '35 days', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

-- One pending unit-bound invitation for Home 7.
INSERT INTO "CommunityInvitation" (
  "id", "communityId", "email", "role", "status", "unitId",
  "invitedByUserId", "invitedAt", "expiresAt", "createdAt", "updatedAt"
)
VALUES (
  'demo_hoa_invite_pending', 'demo_hoa_community', 'resident7@cedarbend.example', 'homeowner', 'pending',
  'demo_hoa_unit_07', 'demo_hoa_manager', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '7 days',
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
)
ON CONFLICT ("id") DO NOTHING;

-- ── Compulsory biweekly gardening: awarded with ten ordered visits ────────
-- Insert while open_for_bids so the participation/bid triggers accept rows,
-- then move to awarded below — the same order the application uses.
INSERT INTO "HoaServiceRequest" (
  "id", "communityId", "createdByUserId", "title", "category", "description",
  "kind", "recurrenceLabel", "recurrenceIntervalDays", "totalOccurrences",
  "status", "opensAt", "biddingClosesAt", "startDate", "participantsLockedAt",
  "createdAt", "updatedAt"
)
VALUES (
  'demo_hoa_request_gardening', 'demo_hoa_community', 'demo_hoa_manager',
  'Biweekly community gardening', 'gardening',
  'Mow, edge, and tidy the front yard of every home on the roster every two weeks.',
  'compulsory_recurring', 'Every two weeks', 14, 2,
  'open_for_bids', CURRENT_TIMESTAMP - INTERVAL '21 days',
  CURRENT_TIMESTAMP - INTERVAL '16 days', CURRENT_TIMESTAMP - INTERVAL '14 days',
  CURRENT_TIMESTAMP - INTERVAL '21 days',
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
)
ON CONFLICT ("id") DO NOTHING;

-- Compulsory audience snapshot: every non-retired home, resident or not.
INSERT INTO "HoaRequestParticipation" ("id", "requestId", "userId", "unitId", "response")
VALUES
  ('demo_hoa_part_g01', 'demo_hoa_request_gardening', 'demo_hoa_resident_1', 'demo_hoa_unit_01', 'joined'),
  ('demo_hoa_part_g02', 'demo_hoa_request_gardening', 'demo_hoa_resident_2', 'demo_hoa_unit_02', 'joined'),
  ('demo_hoa_part_g03', 'demo_hoa_request_gardening', 'demo_hoa_resident_3', 'demo_hoa_unit_03', 'joined'),
  ('demo_hoa_part_g04', 'demo_hoa_request_gardening', 'demo_hoa_resident_4', 'demo_hoa_unit_04', 'joined'),
  ('demo_hoa_part_g05', 'demo_hoa_request_gardening', 'demo_hoa_resident_5', 'demo_hoa_unit_05', 'joined'),
  ('demo_hoa_part_g06', 'demo_hoa_request_gardening', 'demo_hoa_resident_6', 'demo_hoa_unit_06', 'joined'),
  ('demo_hoa_part_g07', 'demo_hoa_request_gardening', NULL,                  'demo_hoa_unit_07', 'joined'),
  ('demo_hoa_part_g08', 'demo_hoa_request_gardening', NULL,                  'demo_hoa_unit_08', 'joined'),
  ('demo_hoa_part_g09', 'demo_hoa_request_gardening', NULL,                  'demo_hoa_unit_09', 'joined'),
  ('demo_hoa_part_g10', 'demo_hoa_request_gardening', NULL,                  'demo_hoa_unit_10', 'joined')
ON CONFLICT ("id") DO NOTHING;

-- Competing bids from both eligible providers.
INSERT INTO "ServiceBid" (
  "id", "requestId", "providerUserId", "status", "amountCents", "currency", "pricingBasis",
  "perHomeCents", "proposedStartDate", "scope", "cadenceLabel", "version",
  "submittedAt", "createdAt", "updatedAt"
)
VALUES
  (
    'demo_hoa_bid_greencrew', 'demo_hoa_request_gardening', 'demo_hoa_provider_1', 'submitted',
    42000, 'usd', 'per_visit', 4200, CURRENT_TIMESTAMP - INTERVAL '14 days',
    'Mow, edge, blow, and haul clippings for all ten homes each cycle.', 'Every two weeks', 1,
    CURRENT_TIMESTAMP - INTERVAL '18 days', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'demo_hoa_bid_bloomscape', 'demo_hoa_request_gardening', 'demo_hoa_provider_2', 'submitted',
    47500, 'usd', 'per_visit', 4750, CURRENT_TIMESTAMP - INTERVAL '13 days',
    'Full-service gardening with seasonal bed maintenance included.', 'Every two weeks', 2,
    CURRENT_TIMESTAMP - INTERVAL '17 days', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  )
ON CONFLICT ("id") DO NOTHING;

-- Decide the bids and award the request, exactly one accepted.
UPDATE "ServiceBid" SET "status" = 'accepted', "decidedAt" = CURRENT_TIMESTAMP - INTERVAL '15 days', "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'demo_hoa_bid_greencrew' AND "status" = 'submitted';
UPDATE "ServiceBid" SET "status" = 'rejected', "decidedAt" = CURRENT_TIMESTAMP - INTERVAL '15 days', "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'demo_hoa_bid_bloomscape' AND "status" = 'submitted';
UPDATE "HoaServiceRequest"
SET "status" = 'in_progress', "awardedAt" = CURRENT_TIMESTAMP - INTERVAL '15 days', "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'demo_hoa_request_gardening' AND "status" = 'open_for_bids';

INSERT INTO "ServiceAgreement" (
  "id", "requestId", "bidId", "communityId", "providerUserId", "awardedByUserId",
  "amountCents", "currency", "pricingBasis", "perHomeCents", "scope", "cadenceLabel",
  "lockedHomeCount", "startDate", "endDate", "status", "createdAt", "updatedAt"
)
VALUES (
  'demo_hoa_agreement_gardening', 'demo_hoa_request_gardening', 'demo_hoa_bid_greencrew',
  'demo_hoa_community', 'demo_hoa_provider_1', 'demo_hoa_manager',
  42000, 'usd', 'per_visit', 4200,
  'Mow, edge, blow, and haul clippings for all ten homes each cycle.', 'Every two weeks',
  10, CURRENT_TIMESTAMP - INTERVAL '14 days', CURRENT_TIMESTAMP, 'active',
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
)
ON CONFLICT ("id") DO NOTHING;

-- Cycle 1 completed two weeks ago; cycle 2 published and upcoming.
INSERT INTO "ServiceOccurrence" (
  "id", "agreementId", "sequence", "serviceDate", "status", "closedAt",
  "schedulePublishedAt", "createdAt", "updatedAt"
)
VALUES
  ('demo_hoa_occurrence_1', 'demo_hoa_agreement_gardening', 1, CURRENT_TIMESTAMP - INTERVAL '14 days', 'completed', CURRENT_TIMESTAMP - INTERVAL '13 days', CURRENT_TIMESTAMP - INTERVAL '15 days', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('demo_hoa_occurrence_2', 'demo_hoa_agreement_gardening', 2, CURRENT_TIMESTAMP + INTERVAL '1 day',  'planned',  NULL,                                   CURRENT_TIMESTAMP - INTERVAL '2 days',  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

-- Cycle 1: ten ordered stops, all resolved (nine completed, one skipped).
INSERT INTO "ServiceVisit" (
  "id", "occurrenceId", "unitId", "stopRank", "scheduledDate", "windowStart", "windowEnd",
  "estimatedMinutes", "status", "completionNote", "completedAt", "statusChangedAt", "createdAt", "updatedAt"
)
SELECT
  'demo_hoa_visit_1_' || LPAD(rank::TEXT, 2, '0'),
  'demo_hoa_occurrence_1',
  'demo_hoa_unit_' || LPAD(rank::TEXT, 2, '0'),
  rank,
  CURRENT_TIMESTAMP - INTERVAL '14 days',
  LPAD((7 + rank)::TEXT, 2, '0') || ':00',
  LPAD((8 + rank)::TEXT, 2, '0') || ':00',
  45,
  (CASE WHEN rank = 8 THEN 'skipped' ELSE 'completed' END)::"ServiceVisitStatus",
  CASE WHEN rank = 8 THEN 'Gate locked; resident away. Rescheduled to next cycle.' ELSE 'Completed as scheduled.' END,
  CASE WHEN rank = 8 THEN NULL ELSE CURRENT_TIMESTAMP - INTERVAL '14 days' END,
  CURRENT_TIMESTAMP - INTERVAL '14 days',
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM generate_series(1, 10) AS rank
ON CONFLICT ("id") DO NOTHING;

-- Cycle 2: ten ordered stops, published windows, none started yet.
INSERT INTO "ServiceVisit" (
  "id", "occurrenceId", "unitId", "stopRank", "scheduledDate", "windowStart", "windowEnd",
  "estimatedMinutes", "status", "createdAt", "updatedAt"
)
SELECT
  'demo_hoa_visit_2_' || LPAD(rank::TEXT, 2, '0'),
  'demo_hoa_occurrence_2',
  'demo_hoa_unit_' || LPAD(rank::TEXT, 2, '0'),
  rank,
  CURRENT_TIMESTAMP + INTERVAL '1 day',
  LPAD((7 + rank)::TEXT, 2, '0') || ':00',
  LPAD((8 + rank)::TEXT, 2, '0') || ':00',
  45,
  'scheduled'::"ServiceVisitStatus",
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM generate_series(1, 10) AS rank
ON CONFLICT ("id") DO NOTHING;

-- Eligible homeowner reviews of their own completed cycle-1 visits.
INSERT INTO "Review" (
  "id", "reviewerUserId", "providerUserId", "visitId", "rating", "comment", "status", "createdAt", "updatedAt"
)
VALUES
  ('demo_hoa_review_1', 'demo_hoa_resident_1', 'demo_hoa_provider_1', 'demo_hoa_visit_1_01', 5, 'Yard looks great and the crew was right on time.', 'published', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('demo_hoa_review_2', 'demo_hoa_resident_3', 'demo_hoa_provider_1', 'demo_hoa_visit_1_03', 4, 'Solid work; edging near the mailbox could be neater.', 'published', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

-- ── Optional pool-cleaning: survey plus enrollment with mixed responses ───
INSERT INTO "HoaSurvey" (
  "id", "communityId", "createdByUserId", "monthKey", "question", "options",
  "status", "closesAt", "createdAt", "updatedAt"
)
VALUES (
  'demo_hoa_survey_pool', 'demo_hoa_community', 'demo_hoa_manager', TO_CHAR(CURRENT_DATE, 'YYYY-MM'),
  'Should we bundle an optional backyard pool cleaning service?',
  ARRAY['Yes, biweekly', 'Yes, monthly', 'Not interested'],
  'open', CURRENT_TIMESTAMP + INTERVAL '10 days', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "HoaSurveyVote" ("id", "surveyId", "userId", "optionIndex", "createdAt", "updatedAt")
VALUES
  ('demo_hoa_vote_1', 'demo_hoa_survey_pool', 'demo_hoa_resident_1', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('demo_hoa_vote_2', 'demo_hoa_survey_pool', 'demo_hoa_resident_2', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('demo_hoa_vote_3', 'demo_hoa_survey_pool', 'demo_hoa_resident_4', 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "HoaServiceRequest" (
  "id", "communityId", "createdByUserId", "title", "category", "description",
  "kind", "totalOccurrences", "status", "opensAt", "enrollmentClosesAt", "minHomes",
  "createdAt", "updatedAt"
)
VALUES (
  'demo_hoa_request_pool', 'demo_hoa_community', 'demo_hoa_manager',
  'Optional pool cleaning bundle', 'pool cleaning',
  'One shared provider cleans participating backyard pools on the same day.',
  'optional_group', 1, 'collecting_interest', CURRENT_TIMESTAMP - INTERVAL '3 days',
  CURRENT_TIMESTAMP + INTERVAL '11 days', 3,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "HoaRequestParticipation" ("id", "requestId", "userId", "unitId", "response")
VALUES
  ('demo_hoa_part_p1', 'demo_hoa_request_pool', 'demo_hoa_resident_1', 'demo_hoa_unit_01', 'joined'),
  ('demo_hoa_part_p2', 'demo_hoa_request_pool', 'demo_hoa_resident_2', 'demo_hoa_unit_02', 'joined'),
  ('demo_hoa_part_p3', 'demo_hoa_request_pool', 'demo_hoa_resident_4', 'demo_hoa_unit_04', 'declined'),
  ('demo_hoa_part_p4', 'demo_hoa_request_pool', 'demo_hoa_resident_5', 'demo_hoa_unit_05', 'joined')
ON CONFLICT ("id") DO NOTHING;

COMMIT;
