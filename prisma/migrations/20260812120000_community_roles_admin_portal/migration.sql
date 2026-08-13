CREATE TYPE "CommunityType" AS ENUM ('hoa', 'neighborhood');

-- CreateEnum
CREATE TYPE "CommunityStatus" AS ENUM ('active', 'archived');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('pending', 'active', 'removed');

-- CreateEnum
CREATE TYPE "CommunityStaffRole" AS ENUM ('neighborhood_manager', 'hoa_manager', 'hoa_team');

-- CreateEnum
CREATE TYPE "StaffAssignmentStatus" AS ENUM ('active', 'revoked');

-- CreateEnum
CREATE TYPE "ProviderAccountStatus" AS ENUM ('pending', 'active', 'suspended');

-- CreateEnum
CREATE TYPE "AdminAuditAction" AS ENUM ('community_created', 'community_updated', 'community_archived', 'community_restored', 'member_added', 'member_status_changed', 'member_removed', 'staff_assigned', 'staff_revoked', 'provider_status_changed', 'provider_license_verified', 'provider_license_revoked', 'provider_insurance_verified', 'provider_insurance_revoked');

-- CreateEnum
CREATE TYPE "AdminAuditTargetType" AS ENUM ('community', 'membership', 'staff_assignment', 'provider');

-- AlterTable
ALTER TABLE "ProviderProfile" ADD COLUMN     "accountStatus" "ProviderAccountStatus" NOT NULL DEFAULT 'pending',
ADD COLUMN     "accountStatusNote" TEXT,
ADD COLUMN     "accountStatusUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "accountStatusUpdatedByUserId" TEXT,
ADD COLUMN     "insuranceVerifiedByUserId" TEXT,
ADD COLUMN     "licenseVerifiedByUserId" TEXT;

