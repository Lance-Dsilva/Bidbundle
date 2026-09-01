-- Standalone HOA staff and Bundleen admin identities are created through
-- email-bound Clerk invitations. Pending rows carry a display name so the
-- operations portal can identify the person before their User row exists.

ALTER TYPE "CommunityInvitationRole" ADD VALUE IF NOT EXISTS 'hoa_team';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'hoa_staff';

ALTER TABLE "CommunityInvitation"
  ADD COLUMN IF NOT EXISTS "inviteeName" TEXT;

ALTER TABLE "AdminAccessGrant"
  ADD COLUMN IF NOT EXISTS "inviteeName" TEXT,
  ADD COLUMN IF NOT EXISTS "invitationExpiresAt" TIMESTAMP(3);

ALTER TABLE "CommunityInvitation"
  DROP CONSTRAINT IF EXISTS "CommunityInvitation_invitee_name_check";
ALTER TABLE "CommunityInvitation"
  ADD CONSTRAINT "CommunityInvitation_invitee_name_check"
  CHECK (
    "inviteeName" IS NULL
    OR (char_length(btrim("inviteeName")) BETWEEN 1 AND 120)
  );

ALTER TABLE "AdminAccessGrant"
  DROP CONSTRAINT IF EXISTS "AdminAccessGrant_invitee_name_check";
ALTER TABLE "AdminAccessGrant"
  ADD CONSTRAINT "AdminAccessGrant_invitee_name_check"
  CHECK (
    "inviteeName" IS NULL
    OR (char_length(btrim("inviteeName")) BETWEEN 1 AND 120)
  );

-- Both HOA manager and team invitations create staff-only identities and must
-- never be attached to a resident unit. Homeowner invitations remain bound to
-- one unit exactly as before.
CREATE OR REPLACE FUNCTION "bundleen_validate_invitation_unit"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."role"::text = 'homeowner' AND NEW."status" = 'pending' THEN
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
  IF NEW."role"::text IN ('hoa_manager', 'hoa_team') AND NEW."unitId" IS NOT NULL THEN
    RAISE EXCEPTION 'a staff invitation must not reference a unit'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'CommunityInvitation_staff_no_unit';
  END IF;
  RETURN NEW;
END;
$$;
