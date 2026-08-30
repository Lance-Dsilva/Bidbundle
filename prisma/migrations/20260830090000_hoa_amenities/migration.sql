-- HOA amenities, bookings, issues, reviews, and shared media.
--
-- Entirely additive and forward-only. Nothing here touches an existing table's
-- data: the only pre-existing objects modified are three enums, which gain new
-- values, and `OutboxEvent`, which gains no columns at all — the delayed
-- booking reminder reuses its existing `nextAttemptAt` as a due time.
--
-- ── The one interesting constraint ───────────────────────────────────────
--
-- `AmenityBooking_no_overlap` is an exclusion constraint over
-- (resourceId, [blockStartsAt, blockEndsAt)) restricted to the two statuses
-- that hold capacity. It is what makes overbooking impossible rather than
-- unlikely: two residents submitting for the last slot at the same instant
-- both reach the INSERT, and PostgreSQL fails exactly one of them with
-- SQLSTATE 23P01. Capacity greater than one is modelled as multiple
-- `AmenityResource` rows, so the same constraint covers "four courts" without
-- a counting algorithm anywhere in application code.
--
-- ── Operational recovery ─────────────────────────────────────────────────
--
-- To reverse on a running database, in this order:
--
--   DROP TABLE "AmenityReviewResponse", "AmenityReview", "AmenityIssueEvent",
--     "AmenityIssueMessage", "AmenityIssue", "AmenityBookingEvent",
--     "AmenityBooking", "AmenityClosure", "AmenityHours", "AmenityResource",
--     "MediaAsset", "Amenity" CASCADE;
--   DELETE FROM "OutboxEvent" WHERE "kind" = 'amenity_booking_reminder';
--
-- The added enum values are harmless to leave in place; PostgreSQL cannot drop
-- an enum value, and nothing outside these tables writes one. No HOA, request,
-- bid, agreement, occurrence, visit, review, or audit row is read or written by
-- this migration, so a rollback cannot lose marketplace history.
--
-- `btree_gist` is required for the exclusion constraint's equality operator on
-- a text column. It ships with PostgreSQL contrib and is available on Vercel
-- Postgres/Neon/RDS. If the role cannot create extensions, an operator must run
-- `CREATE EXTENSION btree_gist;` once as superuser before deploying.

-- ── Enum vocabulary ───────────────────────────────────────────────────────
-- Added first and used by nothing in this file: PostgreSQL forbids using an
-- enum value in the same transaction that creates it.
ALTER TYPE "NotificationKind" ADD VALUE IF NOT EXISTS 'booking';
ALTER TYPE "NotificationKind" ADD VALUE IF NOT EXISTS 'issue';

ALTER TYPE "AdminAuditAction" ADD VALUE IF NOT EXISTS 'amenity_created';
ALTER TYPE "AdminAuditAction" ADD VALUE IF NOT EXISTS 'amenity_updated';
ALTER TYPE "AdminAuditAction" ADD VALUE IF NOT EXISTS 'amenity_published';
ALTER TYPE "AdminAuditAction" ADD VALUE IF NOT EXISTS 'amenity_archived';
ALTER TYPE "AdminAuditAction" ADD VALUE IF NOT EXISTS 'amenity_closure_changed';
ALTER TYPE "AdminAuditAction" ADD VALUE IF NOT EXISTS 'amenity_booking_status_changed';
ALTER TYPE "AdminAuditAction" ADD VALUE IF NOT EXISTS 'amenity_issue_status_changed';
ALTER TYPE "AdminAuditAction" ADD VALUE IF NOT EXISTS 'amenity_issue_assigned';
ALTER TYPE "AdminAuditAction" ADD VALUE IF NOT EXISTS 'amenity_review_moderated';
ALTER TYPE "AdminAuditAction" ADD VALUE IF NOT EXISTS 'amenity_broadcast_sent';
ALTER TYPE "AdminAuditAction" ADD VALUE IF NOT EXISTS 'amenity_media_removed';

ALTER TYPE "AdminAuditTargetType" ADD VALUE IF NOT EXISTS 'amenity';
ALTER TYPE "AdminAuditTargetType" ADD VALUE IF NOT EXISTS 'amenity_booking';
ALTER TYPE "AdminAuditTargetType" ADD VALUE IF NOT EXISTS 'amenity_issue';
ALTER TYPE "AdminAuditTargetType" ADD VALUE IF NOT EXISTS 'amenity_review';
ALTER TYPE "AdminAuditTargetType" ADD VALUE IF NOT EXISTS 'media_asset';