-- CreateTable
CREATE TABLE "Community" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "CommunityType" NOT NULL,
    "status" "CommunityStatus" NOT NULL DEFAULT 'active',
    "centerLatitude" DOUBLE PRECISION,
    "centerLongitude" DOUBLE PRECISION,
    "radiusMiles" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Community_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityMembership" (
    "id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'pending',
    "joinedAt" TIMESTAMP(3),
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "isAdminOverride" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunityMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityStaffAssignment" (
    "id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "CommunityStaffRole" NOT NULL,
    "status" "StaffAssignmentStatus" NOT NULL DEFAULT 'active',
    "assignedByUserId" TEXT,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedByUserId" TEXT,

    CONSTRAINT "CommunityStaffAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderCommunityApproval" (
    "id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "providerUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT,

    CONSTRAINT "ProviderCommunityApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminAuditLog" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" "AdminAuditAction" NOT NULL,
    "targetType" "AdminAuditTargetType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "communityId" TEXT,
    "providerUserId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Community_type_status_idx" ON "Community"("type", "status");

-- CreateIndex
CREATE INDEX "Community_status_name_idx" ON "Community"("status", "name");

-- CreateIndex
CREATE INDEX "CommunityMembership_userId_status_idx" ON "CommunityMembership"("userId", "status");

-- CreateIndex
CREATE INDEX "CommunityMembership_communityId_status_idx" ON "CommunityMembership"("communityId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CommunityMembership_communityId_userId_key" ON "CommunityMembership"("communityId", "userId");

-- CreateIndex
CREATE INDEX "CommunityStaffAssignment_userId_status_idx" ON "CommunityStaffAssignment"("userId", "status");

-- CreateIndex
CREATE INDEX "CommunityStaffAssignment_communityId_status_idx" ON "CommunityStaffAssignment"("communityId", "status");

-- CreateIndex
CREATE INDEX "ProviderCommunityApproval_providerUserId_idx" ON "ProviderCommunityApproval"("providerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderCommunityApproval_communityId_providerUserId_key" ON "ProviderCommunityApproval"("communityId", "providerUserId");

-- CreateIndex
CREATE INDEX "AdminAuditLog_createdAt_idx" ON "AdminAuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AdminAuditLog_communityId_createdAt_idx" ON "AdminAuditLog"("communityId", "createdAt");

-- CreateIndex
CREATE INDEX "AdminAuditLog_providerUserId_createdAt_idx" ON "AdminAuditLog"("providerUserId", "createdAt");

-- CreateIndex
CREATE INDEX "AdminAuditLog_actorUserId_createdAt_idx" ON "AdminAuditLog"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "ProviderProfile_accountStatus_idx" ON "ProviderProfile"("accountStatus");

-- AddForeignKey
ALTER TABLE "CommunityMembership" ADD CONSTRAINT "CommunityMembership_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityMembership" ADD CONSTRAINT "CommunityMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityStaffAssignment" ADD CONSTRAINT "CommunityStaffAssignment_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityStaffAssignment" ADD CONSTRAINT "CommunityStaffAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityStaffAssignment" ADD CONSTRAINT "CommunityStaffAssignment_assignedByUserId_fkey" FOREIGN KEY ("assignedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderCommunityApproval" ADD CONSTRAINT "ProviderCommunityApproval_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderCommunityApproval" ADD CONSTRAINT "ProviderCommunityApproval_providerUserId_fkey" FOREIGN KEY ("providerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminAuditLog" ADD CONSTRAINT "AdminAuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminAuditLog" ADD CONSTRAINT "AdminAuditLog_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ─────────────────────────────────────────────────────────────────────────────
-- Constraints Prisma's schema language cannot express.
--
-- Everything below is also validated in the service layer, which is where the
-- useful error message comes from. These exist so a bug, a manual query, or a
-- race between two concurrent admins cannot leave the data in a state the
-- product says is impossible.
-- ─────────────────────────────────────────────────────────────────────────────

-- A location-based neighborhood is defined by its geometry, so it must have
-- one. An HOA is defined by the association itself and may have none.
ALTER TABLE "Community"
  ADD CONSTRAINT "Community_neighborhood_geometry_check"
  CHECK (
    "type" <> 'neighborhood'
    OR (
      "centerLatitude" IS NOT NULL
      AND "centerLongitude" IS NOT NULL
      AND "radiusMiles" IS NOT NULL
    )
  );

-- Coordinates and radius must be real values wherever they are present.
ALTER TABLE "Community"
  ADD CONSTRAINT "Community_center_bounds_check"
  CHECK (
    ("centerLatitude" IS NULL OR ("centerLatitude" >= -90 AND "centerLatitude" <= 90))
    AND ("centerLongitude" IS NULL OR ("centerLongitude" >= -180 AND "centerLongitude" <= 180))
    AND ("radiusMiles" IS NULL OR ("radiusMiles" > 0 AND "radiusMiles" <= 100))
  );

-- A staff role only makes sense for one kind of community. Postgres cannot
-- reach across to "Community"."type" in a CHECK, so this is enforced in
-- `assertStaffRoleMatchesCommunity` and covered by unit tests instead.

-- At most one *active* assignment of the same role to the same person in the
-- same community. Revoked history is unlimited, so a plain unique index would
-- be wrong.
CREATE UNIQUE INDEX "CommunityStaffAssignment_active_role_key"
  ON "CommunityStaffAssignment" ("communityId", "userId", "role")
  WHERE "status" = 'active';

-- A neighborhood has at most one manager. This is the constraint that makes
-- the "atomically replace the previous manager" flow safe: two admins racing
-- to appoint different managers cannot both win.
CREATE UNIQUE INDEX "CommunityStaffAssignment_one_active_neighborhood_manager"
  ON "CommunityStaffAssignment" ("communityId")
  WHERE "status" = 'active' AND "role" = 'neighborhood_manager';

-- An HOA likewise has a single active manager; `hoa_team` remains many-to-one.
CREATE UNIQUE INDEX "CommunityStaffAssignment_one_active_hoa_manager"
  ON "CommunityStaffAssignment" ("communityId")
  WHERE "status" = 'active' AND "role" = 'hoa_manager';

-- A revoked assignment must say when it was revoked, and an active one must
-- not claim to have been.
ALTER TABLE "CommunityStaffAssignment"
  ADD CONSTRAINT "CommunityStaffAssignment_revoked_at_check"
  CHECK (
    ("status" = 'revoked' AND "revokedAt" IS NOT NULL)
    OR ("status" <> 'revoked' AND "revokedAt" IS NULL)
  );

-- Cross-table role checks cannot be expressed as a CHECK constraint. Locking
-- the resident row closes the race between assigning a neighborhood manager
-- and removing that resident in a concurrent transaction.
CREATE OR REPLACE FUNCTION "bundleen_validate_active_staff_assignment"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  community_type TEXT;
  account_role TEXT;
  resident_status TEXT;
BEGIN
  IF NEW."status" <> 'active' THEN
    RETURN NEW;
  END IF;

  SELECT "type"::text INTO community_type
  FROM "Community"
  WHERE "id" = NEW."communityId";

  SELECT "role"::text INTO account_role
  FROM "User"
  WHERE "id" = NEW."userId";

  IF account_role IS DISTINCT FROM 'homeowner' THEN
    RAISE EXCEPTION 'community staff must be a homeowner'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW."role" = 'neighborhood_manager' THEN
    IF community_type IS DISTINCT FROM 'neighborhood' THEN
      RAISE EXCEPTION 'neighborhood manager requires a neighborhood community'
        USING ERRCODE = 'check_violation';
    END IF;

    SELECT "status"::text INTO resident_status
    FROM "CommunityMembership"
    WHERE "communityId" = NEW."communityId" AND "userId" = NEW."userId"
    FOR UPDATE;

    IF resident_status IS DISTINCT FROM 'active' THEN
      RAISE EXCEPTION 'neighborhood manager must be an active resident'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW."role" IN ('hoa_manager', 'hoa_team')
    AND community_type IS DISTINCT FROM 'hoa' THEN
    RAISE EXCEPTION 'HOA role requires an HOA community'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "CommunityStaffAssignment_validate_active"
  BEFORE INSERT OR UPDATE OF "communityId", "userId", "role", "status"
  ON "CommunityStaffAssignment"
  FOR EACH ROW
  EXECUTE FUNCTION "bundleen_validate_active_staff_assignment"();

CREATE OR REPLACE FUNCTION "bundleen_protect_manager_membership"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  active_manager_exists BOOLEAN;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."status" = 'active' THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM "CommunityStaffAssignment"
    WHERE "communityId" = OLD."communityId"
      AND "userId" = OLD."userId"
      AND "role" = 'neighborhood_manager'
      AND "status" = 'active'
  ) INTO active_manager_exists;

  IF active_manager_exists THEN
    RAISE EXCEPTION 'active neighborhood manager membership must be revoked atomically'
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "CommunityMembership_protect_manager"
  BEFORE UPDATE OF "status" OR DELETE ON "CommunityMembership"
  FOR EACH ROW
  EXECUTE FUNCTION "bundleen_protect_manager_membership"();

-- ─────────────────────────────────────────────────────────────────────────────
-- Audit log immutability.
--
-- The application never issues an UPDATE or DELETE against this table; the
-- trigger is what makes that a guarantee rather than a convention, including
-- for anyone holding a database console. Tests reset rows with DELETE before
-- this migration is applied rather than weakening the production invariant.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION "bundleen_admin_audit_log_is_append_only"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'AdminAuditLog is append-only: % is not permitted', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER "AdminAuditLog_append_only"
  BEFORE UPDATE OR DELETE ON "AdminAuditLog"
  FOR EACH ROW
  EXECUTE FUNCTION "bundleen_admin_audit_log_is_append_only"();

CREATE TRIGGER "AdminAuditLog_no_truncate"
  BEFORE TRUNCATE ON "AdminAuditLog"
  FOR EACH STATEMENT
  EXECUTE FUNCTION "bundleen_admin_audit_log_is_append_only"();

-- ─────────────────────────────────────────────────────────────────────────────
-- Backfill.
--
-- No community memberships are invented: there is no community to match
-- against yet, and guessing residency from an address would create exactly the
-- fake data this task is removing. Bundleen staff create the first communities
-- in the admin portal, after which the radius matcher can place homeowners.
-- ─────────────────────────────────────────────────────────────────────────────

-- Every existing provider defaults to `pending` from the column default. A
-- provider whose license *and* insurance were already verified by staff has
-- trusted data on file, so they keep working rather than being locked out by
-- the introduction of this column.
UPDATE "ProviderProfile"
SET "accountStatus" = 'active',
    "accountStatusUpdatedAt" = CURRENT_TIMESTAMP,
    "accountStatusNote" = 'Backfilled: license and insurance were already staff-verified.'
WHERE "licenseVerifiedAt" IS NOT NULL
  AND "insuranceVerifiedAt" IS NOT NULL;
