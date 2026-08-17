-- HOA-first marketplace:
--   * HOA legal/onboarding profile and real unit inventory;
--   * unit-bound homeowner membership and invitations;
--   * structured provider coverage areas;
--   * request lifecycle state machine, bids, single-award agreements;
--   * occurrences, unit visits, reviews, notifications, and a durable outbox.

-- ── Audit vocabulary ──────────────────────────────────────────────────────
ALTER TYPE "AdminAuditAction" ADD VALUE 'hoa_profile_updated';
ALTER TYPE "AdminAuditAction" ADD VALUE 'hoa_unit_created';
ALTER TYPE "AdminAuditAction" ADD VALUE 'hoa_unit_updated';
ALTER TYPE "AdminAuditAction" ADD VALUE 'hoa_units_imported';
ALTER TYPE "AdminAuditAction" ADD VALUE 'hoa_participants_locked';
ALTER TYPE "AdminAuditAction" ADD VALUE 'hoa_bid_awarded';
ALTER TYPE "AdminAuditAction" ADD VALUE 'hoa_schedule_published';
ALTER TYPE "AdminAuditAction" ADD VALUE 'hoa_visit_corrected';
ALTER TYPE "AdminAuditAction" ADD VALUE 'review_moderated';
ALTER TYPE "AdminAuditAction" ADD VALUE 'provider_service_area_changed';

ALTER TYPE "AdminAuditTargetType" ADD VALUE 'hoa_profile';
ALTER TYPE "AdminAuditTargetType" ADD VALUE 'hoa_unit';
ALTER TYPE "AdminAuditTargetType" ADD VALUE 'service_bid';
ALTER TYPE "AdminAuditTargetType" ADD VALUE 'service_agreement';
ALTER TYPE "AdminAuditTargetType" ADD VALUE 'service_visit';
ALTER TYPE "AdminAuditTargetType" ADD VALUE 'review';
ALTER TYPE "AdminAuditTargetType" ADD VALUE 'provider_service_area';

-- ── New enums ─────────────────────────────────────────────────────────────
CREATE TYPE "HoaOnboardingStatus" AS ENUM
  ('draft', 'manager_invited', 'manager_active', 'residents_inviting', 'live', 'archived');
CREATE TYPE "UnitOccupancyStatus" AS ENUM
  ('vacant', 'invite_pending', 'occupied', 'inactive');
CREATE TYPE "ParticipationResponse" AS ENUM ('joined', 'declined');
CREATE TYPE "ServiceBidStatus" AS ENUM
  ('draft', 'submitted', 'withdrawn', 'accepted', 'rejected', 'expired');
CREATE TYPE "BidPricingBasis" AS ENUM ('total', 'per_home', 'per_visit');
CREATE TYPE "ServiceAgreementStatus" AS ENUM ('active', 'completed', 'cancelled');
CREATE TYPE "ServiceOccurrenceStatus" AS ENUM
  ('planned', 'in_progress', 'completed', 'cancelled');
CREATE TYPE "ServiceVisitStatus" AS ENUM
  ('unscheduled', 'scheduled', 'en_route', 'in_progress', 'completed', 'skipped', 'blocked', 'cancelled');
CREATE TYPE "ReviewStatus" AS ENUM ('published', 'removed');
CREATE TYPE "ProviderServiceAreaStatus" AS ENUM ('active', 'removed');
CREATE TYPE "NotificationKind" AS ENUM
  ('invitation', 'survey', 'request', 'bid', 'award', 'schedule', 'visit', 'review');
CREATE TYPE "OutboxStatus" AS ENUM ('pending', 'delivered', 'failed');

-- ── Request lifecycle: replace the four-state enum with the state machine ─
CREATE TYPE "HoaRequestStatus_new" AS ENUM
  ('draft', 'collecting_interest', 'open_for_bids', 'bidding_closed', 'awarded',
   'scheduled', 'in_progress', 'completed', 'cancelled', 'failed');

ALTER TABLE "HoaServiceRequest" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "HoaServiceRequest"
  ALTER COLUMN "status" TYPE "HoaRequestStatus_new"
  USING (
    CASE "status"::text
      WHEN 'open' THEN
        CASE WHEN "kind" = 'optional_group' THEN 'collecting_interest' ELSE 'open_for_bids' END
      WHEN 'closed' THEN 'bidding_closed'
      ELSE "status"::text
    END
  )::"HoaRequestStatus_new";
