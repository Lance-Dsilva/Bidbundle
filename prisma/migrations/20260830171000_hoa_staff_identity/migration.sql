-- HOA operations identities are staff, not residents. Keep authorization in
-- the community-scoped assignment while preventing these accounts from
-- passing ordinary homeowner guards.

UPDATE "User" u
SET "role" = 'hoa_staff'::"UserRole", "updatedAt" = CURRENT_TIMESTAMP
WHERE u."role" = 'homeowner'::"UserRole"
  AND EXISTS (
    SELECT 1
    FROM "CommunityStaffAssignment" s
    WHERE s."userId" = u."id"
      AND s."role" IN ('hoa_manager', 'hoa_team')
      AND s."status" = 'active'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "CommunityMembership" m
    WHERE m."userId" = u."id"
      AND m."status" IN ('active', 'pending')
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "CommunityStaffAssignment" s
    WHERE s."userId" = u."id"
      AND s."role" = 'neighborhood_manager'
      AND s."status" = 'active'
  );

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

  IF NEW."role" = 'neighborhood_manager' THEN
    IF account_role IS DISTINCT FROM 'homeowner' THEN
      RAISE EXCEPTION 'neighborhood manager must be a homeowner'
        USING ERRCODE = 'check_violation';
    END IF;
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
  ELSIF NEW."role" IN ('hoa_manager', 'hoa_team') THEN
    IF account_role IS DISTINCT FROM 'hoa_staff' THEN
      RAISE EXCEPTION 'HOA staff assignment requires an HOA staff identity'
        USING ERRCODE = 'check_violation';
    END IF;
    IF community_type IS DISTINCT FROM 'hoa' THEN
      RAISE EXCEPTION 'HOA role requires an HOA community'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
