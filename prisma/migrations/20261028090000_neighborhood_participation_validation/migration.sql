-- Neighborhood homes are identified by their resident, while HOA homes use
-- CommunityUnit. Keep HOA and compulsory safeguards and make optional
-- neighborhood enrollment match the community membership model.
CREATE OR REPLACE FUNCTION "bundleen_validate_hoa_request_participation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_community TEXT;
  request_kind "HoaRequestKind";
  request_state "HoaRequestStatus";
  locked_at TIMESTAMP(3);
  enrollment_closes_at TIMESTAMP(3);
  community_type "CommunityType";
  community_state "CommunityStatus";
BEGIN
  -- Lock the same parent row used by enrollment transitions before validating
  -- child writes, including direct SQL callers that do not use the server helper.
  SELECT request."communityId", request."kind", request."status",
         request."participantsLockedAt", request."enrollmentClosesAt",
         community."type", community."status"
    INTO target_community, request_kind, request_state, locked_at,
         enrollment_closes_at, community_type, community_state
  FROM "HoaServiceRequest" request
  JOIN "Community" community ON community."id" = request."communityId"
  WHERE request."id" = NEW."requestId"
  FOR UPDATE OF request;

  IF locked_at IS NOT NULL AND TG_OP = 'UPDATE'
     AND NEW."response" IS DISTINCT FROM OLD."response" THEN
    RAISE EXCEPTION 'participants are locked for this request'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'HoaRequestParticipation_locked',
          DETAIL = 'HoaRequestParticipation_locked';
  END IF;

  IF request_kind = 'optional_group' THEN
    IF request_state IS DISTINCT FROM 'collecting_interest' THEN
      RAISE EXCEPTION 'optional requests accept responses only while collecting interest'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'HoaRequestParticipation_enrollment_open_required',
          DETAIL = 'HoaRequestParticipation_enrollment_open_required';
    END IF;
    IF community_type = 'neighborhood' THEN
      IF locked_at IS NOT NULL THEN
        RAISE EXCEPTION 'participants are locked for this request'
          USING ERRCODE = 'check_violation', CONSTRAINT = 'HoaRequestParticipation_locked',
          DETAIL = 'HoaRequestParticipation_locked';
      END IF;
      IF enrollment_closes_at IS NOT NULL AND enrollment_closes_at <= clock_timestamp() THEN
        RAISE EXCEPTION 'neighborhood enrollment has closed'
          USING ERRCODE = 'check_violation', CONSTRAINT = 'HoaRequestParticipation_enrollment_open_required',
          DETAIL = 'HoaRequestParticipation_enrollment_open_required';
      END IF;
      IF NEW."userId" IS NULL OR NEW."unitId" IS NOT NULL THEN
        RAISE EXCEPTION 'neighborhood participation needs a resident without an HOA unit'
          USING ERRCODE = 'check_violation', CONSTRAINT = 'HoaRequestParticipation_neighborhood_resident_required';
      END IF;
      IF community_state IS DISTINCT FROM 'active' OR NOT EXISTS (
        SELECT 1 FROM "CommunityMembership" membership
        JOIN "User" resident ON resident."id" = membership."userId"
        WHERE membership."communityId" = target_community
          AND membership."userId" = NEW."userId"
          AND membership."unitId" IS NULL
          AND membership."status" = 'active'
          AND resident."role" = 'homeowner'
      ) THEN
        RAISE EXCEPTION 'request participation requires active membership of this neighborhood'
          USING ERRCODE = 'check_violation', CONSTRAINT = 'HoaRequestParticipation_active_member_required';
      END IF;
    ELSE
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