DROP TYPE "HoaRequestStatus";
ALTER TYPE "HoaRequestStatus_new" RENAME TO "HoaRequestStatus";
ALTER TABLE "HoaServiceRequest" ALTER COLUMN "status" SET DEFAULT 'draft';

-- New lifecycle columns. `closesAt` splits into enrollment/bidding deadlines.
ALTER TABLE "HoaServiceRequest"
  ADD COLUMN "enrollmentClosesAt" TIMESTAMP(3),
  ADD COLUMN "biddingClosesAt" TIMESTAMP(3),
  ADD COLUMN "startDate" TIMESTAMP(3),
  ADD COLUMN "recurrenceIntervalDays" INTEGER,
  ADD COLUMN "totalOccurrences" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "minHomes" INTEGER,
  ADD COLUMN "maxHomes" INTEGER,
  ADD COLUMN "participantsLockedAt" TIMESTAMP(3),
  ADD COLUMN "awardedAt" TIMESTAMP(3);

UPDATE "HoaServiceRequest"
SET "biddingClosesAt" = "closesAt"
WHERE "kind" = 'compulsory_recurring' AND "closesAt" IS NOT NULL;
UPDATE "HoaServiceRequest"
SET "enrollmentClosesAt" = "closesAt"
WHERE "kind" = 'optional_group' AND "closesAt" IS NOT NULL;

ALTER TABLE "HoaServiceRequest" DROP CONSTRAINT IF EXISTS "HoaServiceRequest_dates";
ALTER TABLE "HoaServiceRequest" DROP COLUMN "closesAt";

ALTER TABLE "HoaServiceRequest"
  ADD CONSTRAINT "HoaServiceRequest_occurrence_bounds" CHECK (
    "totalOccurrences" BETWEEN 1 AND 104
    AND ("recurrenceIntervalDays" IS NULL OR "recurrenceIntervalDays" BETWEEN 1 AND 365)
  ),
  ADD CONSTRAINT "HoaServiceRequest_home_bounds" CHECK (
    ("minHomes" IS NULL OR "minHomes" >= 0)
    AND ("maxHomes" IS NULL OR "maxHomes" >= 1)
    AND ("minHomes" IS NULL OR "maxHomes" IS NULL OR "maxHomes" >= "minHomes")
  );

CREATE INDEX "HoaServiceRequest_status_category_biddingClosesAt_idx"
  ON "HoaServiceRequest"("status", "category", "biddingClosesAt");

-- ── HOA profile ───────────────────────────────────────────────────────────
CREATE TABLE "HoaProfile" (
  "id" TEXT NOT NULL,
  "communityId" TEXT NOT NULL,
  "legalName" TEXT NOT NULL,
  "displayName" TEXT,
  "addressLine1" TEXT NOT NULL,
  "addressLine2" TEXT,
  "locality" TEXT NOT NULL,
  "region" TEXT NOT NULL,
  "postalCode" TEXT NOT NULL,
  "country" TEXT NOT NULL DEFAULT 'US',
  "latitude" DOUBLE PRECISION,
  "longitude" DOUBLE PRECISION,
  "timezone" TEXT NOT NULL DEFAULT 'America/Chicago',
  "totalHomes" INTEGER NOT NULL,
  "referenceCode" TEXT,
  "serviceNotes" TEXT,
  "onboardingStatus" "HoaOnboardingStatus" NOT NULL DEFAULT 'draft',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HoaProfile_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "HoaProfile_total_homes" CHECK ("totalHomes" BETWEEN 1 AND 10000),
  CONSTRAINT "HoaProfile_coordinates" CHECK (
    (("latitude" IS NULL) = ("longitude" IS NULL))
    AND ("latitude" IS NULL OR ("latitude" BETWEEN -90 AND 90 AND "longitude" BETWEEN -180 AND 180))
  )
);
CREATE UNIQUE INDEX "HoaProfile_communityId_key" ON "HoaProfile"("communityId");
CREATE INDEX "HoaProfile_onboardingStatus_idx" ON "HoaProfile"("onboardingStatus");
ALTER TABLE "HoaProfile"
  ADD CONSTRAINT "HoaProfile_communityId_fkey"
  FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Unit inventory ────────────────────────────────────────────────────────