-- ── New enums ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AmenityStatus') THEN
    CREATE TYPE "AmenityStatus" AS ENUM ('draft', 'published', 'archived');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AmenityOperationalStatus') THEN
    CREATE TYPE "AmenityOperationalStatus" AS ENUM ('open', 'closed', 'maintenance', 'temporarily_unavailable');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AmenityType') THEN
    CREATE TYPE "AmenityType" AS ENUM ('pool', 'clubhouse', 'gym', 'tennis_court', 'badminton_court', 'basketball_court', 'meeting_room', 'barbecue_area', 'playground', 'park', 'other');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AmenityClosureKind') THEN
    CREATE TYPE "AmenityClosureKind" AS ENUM ('blackout', 'maintenance', 'holiday', 'private_event');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AmenityBookingStatus') THEN
    CREATE TYPE "AmenityBookingStatus" AS ENUM ('pending_approval', 'confirmed', 'declined', 'cancelled_by_resident', 'cancelled_by_manager', 'completed', 'no_show');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AmenityBookingEventType') THEN
    CREATE TYPE "AmenityBookingEventType" AS ENUM ('requested', 'confirmed', 'approved', 'declined', 'cancelled_by_resident', 'cancelled_by_manager', 'rescheduled', 'completed', 'no_show', 'reminder_scheduled', 'reminder_cancelled');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AmenityIssueCategory') THEN
    CREATE TYPE "AmenityIssueCategory" AS ENUM ('damage', 'cleanliness', 'safety', 'access', 'equipment', 'reservation_conflict', 'noise', 'other');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AmenityIssuePriority') THEN
    CREATE TYPE "AmenityIssuePriority" AS ENUM ('low', 'normal', 'high', 'urgent');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AmenityIssueStatus') THEN
    CREATE TYPE "AmenityIssueStatus" AS ENUM ('new', 'acknowledged', 'investigating', 'waiting_on_resident', 'resolved', 'closed');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AmenityIssueMessageKind') THEN
    CREATE TYPE "AmenityIssueMessageKind" AS ENUM ('resident_message', 'manager_reply', 'internal_note');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MediaPurpose') THEN
    CREATE TYPE "MediaPurpose" AS ENUM ('amenity_gallery', 'amenity_review', 'amenity_issue');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MediaStatus') THEN
    CREATE TYPE "MediaStatus" AS ENUM ('active', 'removed');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AmenityReviewStatus') THEN
    CREATE TYPE "AmenityReviewStatus" AS ENUM ('published', 'removed');
  END IF;
END
$$;

-- ── Amenity ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "Amenity" (
  "id" TEXT NOT NULL,
  "communityId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" "AmenityType" NOT NULL,
  "description" TEXT,
  "features" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "locationLabel" TEXT,
  "rules" TEXT,
  "permittedUses" TEXT,
  "ageRestriction" TEXT,
  "guestPolicy" TEXT,
  "cancellationPolicy" TEXT,
  "contactInstructions" TEXT,
  "status" "AmenityStatus" NOT NULL DEFAULT 'draft',
  "operationalStatus" "AmenityOperationalStatus" NOT NULL DEFAULT 'open',
  "operationalNote" TEXT,
  "reopensAt" TIMESTAMP(3),
  "bookingRequired" BOOLEAN NOT NULL DEFAULT false,
  "slotMinutes" INTEGER NOT NULL DEFAULT 60,
  "minDurationMinutes" INTEGER NOT NULL DEFAULT 60,
  "maxDurationMinutes" INTEGER NOT NULL DEFAULT 120,
  "bufferMinutes" INTEGER NOT NULL DEFAULT 0,
  "maxPartySize" INTEGER NOT NULL DEFAULT 1,
  "advanceDays" INTEGER NOT NULL DEFAULT 14,
  "minNoticeMinutes" INTEGER NOT NULL DEFAULT 0,
  "cancellationCutoffMinutes" INTEGER NOT NULL DEFAULT 120,
  "maxActiveBookingsPerResident" INTEGER NOT NULL DEFAULT 2,
  "maxActiveBookingsPerUnit" INTEGER,
  "approvalRequired" BOOLEAN NOT NULL DEFAULT false,
  "coverMediaId" TEXT,
  "ratingCount" INTEGER NOT NULL DEFAULT 0,
  "ratingSum" INTEGER NOT NULL DEFAULT 0,
  "createdByUserId" TEXT NOT NULL,
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Amenity_pkey" PRIMARY KEY ("id")
);

