-- The original HOA content validator is shared by requests and surveys. Keep
-- it, and the survey trigger, intact. Requests also belong to neighborhood
-- homeowners; a request-specific guard expresses that existing domain rule.
CREATE FUNCTION "bundleen_validate_service_request_creator"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  community_type TEXT;
BEGIN
  SELECT "type"::text INTO community_type
  FROM "Community"
  WHERE "id" = NEW."communityId" AND "status" = 'active'
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Service requests require an active community'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'HoaServiceRequest_active_community_required';
  END IF;

  IF community_type = 'hoa' THEN
    -- Preserve the original HOA manager guard exactly, including assignments
    -- grandfathered by the later HOA staff identity migration. Team members
    -- are not promoted to creators by this migration.
    PERFORM 1 FROM "CommunityStaffAssignment"
    WHERE "communityId" = NEW."communityId"
      AND "userId" = NEW."createdByUserId"
      AND "role" = 'hoa_manager'
      AND "status" = 'active'
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'HOA content creator is not the active HOA manager'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'HoaContent_manager_required';
    END IF;
  ELSIF community_type = 'neighborhood' THEN
    IF NEW."kind" IS DISTINCT FROM 'optional_group' THEN
      RAISE EXCEPTION 'Homeowner neighborhood requests must be optional group services'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'HoaServiceRequest_neighborhood_kind';
    END IF;
    PERFORM 1 FROM "User"
    WHERE "id" = NEW."createdByUserId" AND "role" = 'homeowner'
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Neighborhood request creators must be homeowners'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'HoaServiceRequest_homeowner_creator_required';
    END IF;
    PERFORM 1 FROM "CommunityMembership"
    WHERE "communityId" = NEW."communityId"
      AND "userId" = NEW."createdByUserId"
      AND "status" = 'active'
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Neighborhood request creators must be active residents'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'HoaServiceRequest_active_creator_required';
    END IF;
  ELSE
    RAISE EXCEPTION 'Service requests require an HOA or neighborhood community'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'HoaServiceRequest_community_type';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER "HoaServiceRequest_validate_creator" ON "HoaServiceRequest";
CREATE TRIGGER "HoaServiceRequest_validate_creator"
  BEFORE INSERT OR UPDATE OF "communityId", "createdByUserId", "kind"
  ON "HoaServiceRequest"
  FOR EACH ROW EXECUTE FUNCTION "bundleen_validate_service_request_creator"();