CREATE TABLE "CommunityUnit" (
  "id" TEXT NOT NULL,
  "communityId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "addressLine1" TEXT,
  "locality" TEXT,
  "region" TEXT,
  "postalCode" TEXT,
  "latitude" DOUBLE PRECISION,
  "longitude" DOUBLE PRECISION,
  "occupancyStatus" "UnitOccupancyStatus" NOT NULL DEFAULT 'vacant',
  "accessNotes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CommunityUnit_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommunityUnit_label" CHECK (LENGTH(BTRIM("label")) BETWEEN 1 AND 120),
  CONSTRAINT "CommunityUnit_coordinates" CHECK (
    (("latitude" IS NULL) = ("longitude" IS NULL))
    AND ("latitude" IS NULL OR ("latitude" BETWEEN -90 AND 90 AND "longitude" BETWEEN -180 AND 180))
  )
);
CREATE UNIQUE INDEX "CommunityUnit_communityId_label_key" ON "CommunityUnit"("communityId", "label");
CREATE INDEX "CommunityUnit_communityId_occupancyStatus_idx"
  ON "CommunityUnit"("communityId", "occupancyStatus");
ALTER TABLE "CommunityUnit"
  ADD CONSTRAINT "CommunityUnit_communityId_fkey"
  FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Units exist only inside HOA communities; the geolocation matcher must never
-- gain a unit inventory to write into.
CREATE OR REPLACE FUNCTION "bundleen_validate_unit_community"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "Community" WHERE "id" = NEW."communityId" AND "type" = 'hoa'
  ) THEN
    RAISE EXCEPTION 'units belong to HOA communities only'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'CommunityUnit_hoa_required';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "CommunityUnit_validate_community"
  BEFORE INSERT OR UPDATE OF "communityId"
  ON "CommunityUnit"
  FOR EACH ROW EXECUTE FUNCTION "bundleen_validate_unit_community"();

-- ── Unit-bound membership ─────────────────────────────────────────────────
ALTER TABLE "CommunityMembership" ADD COLUMN "unitId" TEXT;
ALTER TABLE "CommunityMembership"
  ADD CONSTRAINT "CommunityMembership_unitId_fkey"
  FOREIGN KEY ("unitId") REFERENCES "CommunityUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "CommunityMembership_unitId_status_idx"
  ON "CommunityMembership"("unitId", "status");

-- One active primary homeowner per unit (MVP; the schema still permits future
-- multi-resident support by relaxing this index, not by restructuring).
CREATE UNIQUE INDEX "CommunityMembership_one_active_per_unit"
  ON "CommunityMembership"("unitId")
  WHERE "status" = 'active' AND "unitId" IS NOT NULL;

-- A membership's unit must belong to the same community, and only HOA
-- memberships carry units.
CREATE OR REPLACE FUNCTION "bundleen_validate_membership_unit"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  community_type "CommunityType";
BEGIN
  SELECT "type" INTO community_type FROM "Community" WHERE "id" = NEW."communityId";

  IF NEW."unitId" IS NOT NULL THEN
    IF community_type IS DISTINCT FROM 'hoa' THEN
      RAISE EXCEPTION 'only HOA memberships reference a unit'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'CommunityMembership_unit_hoa_only';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM "CommunityUnit"
      WHERE "id" = NEW."unitId" AND "communityId" = NEW."communityId"
    ) THEN
      RAISE EXCEPTION 'membership unit must belong to the same HOA'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'CommunityMembership_unit_same_hoa';
    END IF;
  ELSIF community_type = 'hoa' AND NEW."status" = 'active' THEN
    RAISE EXCEPTION 'an active HOA membership requires a unit'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'CommunityMembership_unit_required';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "CommunityMembership_validate_unit"
  BEFORE INSERT OR UPDATE OF "communityId", "unitId", "status"
  ON "CommunityMembership"
  FOR EACH ROW EXECUTE FUNCTION "bundleen_validate_membership_unit"();

-- Existing active HOA memberships predate the unit inventory. Represent them
-- honestly with a backfilled unit per member rather than deleting history.
INSERT INTO "CommunityUnit"
  ("id", "communityId", "label", "occupancyStatus", "createdAt", "updatedAt")
SELECT
  'unit_' || membership."id",
  membership."communityId",
  'Home ' || ROW_NUMBER() OVER (PARTITION BY membership."communityId" ORDER BY membership."createdAt"),
  'occupied',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "CommunityMembership" membership
JOIN "Community" community ON community."id" = membership."communityId"
WHERE community."type" = 'hoa' AND membership."status" = 'active';