-- Policy sanity. These are the invariants the availability engine assumes; a
-- direct database edit that broke one would silently produce wrong slots.
ALTER TABLE "Amenity" DROP CONSTRAINT IF EXISTS "Amenity_policy_bounds";
ALTER TABLE "Amenity" ADD CONSTRAINT "Amenity_policy_bounds" CHECK (
  "slotMinutes" BETWEEN 5 AND 1440
  AND "minDurationMinutes" BETWEEN 5 AND 1440
  AND "maxDurationMinutes" BETWEEN "minDurationMinutes" AND 1440
  AND "bufferMinutes" BETWEEN 0 AND 240
  AND "maxPartySize" BETWEEN 1 AND 500
  AND "advanceDays" BETWEEN 0 AND 365
  AND "minNoticeMinutes" BETWEEN 0 AND 43200
  AND "cancellationCutoffMinutes" BETWEEN 0 AND 43200
  AND "maxActiveBookingsPerResident" BETWEEN 1 AND 50
  AND ("maxActiveBookingsPerUnit" IS NULL OR "maxActiveBookingsPerUnit" BETWEEN 1 AND 50)
);

ALTER TABLE "Amenity" DROP CONSTRAINT IF EXISTS "Amenity_rating_aggregate";
ALTER TABLE "Amenity" ADD CONSTRAINT "Amenity_rating_aggregate" CHECK (
  "ratingCount" >= 0
  AND "ratingSum" >= 0
  AND "ratingSum" <= "ratingCount" * 5
  AND ("ratingCount" = 0 OR "ratingSum" >= "ratingCount")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Amenity_communityId_name_key" ON "Amenity"("communityId", "name");
CREATE UNIQUE INDEX IF NOT EXISTS "Amenity_coverMediaId_key" ON "Amenity"("coverMediaId");
CREATE INDEX IF NOT EXISTS "Amenity_communityId_status_name_idx" ON "Amenity"("communityId", "status", "name");
CREATE INDEX IF NOT EXISTS "Amenity_communityId_status_type_idx" ON "Amenity"("communityId", "status", "type");

-- ── MediaAsset ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "MediaAsset" (
  "id" TEXT NOT NULL,
  "communityId" TEXT NOT NULL,
  "purpose" "MediaPurpose" NOT NULL,
  "uploaderUserId" TEXT NOT NULL,
  "amenityId" TEXT,
  "reviewId" TEXT,
  "issueId" TEXT,
  "storagePath" TEXT NOT NULL,
  "storageUrl" TEXT NOT NULL,
  "contentType" TEXT NOT NULL,
  "byteSize" INTEGER NOT NULL,
  "width" INTEGER,
  "height" INTEGER,
  "checksum" TEXT NOT NULL,
  "position" INTEGER,
  "status" "MediaStatus" NOT NULL DEFAULT 'active',
  "deletedAt" TIMESTAMP(3),
  "moderatedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

-- Exactly one owner, and the owner has to agree with the declared purpose. An
-- issue photo can therefore never be reachable through gallery authorization.
ALTER TABLE "MediaAsset" DROP CONSTRAINT IF EXISTS "MediaAsset_one_owner";
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_one_owner" CHECK (
  (
    ("amenityId" IS NOT NULL)::int
    + ("reviewId" IS NOT NULL)::int
    + ("issueId" IS NOT NULL)::int
  ) = 1
  AND ("purpose" <> 'amenity_gallery' OR "amenityId" IS NOT NULL)
  AND ("purpose" <> 'amenity_review'  OR "reviewId"  IS NOT NULL)
  AND ("purpose" <> 'amenity_issue'   OR "issueId"   IS NOT NULL)
);

ALTER TABLE "MediaAsset" DROP CONSTRAINT IF EXISTS "MediaAsset_supported_type";
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_supported_type" CHECK (
  "contentType" IN ('image/jpeg', 'image/png', 'image/webp')
  AND "byteSize" > 0
);

CREATE UNIQUE INDEX IF NOT EXISTS "MediaAsset_storagePath_key" ON "MediaAsset"("storagePath");
CREATE INDEX IF NOT EXISTS "MediaAsset_amenityId_status_position_idx" ON "MediaAsset"("amenityId", "status", "position");
CREATE INDEX IF NOT EXISTS "MediaAsset_reviewId_status_idx" ON "MediaAsset"("reviewId", "status");
CREATE INDEX IF NOT EXISTS "MediaAsset_issueId_status_idx" ON "MediaAsset"("issueId", "status");
CREATE INDEX IF NOT EXISTS "MediaAsset_communityId_purpose_createdAt_idx" ON "MediaAsset"("communityId", "purpose", "createdAt");