-- Optional neighborhood participation is a homeowner, not an HOA unit. Keep
-- the HOA optional/compulsory rules intact while giving each context its own
-- target validation. Never disable the trigger or synthesize an HOA unit.
CREATE OR REPLACE FUNCTION "bundleen_validate_hoa_request_participation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_community TEXT;
  community_type TEXT;
  community_status TEXT;
  request_kind "HoaRequestKind";
  request_state "HoaRequestStatus";
  locked_at TIMESTAMP(3);
  previous_request TEXT;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    previous_request := OLD."requestId";
  END IF;

  -- Lock both parents in deterministic order for the uncommon identity move.
  -- A concurrent cancel/open must finish before these child-state checks, or
  -- wait until participation and its parent snapshot stamp commit together.
  PERFORM 1 FROM "HoaServiceRequest"
  WHERE "id" IN (NEW."requestId", previous_request)
  ORDER BY "id"
  FOR UPDATE;

  SELECT "communityId", "kind", "status", "participantsLockedAt"
    INTO target_community, request_kind, request_state, locked_at
  FROM "HoaServiceRequest" WHERE "id" = NEW."requestId";
  IF NOT FOUND THEN
    -- Let the unchanged request foreign key report a missing parent.
    RETURN NEW;
  END IF;

  SELECT "type"::text, "status"::text INTO community_type, community_status
  FROM "Community" WHERE "id" = target_community
  FOR SHARE;

  IF locked_at IS NOT NULL AND TG_OP = 'UPDATE'
     AND NEW."response" IS DISTINCT FROM OLD."response" THEN
    RAISE EXCEPTION 'participants are locked for this request'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'HoaRequestParticipation_locked';
  END IF;

  IF previous_request IS NOT NULL AND previous_request IS DISTINCT FROM NEW."requestId"
     AND EXISTS (
       SELECT 1 FROM "HoaServiceRequest" r JOIN "Community" c ON c."id" = r."communityId"
       WHERE r."id" = previous_request AND c."type" = 'neighborhood'
         AND (r."participantsLockedAt" IS NOT NULL OR r."status" <> 'collecting_interest')
     ) THEN
    RAISE EXCEPTION 'participants are locked for the previous neighborhood request'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'HoaRequestParticipation_locked';
  END IF;


  IF community_type = 'neighborhood' THEN
    IF community_status IS DISTINCT FROM 'active' THEN
      RAISE EXCEPTION 'neighborhood participation requires an active community'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'HoaRequestParticipation_active_neighborhood_required';
    END IF;
    IF request_kind IS DISTINCT FROM 'optional_group' THEN
      RAISE EXCEPTION 'neighborhood participation requires an optional group request'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'HoaRequestParticipation_neighborhood_kind';
    END IF;
    IF request_state IS DISTINCT FROM 'collecting_interest' THEN
      RAISE EXCEPTION 'optional requests accept responses only while collecting interest'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'HoaRequestParticipation_enrollment_open_required';
    END IF;
    IF locked_at IS NOT NULL THEN
      RAISE EXCEPTION 'participants are locked for this request'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'HoaRequestParticipation_locked';
    END IF;
    IF NEW."userId" IS NULL OR NEW."unitId" IS NOT NULL THEN
      RAISE EXCEPTION 'neighborhood participation needs a homeowner without an HOA unit'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'HoaRequestParticipation_neighborhood_user_required';
    END IF;
    PERFORM 1 FROM "User"
    WHERE "id" = NEW."userId" AND "role" = 'homeowner'
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'neighborhood participants must be homeowners'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'HoaRequestParticipation_homeowner_required';
    END IF;
    PERFORM 1 FROM "CommunityMembership"
    WHERE "communityId" = target_community
      AND "userId" = NEW."userId"
      AND "status" = 'active'
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'request participation requires active neighborhood membership'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'HoaRequestParticipation_active_member_required';
    END IF;

  ELSIF request_kind = 'optional_group' THEN
    -- Original HOA resident/unit membership rule, deliberately unchanged.
    IF request_state IS DISTINCT FROM 'collecting_interest' THEN
      RAISE EXCEPTION 'optional requests accept responses only while collecting interest'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'HoaRequestParticipation_enrollment_open_required';
    END IF;
    IF NEW."userId" IS NULL OR NEW."unitId" IS NULL THEN
      RAISE EXCEPTION 'optional participation needs the resident and their unit'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'HoaRequestParticipation_resident_unit_required';
    END IF;
    -- Match the authority lock order: Community -> User -> Membership.
    PERFORM 1 FROM "User" WHERE "id" = NEW."userId" FOR SHARE;
    PERFORM 1 FROM "CommunityMembership"
    WHERE "communityId" = target_community
      AND "userId" = NEW."userId"
      AND "unitId" = NEW."unitId"
      AND "status" = 'active'
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'request participation requires active HOA membership of that unit'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'HoaRequestParticipation_active_member_required';
    END IF;
  ELSE
    -- Original compulsory unit-snapshot rules, deliberately unchanged.
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


-- An AFTER trigger stamps only rows that were actually inserted/changed:
-- INSERT ... ON CONFLICT DO NOTHING and no-op UPDATE must not manufacture a
-- new scope version. The BEFORE validator holds the parent lock throughout.
CREATE FUNCTION "bundleen_stamp_neighborhood_participation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  previous_request TEXT;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW."requestId" IS NOT DISTINCT FROM OLD."requestId"
       AND NEW."userId" IS NOT DISTINCT FROM OLD."userId"
       AND NEW."unitId" IS NOT DISTINCT FROM OLD."unitId"
       AND NEW."response" IS NOT DISTINCT FROM OLD."response" THEN
      RETURN NEW;
    END IF;
    previous_request := OLD."requestId";
  END IF;

  -- HOA parent stamps/snapshot semantics remain unchanged. On an identity
  -- move, both affected neighborhood home counts invalidate old claims.
  UPDATE "HoaServiceRequest" r
  SET "updatedAt" = GREATEST(clock_timestamp() AT TIME ZONE 'UTC', r."updatedAt" + INTERVAL '1 millisecond')
  FROM "Community" c
  WHERE r."id" IN (NEW."requestId", previous_request)
    AND c."id" = r."communityId" AND c."type" = 'neighborhood';
  RETURN NEW;
END;
$$;

CREATE TRIGGER "HoaRequestParticipation_stamp_neighborhood"
  AFTER INSERT OR UPDATE OF "requestId", "userId", "unitId", "response"
  ON "HoaRequestParticipation"
  FOR EACH ROW EXECUTE FUNCTION "bundleen_stamp_neighborhood_participation"();