UPDATE "CommunityMembership" membership
SET "unitId" = 'unit_' || membership."id", "updatedAt" = CURRENT_TIMESTAMP
FROM "Community" community
WHERE community."id" = membership."communityId"
  AND community."type" = 'hoa'
  AND membership."status" = 'active'
  AND membership."unitId" IS NULL;

-- ── Unit-bound homeowner invitations ──────────────────────────────────────
ALTER TABLE "CommunityInvitation" ADD COLUMN "unitId" TEXT;
ALTER TABLE "CommunityInvitation"
  ADD CONSTRAINT "CommunityInvitation_unitId_fkey"
  FOREIGN KEY ("unitId") REFERENCES "CommunityUnit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One live invitation per home.
CREATE UNIQUE INDEX "CommunityInvitation_one_pending_per_unit"
  ON "CommunityInvitation"("unitId")
  WHERE "status" = 'pending' AND "unitId" IS NOT NULL;

-- Homeowner invitations are for a specific home; manager invitations never
-- reference one.
CREATE OR REPLACE FUNCTION "bundleen_validate_invitation_unit"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."role" = 'homeowner' AND NEW."status" = 'pending' THEN
    IF NEW."unitId" IS NULL THEN
      RAISE EXCEPTION 'a homeowner invitation requires a unit'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'CommunityInvitation_unit_required';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM "CommunityUnit"
      WHERE "id" = NEW."unitId" AND "communityId" = NEW."communityId"
    ) THEN
      RAISE EXCEPTION 'invitation unit must belong to the same HOA'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'CommunityInvitation_unit_same_hoa';
    END IF;
  END IF;
  IF NEW."role" = 'hoa_manager' AND NEW."unitId" IS NOT NULL THEN
    RAISE EXCEPTION 'a manager invitation must not reference a unit'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'CommunityInvitation_manager_no_unit';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "CommunityInvitation_validate_unit"
  BEFORE INSERT OR UPDATE OF "unitId", "role", "status"
  ON "CommunityInvitation"
  FOR EACH ROW EXECUTE FUNCTION "bundleen_validate_invitation_unit"();

-- Pre-inventory homeowner invitations cannot satisfy the unit binding; expire
-- the pending ones rather than let them create unit-less memberships.
UPDATE "CommunityInvitation"
SET "status" = 'revoked', "revokedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
WHERE "role" = 'homeowner' AND "status" = 'pending' AND "unitId" IS NULL;

-- ── Participation: per-unit snapshot ──────────────────────────────────────
ALTER TABLE "HoaRequestParticipation"
  ALTER COLUMN "userId" DROP NOT NULL,
  ADD COLUMN "unitId" TEXT,
  ADD COLUMN "response" "ParticipationResponse" NOT NULL DEFAULT 'joined',
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "HoaRequestParticipation"
  ADD CONSTRAINT "HoaRequestParticipation_unitId_fkey"
  FOREIGN KEY ("unitId") REFERENCES "CommunityUnit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Attach the resident's unit to their existing joins where it is known.
UPDATE "HoaRequestParticipation" participation
SET "unitId" = membership."unitId"
FROM "HoaServiceRequest" request, "CommunityMembership" membership
WHERE request."id" = participation."requestId"
  AND membership."communityId" = request."communityId"
  AND membership."userId" = participation."userId"
  AND membership."status" = 'active'
  AND participation."unitId" IS NULL;

DROP INDEX IF EXISTS "HoaRequestParticipation_requestId_userId_key";
CREATE UNIQUE INDEX "HoaRequestParticipation_requestId_unitId_key"
  ON "HoaRequestParticipation"("requestId", "unitId")
  WHERE "unitId" IS NOT NULL;
CREATE UNIQUE INDEX "HoaRequestParticipation_requestId_userId_key"
  ON "HoaRequestParticipation"("requestId", "userId")
  WHERE "userId" IS NOT NULL;
CREATE INDEX "HoaRequestParticipation_requestId_response_idx"
  ON "HoaRequestParticipation"("requestId", "response");

-- Optional requests accept resident joins/declines only while collecting
-- interest; compulsory requests accept only the server's unit snapshot.
CREATE OR REPLACE FUNCTION "bundleen_validate_hoa_request_participation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_community TEXT;
  request_kind "HoaRequestKind";
  request_state "HoaRequestStatus";
  locked_at TIMESTAMP(3);
