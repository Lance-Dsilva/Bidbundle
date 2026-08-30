-- Shared HOA / non-HOA service lifecycle, plus server-resolved addresses.
--
-- Two changes, both additive and forward-only:
--
--  1. `ServiceVisit` becomes a stop at *exactly one* service target — either
--     the HOA `CommunityUnit` it has always pointed at, or a participating
--     neighborhood homeowner plus an immutable service-location snapshot taken
--     at award time. Every existing row is an HOA unit visit and is left
--     exactly as it is; the new columns are all nullable, and the CHECK that
--     enforces "exactly one target" is satisfied by those rows unchanged.
--
--  2. HOA and unit postal addresses carry a server-owned verification status,
--     the geocoder's normalized rendering, and the provider place id. Admins
--     stop typing latitude/longitude; the columns stay, because provider
--     matching, maps, distance, and routing all read them — they are simply
--     never written by hand again.
--
-- ── Operational recovery ─────────────────────────────────────────────────
--
-- Nothing here deletes, rewrites, or reinterprets HOA data. If this migration
-- must be reversed on a running database, the safe reversal is:
--
--   ALTER TABLE "ServiceVisit"
--     DROP CONSTRAINT "ServiceVisit_homeowner_snapshot",
--     DROP CONSTRAINT "ServiceVisit_one_target";
--   DELETE FROM "ServiceVisit" WHERE "unitId" IS NULL;   -- neighborhood stops
--   ALTER TABLE "ServiceVisit" ALTER COLUMN "unitId" SET NOT NULL;
--
-- and then dropping the added columns. Run the DELETE only after confirming
-- no neighborhood agreement is live: it discards neighborhood work, never HOA
-- work. The address columns can be dropped independently and at any time; the
-- pre-existing "latitude"/"longitude" columns are untouched by a rollback, so
-- provider matching keeps working throughout.

-- ── Audit vocabulary ──────────────────────────────────────────────────────
-- Added first and used by nothing in this file: PostgreSQL forbids using an
-- enum value in the same transaction that creates it.
ALTER TYPE "AdminAuditAction" ADD VALUE IF NOT EXISTS 'address_verified';
ALTER TYPE "AdminAuditAction" ADD VALUE IF NOT EXISTS 'address_verification_failed';
ALTER TYPE "AdminAuditAction" ADD VALUE IF NOT EXISTS 'marketplace_recovery_action';

-- ── Address verification ──────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AddressVerificationStatus') THEN
    CREATE TYPE "AddressVerificationStatus" AS ENUM ('pending', 'verified', 'needs_correction');
  END IF;
END
$$;

ALTER TABLE "HoaProfile"
  ADD COLUMN IF NOT EXISTS "formattedAddress" TEXT,
  ADD COLUMN IF NOT EXISTS "addressVerificationStatus" "AddressVerificationStatus"
    NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS "addressVerifiedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "geocodePlaceId" TEXT,
  ADD COLUMN IF NOT EXISTS "geocodeConfidence" DOUBLE PRECISION;

-- Backfill: an HOA that already has coordinates was verified by whatever put
-- them there, and provider matching already trusts them. Marking it `pending`
-- instead would take a live HOA offline for no reason.
UPDATE "HoaProfile"
SET "addressVerificationStatus" = 'verified',
    "addressVerifiedAt" = COALESCE("addressVerifiedAt", "updatedAt")
WHERE "latitude" IS NOT NULL
  AND "longitude" IS NOT NULL
  AND "addressVerificationStatus" = 'pending';

ALTER TABLE "HoaProfile"
  DROP CONSTRAINT IF EXISTS "HoaProfile_verified_has_coordinates";
ALTER TABLE "HoaProfile"
  ADD CONSTRAINT "HoaProfile_verified_has_coordinates" CHECK (
    "addressVerificationStatus" <> 'verified'
    OR ("latitude" IS NOT NULL AND "longitude" IS NOT NULL)
  );

ALTER TABLE "HoaProfile"
  DROP CONSTRAINT IF EXISTS "HoaProfile_geocode_confidence";
ALTER TABLE "HoaProfile"
  ADD CONSTRAINT "HoaProfile_geocode_confidence" CHECK (
    "geocodeConfidence" IS NULL OR ("geocodeConfidence" >= 0 AND "geocodeConfidence" <= 1)
  );

ALTER TABLE "CommunityUnit"
  ADD COLUMN IF NOT EXISTS "formattedAddress" TEXT,
  ADD COLUMN IF NOT EXISTS "addressVerificationStatus" "AddressVerificationStatus"
    NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS "addressVerifiedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "geocodePlaceId" TEXT;

UPDATE "CommunityUnit"
SET "addressVerificationStatus" = 'verified',
    "addressVerifiedAt" = COALESCE("addressVerifiedAt", "updatedAt")
