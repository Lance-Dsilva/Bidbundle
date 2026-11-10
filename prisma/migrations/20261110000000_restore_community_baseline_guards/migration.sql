-- Restore five baseline objects absent from the testing database's catalog.
-- Do not edit historical migration checksums, replay their data backfills, or
-- rewrite application rows. This also runs safely on an intact main schema.
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

-- Freeze the facts checked below until all guards are installed. Reads remain
-- available; a busy writer makes this bounded repair fail rather than race it.
LOCK TABLE public."Community", public."User", public."CommunityStaffAssignment",
  public."CommunityMembership", public."AdminAuditLog"
  IN SHARE ROW EXCLUSIVE MODE;

-- Triggers do not validate old rows when they are created. Refuse an invalid
-- existing assignment using the effective main rules (including HOA staff
-- identity from 20260830171000), without silently repairing resident/staff data.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public."CommunityStaffAssignment" s
    LEFT JOIN public."Community" c ON c."id" = s."communityId"
    LEFT JOIN public."User" u ON u."id" = s."userId"
    LEFT JOIN public."CommunityMembership" m
      ON m."communityId" = s."communityId" AND m."userId" = s."userId"
    WHERE s."status" = 'active'
      AND (
        (s."role" = 'neighborhood_manager' AND (
          u."role"::text IS DISTINCT FROM 'homeowner'
          OR c."type"::text IS DISTINCT FROM 'neighborhood'
          OR m."status"::text IS DISTINCT FROM 'active'
        ))
        OR (s."role" IN ('hoa_manager', 'hoa_team') AND (
          u."role"::text IS DISTINCT FROM 'hoa_staff'
          OR c."type"::text IS DISTINCT FROM 'hoa'
        ))
      )
  ) THEN
    RAISE EXCEPTION 'Existing active community staff assignments violate baseline role, community, or residency guards'
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

-- Duplicate active HOA managers fail index validation; never pick a winner or
-- revoke assignments as part of schema repair.
CREATE UNIQUE INDEX IF NOT EXISTS "CommunityStaffAssignment_one_active_hoa_manager"
  ON public."CommunityStaffAssignment" ("communityId")
  WHERE "status" = 'active' AND "role" = 'hoa_manager';

-- Exact baseline function body. The staff-validation and append-only routines
-- already match main, so their implementations are deliberately left intact.
CREATE OR REPLACE FUNCTION public."bundleen_protect_manager_membership"()
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

CREATE OR REPLACE TRIGGER "CommunityStaffAssignment_validate_active"
  BEFORE INSERT OR UPDATE OF "communityId", "userId", "role", "status"
  ON public."CommunityStaffAssignment"
  FOR EACH ROW
  EXECUTE FUNCTION public."bundleen_validate_active_staff_assignment"();

CREATE OR REPLACE TRIGGER "CommunityMembership_protect_manager"
  BEFORE UPDATE OF "status" OR DELETE ON public."CommunityMembership"
  FOR EACH ROW
  EXECUTE FUNCTION public."bundleen_protect_manager_membership"();

CREATE OR REPLACE TRIGGER "AdminAuditLog_no_truncate"
  BEFORE TRUNCATE ON public."AdminAuditLog"
  FOR EACH STATEMENT
  EXECUTE FUNCTION public."bundleen_admin_audit_log_is_append_only"();

COMMIT;