BEGIN
  SELECT "communityId", "kind", "status", "participantsLockedAt"
    INTO target_community, request_kind, request_state, locked_at
  FROM "HoaServiceRequest" WHERE "id" = NEW."requestId";

  IF locked_at IS NOT NULL AND TG_OP = 'UPDATE'
     AND NEW."response" IS DISTINCT FROM OLD."response" THEN
    RAISE EXCEPTION 'participants are locked for this request'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'HoaRequestParticipation_locked';
  END IF;

  IF request_kind = 'optional_group' THEN
    IF request_state IS DISTINCT FROM 'collecting_interest' THEN
      RAISE EXCEPTION 'optional requests accept responses only while collecting interest'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'HoaRequestParticipation_enrollment_open_required';
    END IF;
    IF NEW."userId" IS NULL OR NEW."unitId" IS NULL THEN
      RAISE EXCEPTION 'optional participation needs the resident and their unit'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'HoaRequestParticipation_resident_unit_required';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM "CommunityMembership"
      WHERE "communityId" = target_community
        AND "userId" = NEW."userId"
        AND "unitId" = NEW."unitId"
        AND "status" = 'active'
    ) THEN
      RAISE EXCEPTION 'request participation requires active HOA membership of that unit'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'HoaRequestParticipation_active_member_required';
    END IF;
  ELSE
    -- Compulsory audience snapshot: written by the server at publish time.
    IF request_state NOT IN ('draft', 'open_for_bids') THEN
      RAISE EXCEPTION 'compulsory audience snapshots are written at publish time'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'HoaRequestParticipation_snapshot_state';
    END IF;
    IF NEW."unitId" IS NULL OR NEW."response" IS DISTINCT FROM 'joined' THEN
      RAISE EXCEPTION 'compulsory participation is a unit snapshot'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'HoaRequestParticipation_snapshot_unit_required';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Re-arm the trigger over the new columns so unit or response edits are also
-- validated, not only user/request moves.
DROP TRIGGER IF EXISTS "HoaRequestParticipation_validate" ON "HoaRequestParticipation";
CREATE TRIGGER "HoaRequestParticipation_validate"
  BEFORE INSERT OR UPDATE OF "requestId", "userId", "unitId", "response"
  ON "HoaRequestParticipation"
  FOR EACH ROW EXECUTE FUNCTION "bundleen_validate_hoa_request_participation"();

-- ── Provider coverage ─────────────────────────────────────────────────────
CREATE TABLE "ProviderServiceArea" (
  "id" TEXT NOT NULL,
  "providerUserId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "centerLatitude" DOUBLE PRECISION,
  "centerLongitude" DOUBLE PRECISION,
  "radiusMiles" DOUBLE PRECISION,
  "postalCodes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "status" "ProviderServiceAreaStatus" NOT NULL DEFAULT 'active',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProviderServiceArea_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProviderServiceArea_label" CHECK (LENGTH(BTRIM("label")) BETWEEN 1 AND 120),
  CONSTRAINT "ProviderServiceArea_center" CHECK (
    (("centerLatitude" IS NULL) = ("centerLongitude" IS NULL))
    AND (("centerLatitude" IS NULL) = ("radiusMiles" IS NULL))
    AND ("centerLatitude" IS NULL
      OR ("centerLatitude" BETWEEN -90 AND 90 AND "centerLongitude" BETWEEN -180 AND 180))
    AND ("radiusMiles" IS NULL OR ("radiusMiles" > 0 AND "radiusMiles" <= 200))
  ),
  CONSTRAINT "ProviderServiceArea_coverage" CHECK (
    "centerLatitude" IS NOT NULL OR CARDINALITY("postalCodes") > 0
  )
);
CREATE INDEX "ProviderServiceArea_providerUserId_status_idx"
  ON "ProviderServiceArea"("providerUserId", "status");
ALTER TABLE "ProviderServiceArea"
  ADD CONSTRAINT "ProviderServiceArea_providerUserId_fkey"
  FOREIGN KEY ("providerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Bids ──────────────────────────────────────────────────────────────────
CREATE TABLE "ServiceBid" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "providerUserId" TEXT NOT NULL,
  "status" "ServiceBidStatus" NOT NULL DEFAULT 'submitted',
  "amountCents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'usd',
  "pricingBasis" "BidPricingBasis" NOT NULL,
  "perHomeCents" INTEGER,
  "proposedStartDate" TIMESTAMP(3),
  "estimatedDurationLabel" TEXT,
  "scope" TEXT NOT NULL,
  "exclusions" TEXT,
  "cadenceLabel" TEXT,
  "validUntil" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "withdrawnAt" TIMESTAMP(3),
  "decidedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ServiceBid_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ServiceBid_money" CHECK (
    "amountCents" >= 0 AND ("perHomeCents" IS NULL OR "perHomeCents" >= 0)
  ),
  CONSTRAINT "ServiceBid_currency" CHECK ("currency" ~ '^[a-z]{3}$'),
  CONSTRAINT "ServiceBid_version" CHECK ("version" >= 1)
);
CREATE UNIQUE INDEX "ServiceBid_requestId_providerUserId_key"
  ON "ServiceBid"("requestId", "providerUserId");