WHERE "latitude" IS NOT NULL
  AND "longitude" IS NOT NULL
  AND "addressVerificationStatus" = 'pending';

-- Operational readiness is asked often enough (every award, every feed) to
-- deserve an index rather than a scan of the whole inventory.
CREATE INDEX IF NOT EXISTS "CommunityUnit_communityId_addressVerificationStatus_idx"
  ON "CommunityUnit"("communityId", "addressVerificationStatus");

-- ── ServiceVisit: two kinds of target, exactly one per row ────────────────

-- Staged as required: add nullable, backfill nothing (every existing row is
-- already an HOA unit visit), then constrain.
ALTER TABLE "ServiceVisit"
  ADD COLUMN IF NOT EXISTS "homeownerUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "serviceLabel" TEXT,
  ADD COLUMN IF NOT EXISTS "serviceAddressLine1" TEXT,
  ADD COLUMN IF NOT EXISTS "serviceAddressLine2" TEXT,
  ADD COLUMN IF NOT EXISTS "serviceLocality" TEXT,
  ADD COLUMN IF NOT EXISTS "serviceRegion" TEXT,
  ADD COLUMN IF NOT EXISTS "servicePostalCode" TEXT,
  ADD COLUMN IF NOT EXISTS "serviceCountry" TEXT,
  ADD COLUMN IF NOT EXISTS "serviceLatitude" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "serviceLongitude" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "serviceAccessNotes" TEXT;

-- `unitId` becomes nullable only together with the exactly-one-target CHECK
-- below. A nullable target column on its own would allow a visit with no
-- service location at all, which is precisely the failure this migration
-- exists to prevent.
ALTER TABLE "ServiceVisit" ALTER COLUMN "unitId" DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ServiceVisit_homeownerUserId_fkey'
  ) THEN
    ALTER TABLE "ServiceVisit"
      ADD CONSTRAINT "ServiceVisit_homeownerUserId_fkey"
      FOREIGN KEY ("homeownerUserId") REFERENCES "User"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$$;

ALTER TABLE "ServiceVisit"
  DROP CONSTRAINT IF EXISTS "ServiceVisit_one_target";
ALTER TABLE "ServiceVisit"
  ADD CONSTRAINT "ServiceVisit_one_target" CHECK (
    (("unitId" IS NOT NULL)::int + ("homeownerUserId" IS NOT NULL)::int) = 1
  );

-- A neighborhood stop must carry the address and coordinates needed to perform
-- and route the work. There is no fallback to a mutable profile: if the
-- snapshot is absent the row cannot exist.
ALTER TABLE "ServiceVisit"
  DROP CONSTRAINT IF EXISTS "ServiceVisit_homeowner_snapshot";
ALTER TABLE "ServiceVisit"
  ADD CONSTRAINT "ServiceVisit_homeowner_snapshot" CHECK (
    "homeownerUserId" IS NULL
    OR (
      "serviceAddressLine1" IS NOT NULL
      AND LENGTH(BTRIM("serviceAddressLine1")) > 0
      AND "serviceLatitude" IS NOT NULL
      AND "serviceLongitude" IS NOT NULL
      AND "serviceLatitude" BETWEEN -90 AND 90
      AND "serviceLongitude" BETWEEN -180 AND 180
    )
  );

-- One stop per home per service day, the neighborhood twin of the existing
-- (occurrenceId, unitId) index. NULLs are distinct in PostgreSQL, so HOA rows
-- (homeownerUserId IS NULL) are unaffected by it.
CREATE UNIQUE INDEX IF NOT EXISTS "ServiceVisit_occurrenceId_homeownerUserId_key"
  ON "ServiceVisit"("occurrenceId", "homeownerUserId");

CREATE INDEX IF NOT EXISTS "ServiceVisit_homeownerUserId_status_idx"
  ON "ServiceVisit"("homeownerUserId", "status");

-- The schedule/reminder sweeps read by status and date across all agreements.
CREATE INDEX IF NOT EXISTS "ServiceVisit_status_scheduledDate_idx"
  ON "ServiceVisit"("status", "scheduledDate");

-- ── Feed indexes ──────────────────────────────────────────────────────────
-- The provider marketplace reads open requests across both community types,
-- ordered by deadline. Without this it scans every request ever created.
CREATE INDEX IF NOT EXISTS "HoaServiceRequest_status_biddingClosesAt_idx"
  ON "HoaServiceRequest"("status", "biddingClosesAt");

-- Neighborhood enrollment and the deadline reconciler both read by status and
-- enrollment deadline.
CREATE INDEX IF NOT EXISTS "HoaServiceRequest_status_enrollmentClosesAt_idx"
  ON "HoaServiceRequest"("status", "enrollmentClosesAt");

-- A resident's own participations, read on every neighborhood page load.
CREATE INDEX IF NOT EXISTS "HoaRequestParticipation_userId_response_idx"
  ON "HoaRequestParticipation"("userId", "response");
