-- The later creator/participation migration replaced the earlier enrollment
-- validator. Preserve its parent/authority locks and identity-move safeguards,
-- restore the enrollment boundary after those locks, and retain the constraint
-- detail consumed by the Prisma adapter's enrollment-conflict mapping.
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
  enrollment_closes_at TIMESTAMP(3);
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

  SELECT "communityId", "kind", "status", "participantsLockedAt", "enrollmentClosesAt"
    INTO target_community, request_kind, request_state, locked_at, enrollment_closes_at
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
      USING ERRCODE = 'check_violation', CONSTRAINT = 'HoaRequestParticipation_locked',
          DETAIL = 'HoaRequestParticipation_locked';
  END IF;

  IF previous_request IS NOT NULL AND previous_request IS DISTINCT FROM NEW."requestId"
     AND EXISTS (
       SELECT 1 FROM "HoaServiceRequest" r JOIN "Community" c ON c."id" = r."communityId"
       WHERE r."id" = previous_request AND c."type" = 'neighborhood'
         AND (r."participantsLockedAt" IS NOT NULL OR r."status" <> 'collecting_interest')
     ) THEN
    RAISE EXCEPTION 'participants are locked for the previous neighborhood request'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'HoaRequestParticipation_locked',
          DETAIL = 'HoaRequestParticipation_locked';
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
        USING ERRCODE = 'check_violation', CONSTRAINT = 'HoaRequestParticipation_enrollment_open_required',
          DETAIL = 'HoaRequestParticipation_enrollment_open_required';
    END IF;
    IF locked_at IS NOT NULL THEN
      RAISE EXCEPTION 'participants are locked for this request'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'HoaRequestParticipation_locked',
          DETAIL = 'HoaRequestParticipation_locked';
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

    -- Authority reads above may wait for concurrent community, resident or
    -- membership changes. Recheck wall-clock time only after every lock is held;
    -- a pre-wait statement/transaction timestamp could admit a late response.
    IF enrollment_closes_at IS NOT NULL
       AND enrollment_closes_at <= (clock_timestamp() AT TIME ZONE 'UTC') THEN
      RAISE EXCEPTION 'neighborhood enrollment has closed'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'HoaRequestParticipation_enrollment_open_required',
          DETAIL = 'HoaRequestParticipation_enrollment_open_required';
    END IF;

  ELSIF request_kind = 'optional_group' THEN
    -- Original HOA resident/unit membership rule, deliberately unchanged.
    IF request_state IS DISTINCT FROM 'collecting_interest' THEN
      RAISE EXCEPTION 'optional requests accept responses only while collecting interest'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'HoaRequestParticipation_enrollment_open_required',
          DETAIL = 'HoaRequestParticipation_enrollment_open_required';
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