CREATE INDEX "ServiceBid_providerUserId_status_idx" ON "ServiceBid"("providerUserId", "status");
CREATE INDEX "ServiceBid_requestId_status_idx" ON "ServiceBid"("requestId", "status");

-- The double-award guard: at most one accepted bid per request, regardless of
-- what any concurrent transaction believes it validated.
CREATE UNIQUE INDEX "ServiceBid_one_accepted_per_request"
  ON "ServiceBid"("requestId")
  WHERE "status" = 'accepted';

ALTER TABLE "ServiceBid"
  ADD CONSTRAINT "ServiceBid_requestId_fkey"
  FOREIGN KEY ("requestId") REFERENCES "HoaServiceRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ServiceBid"
  ADD CONSTRAINT "ServiceBid_providerUserId_fkey"
  FOREIGN KEY ("providerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- New bids require an open request; later status transitions are the award
-- flow's job and stay out of this trigger.
CREATE OR REPLACE FUNCTION "bundleen_validate_service_bid_insert"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  request_state "HoaRequestStatus";
BEGIN
  SELECT "status" INTO request_state FROM "HoaServiceRequest" WHERE "id" = NEW."requestId";
  IF request_state IS DISTINCT FROM 'open_for_bids' THEN
    RAISE EXCEPTION 'bids are accepted only while a request is open for bids'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'ServiceBid_request_open_required';
  END IF;
  IF NEW."status" NOT IN ('draft', 'submitted') THEN
    RAISE EXCEPTION 'a new bid starts as draft or submitted'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'ServiceBid_initial_status';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ServiceBid_validate_insert"
  BEFORE INSERT ON "ServiceBid"
  FOR EACH ROW EXECUTE FUNCTION "bundleen_validate_service_bid_insert"();

-- ── Agreements ────────────────────────────────────────────────────────────
CREATE TABLE "ServiceAgreement" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "bidId" TEXT NOT NULL,
  "communityId" TEXT NOT NULL,
  "providerUserId" TEXT NOT NULL,
  "awardedByUserId" TEXT,
  "amountCents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'usd',
  "pricingBasis" "BidPricingBasis" NOT NULL,
  "perHomeCents" INTEGER,
  "scope" TEXT NOT NULL,
  "exclusions" TEXT,
  "cadenceLabel" TEXT,
  "lockedHomeCount" INTEGER NOT NULL,
  "startDate" TIMESTAMP(3),
  "endDate" TIMESTAMP(3),
  "status" "ServiceAgreementStatus" NOT NULL DEFAULT 'active',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ServiceAgreement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ServiceAgreement_money" CHECK (
    "amountCents" >= 0 AND ("perHomeCents" IS NULL OR "perHomeCents" >= 0)
  ),
  CONSTRAINT "ServiceAgreement_homes" CHECK ("lockedHomeCount" >= 0),
  CONSTRAINT "ServiceAgreement_dates" CHECK (
    "startDate" IS NULL OR "endDate" IS NULL OR "endDate" >= "startDate"
  )
);
CREATE UNIQUE INDEX "ServiceAgreement_requestId_key" ON "ServiceAgreement"("requestId");
CREATE UNIQUE INDEX "ServiceAgreement_bidId_key" ON "ServiceAgreement"("bidId");
CREATE INDEX "ServiceAgreement_providerUserId_status_idx"
  ON "ServiceAgreement"("providerUserId", "status");
CREATE INDEX "ServiceAgreement_communityId_status_idx"
  ON "ServiceAgreement"("communityId", "status");