-- ── AmenityResource ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "AmenityResource" (
  "id" TEXT NOT NULL,
  "amenityId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "position" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AmenityResource_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AmenityResource_amenityId_label_key" ON "AmenityResource"("amenityId", "label");
CREATE INDEX IF NOT EXISTS "AmenityResource_amenityId_active_position_idx" ON "AmenityResource"("amenityId", "active", "position");

-- ── AmenityHours ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "AmenityHours" (
  "id" TEXT NOT NULL,
  "amenityId" TEXT NOT NULL,
  "weekday" "Weekday" NOT NULL,
  "opensMinute" INTEGER NOT NULL,
  "closesMinute" INTEGER NOT NULL,
  CONSTRAINT "AmenityHours_pkey" PRIMARY KEY ("id")
);

-- `closesMinute` may pass midnight (up to 06:00 the next day) but must always
-- be after `opensMinute`: a zero-length or inverted window is a data bug, not
-- a 24-hour opening.
ALTER TABLE "AmenityHours" DROP CONSTRAINT IF EXISTS "AmenityHours_window";
ALTER TABLE "AmenityHours" ADD CONSTRAINT "AmenityHours_window" CHECK (
  "opensMinute" >= 0
  AND "opensMinute" < 1440
  AND "closesMinute" > "opensMinute"
  AND "closesMinute" <= 1800
);

CREATE UNIQUE INDEX IF NOT EXISTS "AmenityHours_amenityId_weekday_opensMinute_key" ON "AmenityHours"("amenityId", "weekday", "opensMinute");
CREATE INDEX IF NOT EXISTS "AmenityHours_amenityId_weekday_idx" ON "AmenityHours"("amenityId", "weekday");

-- ── AmenityClosure ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "AmenityClosure" (
  "id" TEXT NOT NULL,
  "amenityId" TEXT NOT NULL,
  "kind" "AmenityClosureKind" NOT NULL DEFAULT 'blackout',
  "startsAt" TIMESTAMP(3),
  "endsAt" TIMESTAMP(3),
  "recurringWeekday" "Weekday",
  "recurringStartMinute" INTEGER,
  "recurringEndMinute" INTEGER,
  "residentVisible" BOOLEAN NOT NULL DEFAULT true,
  "reason" TEXT,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AmenityClosure_pkey" PRIMARY KEY ("id")
);

-- A closure is one-off or weekly recurring, never both and never neither.
ALTER TABLE "AmenityClosure" DROP CONSTRAINT IF EXISTS "AmenityClosure_one_shape";
ALTER TABLE "AmenityClosure" ADD CONSTRAINT "AmenityClosure_one_shape" CHECK (
  (
    "startsAt" IS NOT NULL AND "endsAt" IS NOT NULL AND "endsAt" > "startsAt"
    AND "recurringWeekday" IS NULL AND "recurringStartMinute" IS NULL AND "recurringEndMinute" IS NULL
  )
  OR
  (
    "startsAt" IS NULL AND "endsAt" IS NULL
    AND "recurringWeekday" IS NOT NULL
    AND "recurringStartMinute" IS NOT NULL AND "recurringStartMinute" >= 0 AND "recurringStartMinute" < 1440
    AND "recurringEndMinute" IS NOT NULL AND "recurringEndMinute" > "recurringStartMinute" AND "recurringEndMinute" <= 1800
  )
);

CREATE INDEX IF NOT EXISTS "AmenityClosure_amenityId_startsAt_endsAt_idx" ON "AmenityClosure"("amenityId", "startsAt", "endsAt");
CREATE INDEX IF NOT EXISTS "AmenityClosure_amenityId_recurringWeekday_idx" ON "AmenityClosure"("amenityId", "recurringWeekday");

-- ── AmenityBooking ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "AmenityBooking" (
  "id" TEXT NOT NULL,
  "communityId" TEXT NOT NULL,
  "amenityId" TEXT NOT NULL,
  "resourceId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "unitId" TEXT,
  "reference" TEXT NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "blockStartsAt" TIMESTAMP(3) NOT NULL,
  "blockEndsAt" TIMESTAMP(3) NOT NULL,
  "partySize" INTEGER NOT NULL DEFAULT 1,
  "status" "AmenityBookingStatus" NOT NULL,
  "timezone" TEXT NOT NULL,
  "policySnapshot" JSONB NOT NULL,
  "residentNote" TEXT,
  "approvalRequired" BOOLEAN NOT NULL DEFAULT false,
  "approvedByUserId" TEXT,
  "approvedAt" TIMESTAMP(3),
  "cancelledByUserId" TEXT,
  "cancelledAt" TIMESTAMP(3),
  "cancellationReason" TEXT,
  "isManagerBlock" BOOLEAN NOT NULL DEFAULT false,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AmenityBooking_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "AmenityBooking" DROP CONSTRAINT IF EXISTS "AmenityBooking_range";
ALTER TABLE "AmenityBooking" ADD CONSTRAINT "AmenityBooking_range" CHECK (
  "endsAt" > "startsAt"
  AND "blockStartsAt" <= "startsAt"
  AND "blockEndsAt" >= "endsAt"
  AND "partySize" >= 1
);

CREATE UNIQUE INDEX IF NOT EXISTS "AmenityBooking_reference_key" ON "AmenityBooking"("reference");
CREATE INDEX IF NOT EXISTS "AmenityBooking_amenityId_startsAt_idx" ON "AmenityBooking"("amenityId", "startsAt");
CREATE INDEX IF NOT EXISTS "AmenityBooking_communityId_status_startsAt_idx" ON "AmenityBooking"("communityId", "status", "startsAt");
CREATE INDEX IF NOT EXISTS "AmenityBooking_userId_startsAt_idx" ON "AmenityBooking"("userId", "startsAt");
CREATE INDEX IF NOT EXISTS "AmenityBooking_resourceId_blockStartsAt_idx" ON "AmenityBooking"("resourceId", "blockStartsAt");
CREATE INDEX IF NOT EXISTS "AmenityBooking_status_startsAt_idx" ON "AmenityBooking"("status", "startsAt");

-- The no-overbooking guarantee. See the header note.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "AmenityBooking" DROP CONSTRAINT IF EXISTS "AmenityBooking_no_overlap";
ALTER TABLE "AmenityBooking" ADD CONSTRAINT "AmenityBooking_no_overlap"
  EXCLUDE USING gist (
    "resourceId" WITH =,
    tsrange("blockStartsAt", "blockEndsAt", '[)') WITH &&
  )
  WHERE ("status" IN ('pending_approval', 'confirmed'));

-- ── AmenityBookingEvent ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "AmenityBookingEvent" (
  "id" TEXT NOT NULL,
  "bookingId" TEXT NOT NULL,
  "type" "AmenityBookingEventType" NOT NULL,
  "actorUserId" TEXT,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AmenityBookingEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AmenityBookingEvent_bookingId_createdAt_idx" ON "AmenityBookingEvent"("bookingId", "createdAt");

-- ── AmenityIssue ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "AmenityIssue" (
  "id" TEXT NOT NULL,
  "communityId" TEXT NOT NULL,
  "amenityId" TEXT NOT NULL,
  "reporterUserId" TEXT NOT NULL,
  "bookingId" TEXT,
  "reference" TEXT NOT NULL,
  "category" "AmenityIssueCategory" NOT NULL,
  "priority" "AmenityIssuePriority" NOT NULL DEFAULT 'normal',
  "status" "AmenityIssueStatus" NOT NULL DEFAULT 'new',
  "subject" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "assignedToUserId" TEXT,
  "resolutionSummary" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "closedAt" TIMESTAMP(3),
  "withdrawnAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AmenityIssue_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AmenityIssue_reference_key" ON "AmenityIssue"("reference");
CREATE INDEX IF NOT EXISTS "AmenityIssue_communityId_status_createdAt_idx" ON "AmenityIssue"("communityId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "AmenityIssue_amenityId_status_idx" ON "AmenityIssue"("amenityId", "status");
CREATE INDEX IF NOT EXISTS "AmenityIssue_reporterUserId_createdAt_idx" ON "AmenityIssue"("reporterUserId", "createdAt");
CREATE INDEX IF NOT EXISTS "AmenityIssue_assignedToUserId_status_idx" ON "AmenityIssue"("assignedToUserId", "status");

CREATE TABLE IF NOT EXISTS "AmenityIssueMessage" (
  "id" TEXT NOT NULL,
  "issueId" TEXT NOT NULL,
  "authorUserId" TEXT NOT NULL,
  "kind" "AmenityIssueMessageKind" NOT NULL,
  "body" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AmenityIssueMessage_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AmenityIssueMessage_issueId_createdAt_idx" ON "AmenityIssueMessage"("issueId", "createdAt");
CREATE INDEX IF NOT EXISTS "AmenityIssueMessage_issueId_kind_idx" ON "AmenityIssueMessage"("issueId", "kind");

CREATE TABLE IF NOT EXISTS "AmenityIssueEvent" (
  "id" TEXT NOT NULL,
  "issueId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "actorUserId" TEXT,
  "fromStatus" "AmenityIssueStatus",
  "toStatus" "AmenityIssueStatus",
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AmenityIssueEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AmenityIssueEvent_issueId_createdAt_idx" ON "AmenityIssueEvent"("issueId", "createdAt");

-- ── AmenityReview ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "AmenityReview" (
  "id" TEXT NOT NULL,
  "communityId" TEXT NOT NULL,
  "amenityId" TEXT NOT NULL,
  "authorUserId" TEXT NOT NULL,
  "bookingId" TEXT,
  "rating" INTEGER NOT NULL,
  "comment" TEXT NOT NULL,
  "status" "AmenityReviewStatus" NOT NULL DEFAULT 'published',
  "editedAt" TIMESTAMP(3),
  "moderatedByUserId" TEXT,
  "moderationReason" TEXT,
  "moderatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AmenityReview_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "AmenityReview" DROP CONSTRAINT IF EXISTS "AmenityReview_rating_range";
ALTER TABLE "AmenityReview" ADD CONSTRAINT "AmenityReview_rating_range" CHECK ("rating" BETWEEN 1 AND 5);

CREATE UNIQUE INDEX IF NOT EXISTS "AmenityReview_bookingId_key" ON "AmenityReview"("bookingId");
-- One live review per resident per non-bookable amenity. Partial, so a
-- resident with several completed bookings may still review each of them, and
-- a removed review does not block writing a replacement.
CREATE UNIQUE INDEX IF NOT EXISTS "AmenityReview_one_open_review_per_resident"
  ON "AmenityReview"("amenityId", "authorUserId")
  WHERE "bookingId" IS NULL AND "status" = 'published';
CREATE INDEX IF NOT EXISTS "AmenityReview_amenityId_status_createdAt_idx" ON "AmenityReview"("amenityId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "AmenityReview_amenityId_status_rating_idx" ON "AmenityReview"("amenityId", "status", "rating");
CREATE INDEX IF NOT EXISTS "AmenityReview_authorUserId_createdAt_idx" ON "AmenityReview"("authorUserId", "createdAt");

CREATE TABLE IF NOT EXISTS "AmenityReviewResponse" (
  "id" TEXT NOT NULL,
  "reviewId" TEXT NOT NULL,
  "responderUserId" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AmenityReviewResponse_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AmenityReviewResponse_reviewId_key" ON "AmenityReviewResponse"("reviewId");

-- ── Foreign keys ──────────────────────────────────────────────────────────
-- Written with a guard so a re-run on a partially applied database is safe.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Amenity_communityId_fkey') THEN
    ALTER TABLE "Amenity" ADD CONSTRAINT "Amenity_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Amenity_createdByUserId_fkey') THEN
    ALTER TABLE "Amenity" ADD CONSTRAINT "Amenity_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Amenity_coverMediaId_fkey') THEN
    ALTER TABLE "Amenity" ADD CONSTRAINT "Amenity_coverMediaId_fkey" FOREIGN KEY ("coverMediaId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MediaAsset_communityId_fkey') THEN
    ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MediaAsset_uploaderUserId_fkey') THEN
    ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_uploaderUserId_fkey" FOREIGN KEY ("uploaderUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MediaAsset_amenityId_fkey') THEN
    ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_amenityId_fkey" FOREIGN KEY ("amenityId") REFERENCES "Amenity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MediaAsset_reviewId_fkey') THEN
    ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "AmenityReview"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MediaAsset_issueId_fkey') THEN
    ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "AmenityIssue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AmenityResource_amenityId_fkey') THEN
    ALTER TABLE "AmenityResource" ADD CONSTRAINT "AmenityResource_amenityId_fkey" FOREIGN KEY ("amenityId") REFERENCES "Amenity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AmenityHours_amenityId_fkey') THEN
    ALTER TABLE "AmenityHours" ADD CONSTRAINT "AmenityHours_amenityId_fkey" FOREIGN KEY ("amenityId") REFERENCES "Amenity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AmenityClosure_amenityId_fkey') THEN
    ALTER TABLE "AmenityClosure" ADD CONSTRAINT "AmenityClosure_amenityId_fkey" FOREIGN KEY ("amenityId") REFERENCES "Amenity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AmenityClosure_createdByUserId_fkey') THEN
    ALTER TABLE "AmenityClosure" ADD CONSTRAINT "AmenityClosure_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AmenityBooking_communityId_fkey') THEN
    ALTER TABLE "AmenityBooking" ADD CONSTRAINT "AmenityBooking_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AmenityBooking_amenityId_fkey') THEN
    ALTER TABLE "AmenityBooking" ADD CONSTRAINT "AmenityBooking_amenityId_fkey" FOREIGN KEY ("amenityId") REFERENCES "Amenity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AmenityBooking_resourceId_fkey') THEN
    ALTER TABLE "AmenityBooking" ADD CONSTRAINT "AmenityBooking_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "AmenityResource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AmenityBooking_userId_fkey') THEN
    ALTER TABLE "AmenityBooking" ADD CONSTRAINT "AmenityBooking_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AmenityBooking_unitId_fkey') THEN
    ALTER TABLE "AmenityBooking" ADD CONSTRAINT "AmenityBooking_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "CommunityUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AmenityBooking_approvedByUserId_fkey') THEN
    ALTER TABLE "AmenityBooking" ADD CONSTRAINT "AmenityBooking_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AmenityBooking_cancelledByUserId_fkey') THEN
    ALTER TABLE "AmenityBooking" ADD CONSTRAINT "AmenityBooking_cancelledByUserId_fkey" FOREIGN KEY ("cancelledByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AmenityBookingEvent_bookingId_fkey') THEN
    ALTER TABLE "AmenityBookingEvent" ADD CONSTRAINT "AmenityBookingEvent_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "AmenityBooking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AmenityBookingEvent_actorUserId_fkey') THEN
    ALTER TABLE "AmenityBookingEvent" ADD CONSTRAINT "AmenityBookingEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AmenityIssue_communityId_fkey') THEN
    ALTER TABLE "AmenityIssue" ADD CONSTRAINT "AmenityIssue_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AmenityIssue_amenityId_fkey') THEN
    ALTER TABLE "AmenityIssue" ADD CONSTRAINT "AmenityIssue_amenityId_fkey" FOREIGN KEY ("amenityId") REFERENCES "Amenity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AmenityIssue_reporterUserId_fkey') THEN
    ALTER TABLE "AmenityIssue" ADD CONSTRAINT "AmenityIssue_reporterUserId_fkey" FOREIGN KEY ("reporterUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AmenityIssue_bookingId_fkey') THEN
    ALTER TABLE "AmenityIssue" ADD CONSTRAINT "AmenityIssue_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "AmenityBooking"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AmenityIssue_assignedToUserId_fkey') THEN
    ALTER TABLE "AmenityIssue" ADD CONSTRAINT "AmenityIssue_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AmenityIssueMessage_issueId_fkey') THEN
    ALTER TABLE "AmenityIssueMessage" ADD CONSTRAINT "AmenityIssueMessage_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "AmenityIssue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AmenityIssueMessage_authorUserId_fkey') THEN
    ALTER TABLE "AmenityIssueMessage" ADD CONSTRAINT "AmenityIssueMessage_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AmenityIssueEvent_issueId_fkey') THEN
    ALTER TABLE "AmenityIssueEvent" ADD CONSTRAINT "AmenityIssueEvent_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "AmenityIssue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AmenityIssueEvent_actorUserId_fkey') THEN
    ALTER TABLE "AmenityIssueEvent" ADD CONSTRAINT "AmenityIssueEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AmenityReview_communityId_fkey') THEN
    ALTER TABLE "AmenityReview" ADD CONSTRAINT "AmenityReview_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AmenityReview_amenityId_fkey') THEN
    ALTER TABLE "AmenityReview" ADD CONSTRAINT "AmenityReview_amenityId_fkey" FOREIGN KEY ("amenityId") REFERENCES "Amenity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AmenityReview_authorUserId_fkey') THEN
    ALTER TABLE "AmenityReview" ADD CONSTRAINT "AmenityReview_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AmenityReview_bookingId_fkey') THEN
    ALTER TABLE "AmenityReview" ADD CONSTRAINT "AmenityReview_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "AmenityBooking"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AmenityReview_moderatedByUserId_fkey') THEN
    ALTER TABLE "AmenityReview" ADD CONSTRAINT "AmenityReview_moderatedByUserId_fkey" FOREIGN KEY ("moderatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AmenityReviewResponse_reviewId_fkey') THEN
    ALTER TABLE "AmenityReviewResponse" ADD CONSTRAINT "AmenityReviewResponse_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "AmenityReview"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AmenityReviewResponse_responderUserId_fkey') THEN
    ALTER TABLE "AmenityReviewResponse" ADD CONSTRAINT "AmenityReviewResponse_responderUserId_fkey" FOREIGN KEY ("responderUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$$;

-- ── Tenant integrity triggers ─────────────────────────────────────────────
-- Two rules a foreign key alone cannot express. Both fail closed: an
-- application bug becomes a rejected write, not a cross-HOA data leak.

-- 1. Amenities exist only for official `hoa` communities.
CREATE OR REPLACE FUNCTION "amenity_requires_hoa"() RETURNS trigger AS $$
DECLARE
  community_type "CommunityType";
BEGIN
  SELECT "type" INTO community_type FROM "Community" WHERE "id" = NEW."communityId";
  IF community_type IS DISTINCT FROM 'hoa' THEN
    RAISE EXCEPTION 'Amenities exist only for official HOA communities (community % is %)',
      NEW."communityId", COALESCE(community_type::text, 'missing');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "amenity_requires_hoa_trigger" ON "Amenity";
CREATE TRIGGER "amenity_requires_hoa_trigger"
  BEFORE INSERT OR UPDATE OF "communityId" ON "Amenity"
  FOR EACH ROW EXECUTE FUNCTION "amenity_requires_hoa"();

-- 2. A booking's resource, community, and unit must all belong to the same
--    amenity/HOA, and a cover photo must come from that amenity's own gallery.
CREATE OR REPLACE FUNCTION "amenity_booking_consistency"() RETURNS trigger AS $$
DECLARE
  resource_amenity TEXT;
  amenity_community TEXT;
  unit_community TEXT;
BEGIN
  SELECT "amenityId" INTO resource_amenity FROM "AmenityResource" WHERE "id" = NEW."resourceId";
  IF resource_amenity IS DISTINCT FROM NEW."amenityId" THEN
    RAISE EXCEPTION 'Booking resource % does not belong to amenity %', NEW."resourceId", NEW."amenityId";
  END IF;

  SELECT "communityId" INTO amenity_community FROM "Amenity" WHERE "id" = NEW."amenityId";
  IF amenity_community IS DISTINCT FROM NEW."communityId" THEN
    RAISE EXCEPTION 'Booking community % does not match amenity community %', NEW."communityId", amenity_community;
  END IF;

  IF NEW."unitId" IS NOT NULL THEN
    SELECT "communityId" INTO unit_community FROM "CommunityUnit" WHERE "id" = NEW."unitId";
    IF unit_community IS DISTINCT FROM NEW."communityId" THEN
      RAISE EXCEPTION 'Booking unit % belongs to a different community', NEW."unitId";
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "amenity_booking_consistency_trigger" ON "AmenityBooking";
CREATE TRIGGER "amenity_booking_consistency_trigger"
  BEFORE INSERT OR UPDATE OF "amenityId", "resourceId", "communityId", "unitId" ON "AmenityBooking"
  FOR EACH ROW EXECUTE FUNCTION "amenity_booking_consistency"();

CREATE OR REPLACE FUNCTION "amenity_cover_belongs_to_amenity"() RETURNS trigger AS $$
DECLARE
  media_amenity TEXT;
BEGIN
  IF NEW."coverMediaId" IS NULL THEN RETURN NEW; END IF;
  SELECT "amenityId" INTO media_amenity FROM "MediaAsset" WHERE "id" = NEW."coverMediaId";
  IF media_amenity IS DISTINCT FROM NEW."id" THEN
    RAISE EXCEPTION 'Cover photo % is not in amenity %''s gallery', NEW."coverMediaId", NEW."id";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "amenity_cover_belongs_to_amenity_trigger" ON "Amenity";
CREATE TRIGGER "amenity_cover_belongs_to_amenity_trigger"
  BEFORE INSERT OR UPDATE OF "coverMediaId" ON "Amenity"
  FOR EACH ROW EXECUTE FUNCTION "amenity_cover_belongs_to_amenity"();