ALTER TABLE "ServiceAgreement"
  ADD CONSTRAINT "ServiceAgreement_requestId_fkey"
  FOREIGN KEY ("requestId") REFERENCES "HoaServiceRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ServiceAgreement"
  ADD CONSTRAINT "ServiceAgreement_bidId_fkey"
  FOREIGN KEY ("bidId") REFERENCES "ServiceBid"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ServiceAgreement"
  ADD CONSTRAINT "ServiceAgreement_communityId_fkey"
  FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ServiceAgreement"
  ADD CONSTRAINT "ServiceAgreement_providerUserId_fkey"
  FOREIGN KEY ("providerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ServiceAgreement"
  ADD CONSTRAINT "ServiceAgreement_awardedByUserId_fkey"
  FOREIGN KEY ("awardedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The agreement must describe the bid it accepted.
CREATE OR REPLACE FUNCTION "bundleen_validate_service_agreement"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  bid_request TEXT;
  bid_provider TEXT;
  request_community TEXT;
BEGIN
  SELECT "requestId", "providerUserId" INTO bid_request, bid_provider
  FROM "ServiceBid" WHERE "id" = NEW."bidId";
  SELECT "communityId" INTO request_community
  FROM "HoaServiceRequest" WHERE "id" = NEW."requestId";

  IF bid_request IS DISTINCT FROM NEW."requestId"
     OR bid_provider IS DISTINCT FROM NEW."providerUserId"
     OR request_community IS DISTINCT FROM NEW."communityId" THEN
    RAISE EXCEPTION 'agreement must reference the accepted bid of its own request'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'ServiceAgreement_consistent_award';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ServiceAgreement_validate"
  BEFORE INSERT OR UPDATE OF "requestId", "bidId", "communityId", "providerUserId"
  ON "ServiceAgreement"
  FOR EACH ROW EXECUTE FUNCTION "bundleen_validate_service_agreement"();

-- ── Occurrences and visits ────────────────────────────────────────────────
CREATE TABLE "ServiceOccurrence" (
  "id" TEXT NOT NULL,
  "agreementId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "serviceDate" TIMESTAMP(3) NOT NULL,
  "status" "ServiceOccurrenceStatus" NOT NULL DEFAULT 'planned',
  "closedAt" TIMESTAMP(3),
  "schedulePublishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ServiceOccurrence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ServiceOccurrence_sequence" CHECK ("sequence" BETWEEN 1 AND 104)
);
CREATE UNIQUE INDEX "ServiceOccurrence_agreementId_sequence_key"
  ON "ServiceOccurrence"("agreementId", "sequence");
CREATE INDEX "ServiceOccurrence_agreementId_serviceDate_idx"
  ON "ServiceOccurrence"("agreementId", "serviceDate");
ALTER TABLE "ServiceOccurrence"
  ADD CONSTRAINT "ServiceOccurrence_agreementId_fkey"
  FOREIGN KEY ("agreementId") REFERENCES "ServiceAgreement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ServiceVisit" (
  "id" TEXT NOT NULL,
  "occurrenceId" TEXT NOT NULL,
  "unitId" TEXT NOT NULL,
  "stopRank" INTEGER,
  "scheduledDate" TIMESTAMP(3),
  "windowStart" TEXT,
  "windowEnd" TEXT,
  "estimatedMinutes" INTEGER,
  "status" "ServiceVisitStatus" NOT NULL DEFAULT 'unscheduled',
  "statusChangedAt" TIMESTAMP(3),
  "completionNote" TEXT,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ServiceVisit_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ServiceVisit_stopRank" CHECK ("stopRank" IS NULL OR "stopRank" >= 1),
  CONSTRAINT "ServiceVisit_estimate" CHECK (
    "estimatedMinutes" IS NULL OR ("estimatedMinutes" BETWEEN 1 AND 1440)
  ),
  CONSTRAINT "ServiceVisit_windows" CHECK (
    ("windowStart" IS NULL OR "windowStart" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
    AND ("windowEnd" IS NULL OR "windowEnd" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
  )
);
CREATE UNIQUE INDEX "ServiceVisit_occurrenceId_unitId_key"
  ON "ServiceVisit"("occurrenceId", "unitId");
CREATE INDEX "ServiceVisit_unitId_status_idx" ON "ServiceVisit"("unitId", "status");
CREATE INDEX "ServiceVisit_occurrenceId_stopRank_idx" ON "ServiceVisit"("occurrenceId", "stopRank");
ALTER TABLE "ServiceVisit"
  ADD CONSTRAINT "ServiceVisit_occurrenceId_fkey"
  FOREIGN KEY ("occurrenceId") REFERENCES "ServiceOccurrence"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ServiceVisit"
  ADD CONSTRAINT "ServiceVisit_unitId_fkey"
  FOREIGN KEY ("unitId") REFERENCES "CommunityUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A visit's unit must live in the same HOA as its agreement.
CREATE OR REPLACE FUNCTION "bundleen_validate_service_visit"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  agreement_community TEXT;
  unit_community TEXT;
BEGIN
  SELECT agreement."communityId" INTO agreement_community
  FROM "ServiceOccurrence" occurrence
  JOIN "ServiceAgreement" agreement ON agreement."id" = occurrence."agreementId"
  WHERE occurrence."id" = NEW."occurrenceId";
  SELECT "communityId" INTO unit_community FROM "CommunityUnit" WHERE "id" = NEW."unitId";

  IF agreement_community IS DISTINCT FROM unit_community THEN
    RAISE EXCEPTION 'visit unit must belong to the agreement''s HOA'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'ServiceVisit_unit_same_hoa';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ServiceVisit_validate"
  BEFORE INSERT OR UPDATE OF "occurrenceId", "unitId"
  ON "ServiceVisit"
  FOR EACH ROW EXECUTE FUNCTION "bundleen_validate_service_visit"();

-- ── Reviews ───────────────────────────────────────────────────────────────
CREATE TABLE "Review" (
  "id" TEXT NOT NULL,
  "reviewerUserId" TEXT NOT NULL,
  "providerUserId" TEXT NOT NULL,
  "visitId" TEXT,
  "agreementId" TEXT,
  "rating" INTEGER NOT NULL,
  "comment" TEXT NOT NULL,
  "status" "ReviewStatus" NOT NULL DEFAULT 'published',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Review_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Review_rating" CHECK ("rating" BETWEEN 1 AND 5),
  CONSTRAINT "Review_comment" CHECK (LENGTH("comment") <= 2000),
  CONSTRAINT "Review_one_subject" CHECK (
    ("visitId" IS NULL) <> ("agreementId" IS NULL)
  ),
  CONSTRAINT "Review_not_self" CHECK ("reviewerUserId" <> "providerUserId")
);
CREATE UNIQUE INDEX "Review_reviewerUserId_visitId_key"
  ON "Review"("reviewerUserId", "visitId") WHERE "visitId" IS NOT NULL;
CREATE UNIQUE INDEX "Review_reviewerUserId_agreementId_key"
  ON "Review"("reviewerUserId", "agreementId") WHERE "agreementId" IS NOT NULL;
CREATE INDEX "Review_providerUserId_status_createdAt_idx"
  ON "Review"("providerUserId", "status", "createdAt");
ALTER TABLE "Review"
  ADD CONSTRAINT "Review_reviewerUserId_fkey"
  FOREIGN KEY ("reviewerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Review"
  ADD CONSTRAINT "Review_providerUserId_fkey"
  FOREIGN KEY ("providerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Review"
  ADD CONSTRAINT "Review_visitId_fkey"
  FOREIGN KEY ("visitId") REFERENCES "ServiceVisit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Review"
  ADD CONSTRAINT "Review_agreementId_fkey"
  FOREIGN KEY ("agreementId") REFERENCES "ServiceAgreement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Reviews come only from completed work.
CREATE OR REPLACE FUNCTION "bundleen_validate_review"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."visitId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "ServiceVisit" WHERE "id" = NEW."visitId" AND "status" = 'completed'
  ) THEN
    RAISE EXCEPTION 'only a completed visit can be reviewed'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'Review_completed_visit_required';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "Review_validate"
  BEFORE INSERT ON "Review"
  FOR EACH ROW EXECUTE FUNCTION "bundleen_validate_review"();

-- ── Notifications and outbox ──────────────────────────────────────────────
CREATE TABLE "Notification" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "kind" "NotificationKind" NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "linkPath" TEXT,
  "dedupeKey" TEXT NOT NULL,
  "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON "Notification"("dedupeKey");
CREATE INDEX "Notification_userId_readAt_createdAt_idx"
  ON "Notification"("userId", "readAt", "createdAt");
ALTER TABLE "Notification"
  ADD CONSTRAINT "Notification_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "OutboxEvent" (
  "id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "dedupeKey" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" "OutboxStatus" NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastError" TEXT,
  "deliveredAt" TIMESTAMP(3),
  "providerMessageId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OutboxEvent_attempts" CHECK ("attempts" >= 0)
);
CREATE UNIQUE INDEX "OutboxEvent_dedupeKey_key" ON "OutboxEvent"("dedupeKey");
CREATE INDEX "OutboxEvent_status_nextAttemptAt_idx" ON "OutboxEvent"("status", "nextAttemptAt");
