-- Prepared lifecycle actions retain the authority that was verified before
-- notification planning. Call this only inside the parent-claim transaction.
CREATE FUNCTION "bundleen_assert_request_manager"(actor_id TEXT, request_id TEXT, authority_via TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  target_community TEXT;
  community_type TEXT;
  community_status TEXT;
  actor_email TEXT;
BEGIN
  SELECT r."communityId", c."type"::text, c."status"::text
  INTO target_community, community_type, community_status
  FROM "HoaServiceRequest" r JOIN "Community" c ON c."id" = r."communityId"
  WHERE r."id" = request_id
  FOR SHARE OF c;

  IF authority_via = 'admin_recovery' THEN
    -- Match the existing recovery rule, including archived communities.
    SELECT "email" INTO actor_email FROM "User"
    WHERE "id" = actor_id AND "role" = 'admin' FOR SHARE;
    IF FOUND THEN
      PERFORM 1 FROM "AdminAccessGrant"
      WHERE "email" = actor_email AND "status" = 'active' FOR SHARE;
      IF FOUND THEN RETURN; END IF;
    END IF;
  ELSIF community_status = 'active' THEN
    -- Preserve grandfathered HOA identities: the active scoped assignment is
    -- the authority, not an additional global role restriction.
    PERFORM 1 FROM "User" WHERE "id" = actor_id FOR SHARE;
    IF authority_via IN ('hoa_manager', 'hoa_team') AND community_type = 'hoa' THEN
      PERFORM 1 FROM "CommunityStaffAssignment"
      WHERE "communityId" = target_community AND "userId" = actor_id
        AND "role"::text = authority_via AND "status" = 'active' FOR SHARE;
      IF FOUND THEN RETURN; END IF;
    ELSIF authority_via = 'neighborhood_manager' AND community_type = 'neighborhood' THEN
      PERFORM 1 FROM "CommunityMembership"
      WHERE "communityId" = target_community AND "userId" = actor_id AND "status" = 'active' FOR SHARE;
      IF FOUND THEN
        PERFORM 1 FROM "CommunityStaffAssignment"
        WHERE "communityId" = target_community AND "userId" = actor_id
          AND "role" = 'neighborhood_manager' AND "status" = 'active' FOR SHARE;
        IF FOUND THEN RETURN; END IF;
      END IF;
    END IF;
  END IF;
  RAISE EXCEPTION 'Prepared request management authority changed'
    USING ERRCODE = 'P1703', CONSTRAINT = 'ServiceRequest_prepared_manager_required';
END;
$$;

-- The application takes this same parent lock BEFORE touching existing child
-- rows. The database guard also protects first inserts and validates the state
-- after any wait. It never permits a late provider write under an award.
CREATE FUNCTION "bundleen_validate_service_bid_mutation"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  request_state "HoaRequestStatus";
  closes_at TIMESTAMP(3);
  target_community TEXT;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(NEW) - 'updatedAt') IS NOT DISTINCT FROM (to_jsonb(OLD) - 'updatedAt') THEN
      RETURN NEW;
    END IF;
    IF NEW."requestId" IS DISTINCT FROM OLD."requestId"
       OR NEW."providerUserId" IS DISTINCT FROM OLD."providerUserId" THEN
      RAISE EXCEPTION 'Bid identity cannot change'
        USING ERRCODE = 'P1701', CONSTRAINT = 'ServiceBid_identity_immutable';
    END IF;
  END IF;

  SELECT "status", "biddingClosesAt", "communityId"
  INTO request_state, closes_at, target_community
  FROM "HoaServiceRequest" WHERE "id" = NEW."requestId" FOR UPDATE;

  IF NEW."status" IN ('draft', 'submitted', 'withdrawn') THEN
    IF request_state IS DISTINCT FROM 'open_for_bids'
       OR (closes_at IS NOT NULL AND closes_at <= (clock_timestamp() AT TIME ZONE 'UTC')) THEN
      RAISE EXCEPTION 'Bid mutation requires an open bidding window'
        USING ERRCODE = 'P1701', CONSTRAINT = 'ServiceBid_request_open_required';
    END IF;
    IF TG_OP = 'INSERT' AND NEW."status" NOT IN ('draft', 'submitted') THEN
      RAISE EXCEPTION 'A new bid starts as draft or submitted'
        USING ERRCODE = 'P1701', CONSTRAINT = 'ServiceBid_initial_status';
    END IF;
    IF TG_OP = 'UPDATE' AND (OLD."status" NOT IN ('draft', 'submitted', 'withdrawn')
       OR (NEW."status" = 'withdrawn' AND OLD."status" <> 'submitted')) THEN
      RAISE EXCEPTION 'A decided bid cannot be resubmitted'
        USING ERRCODE = 'P1701', CONSTRAINT = 'ServiceBid_decided_immutable';
    END IF;
    PERFORM 1 FROM "Community" WHERE "id" = target_community AND "status" = 'active' FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Bid mutation requires an active community'
        USING ERRCODE = 'P1701', CONSTRAINT = 'ServiceBid_active_community_required';
    END IF;
  ELSE
    -- Manager decisions change status/timestamps only, never the quote terms.
    IF TG_OP <> 'UPDATE' THEN
      RAISE EXCEPTION 'A new bid starts as draft or submitted'
        USING ERRCODE = 'P1701', CONSTRAINT = 'ServiceBid_initial_status';
    END IF;
    IF OLD."status" <> 'submitted' OR
       (to_jsonb(NEW) - ARRAY['status', 'decidedAt', 'updatedAt']) IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['status', 'decidedAt', 'updatedAt']) THEN
      RAISE EXCEPTION 'A bid decision cannot rewrite quote terms'
        USING ERRCODE = 'P1702', CONSTRAINT = 'ServiceBid_decision_terms_immutable';
    END IF;
    IF (NEW."status" IN ('accepted', 'rejected') AND request_state IS DISTINCT FROM 'awarded')
       OR (NEW."status" = 'expired' AND request_state IS DISTINCT FROM 'cancelled') THEN
      RAISE EXCEPTION 'Bid decision conflicts with the request lifecycle'
        USING ERRCODE = 'P1702', CONSTRAINT = 'ServiceBid_request_decision_state';
    END IF;
    IF NEW."status" = 'accepted' AND (
       NEW."pricingBasis" <> 'total' OR NEW."perHomeCents" IS NOT NULL OR
       (NEW."validUntil" IS NOT NULL AND NEW."validUntil" <= (clock_timestamp() AT TIME ZONE 'UTC'))) THEN
      RAISE EXCEPTION 'Accepted quote must remain valid and use a whole job total'
        USING ERRCODE = 'P1702', CONSTRAINT = 'ServiceBid_valid_total_required';
    END IF;
    IF NEW."status" <> 'accepted' THEN RETURN NEW; END IF;
  END IF;

  -- Check the provider after acquiring the parent, including an accepted
  -- quote that may have waited behind another transaction. Losing decisions
  -- deliberately remain possible for a provider who was later suspended.
  PERFORM 1 FROM "User" WHERE "id" = NEW."providerUserId" AND "role" = 'provider' FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bid provider identity changed'
      USING ERRCODE = 'P1702', CONSTRAINT = 'ServiceBid_active_provider_required';
  END IF;
  PERFORM 1 FROM "ProviderProfile"
  WHERE "userId" = NEW."providerUserId" AND "accountStatus" = 'active' FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bid provider is not active'
      USING ERRCODE = 'P1702', CONSTRAINT = 'ServiceBid_active_provider_required';
  END IF;
  -- Provider identity/profile locks may have waited past quote validity. The
  -- acceptance clock check must follow every awaited provider lock.
  IF NEW."status" = 'accepted' AND NEW."validUntil" IS NOT NULL
     AND NEW."validUntil" <= (clock_timestamp() AT TIME ZONE 'UTC') THEN
    RAISE EXCEPTION 'Accepted quote must remain valid and use a whole job total'
      USING ERRCODE = 'P1702', CONSTRAINT = 'ServiceBid_valid_total_required';
  END IF;
  -- A normal provider mutation can wait on those same locks. Recheck its
  -- bidding deadline here as well, after the wait rather than before it.
  IF NEW."status" IN ('draft', 'submitted', 'withdrawn') AND closes_at IS NOT NULL
     AND closes_at <= (clock_timestamp() AT TIME ZONE 'UTC') THEN
    RAISE EXCEPTION 'Bid mutation requires an open bidding window'
      USING ERRCODE = 'P1701', CONSTRAINT = 'ServiceBid_request_open_required';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER "ServiceBid_validate_insert" ON "ServiceBid";
CREATE TRIGGER "ServiceBid_validate_mutation"
  BEFORE INSERT OR UPDATE ON "ServiceBid"
  FOR EACH ROW EXECUTE FUNCTION "bundleen_validate_service_bid_mutation"();

-- The parent stamp covers the entire quote/recipient snapshot, including a
-- previously unseen first bid, a losing bid revision, and a withdrawn bid.
-- AFTER avoids manufacturing versions for ignored inserts or no-op updates.
CREATE FUNCTION "bundleen_stamp_bid_request_snapshot"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND
     (to_jsonb(NEW) - 'updatedAt') IS NOT DISTINCT FROM (to_jsonb(OLD) - 'updatedAt') THEN
    RETURN NEW;
  END IF;
  UPDATE "HoaServiceRequest"
  SET "updatedAt" = GREATEST(clock_timestamp() AT TIME ZONE 'UTC', "updatedAt" + INTERVAL '1 millisecond')
  WHERE "id" = NEW."requestId";
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ServiceBid_stamp_request_snapshot"
  AFTER INSERT OR UPDATE ON "ServiceBid"
  FOR EACH ROW EXECUTE FUNCTION "bundleen_stamp_bid_request_snapshot"();

-- The old guard predated unitless neighborhood targets. Split by context;
-- retain the original HOA unit check and all physical target/snapshot checks.
CREATE OR REPLACE FUNCTION "bundleen_validate_service_visit"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  agreement_community TEXT;
  unit_community TEXT;
  target_request TEXT;
  community_type TEXT;
  locked_at TIMESTAMP(3);
BEGIN
  SELECT agreement."communityId", agreement."requestId", community."type"::text
  INTO agreement_community, target_request, community_type
  FROM "ServiceOccurrence" occurrence
  JOIN "ServiceAgreement" agreement ON agreement."id" = occurrence."agreementId"
  JOIN "Community" community ON community."id" = agreement."communityId"
  WHERE occurrence."id" = NEW."occurrenceId";

  IF community_type = 'neighborhood' THEN
    SELECT "participantsLockedAt" INTO locked_at
    FROM "HoaServiceRequest" WHERE "id" = target_request FOR UPDATE;
    IF NEW."unitId" IS NOT NULL OR NEW."homeownerUserId" IS NULL OR locked_at IS NULL THEN
      RAISE EXCEPTION 'Neighborhood visits require one locked homeowner target'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'ServiceVisit_neighborhood_target';
    END IF;
    -- Preserve frozen address fields; never replace them from a mutable profile.
    PERFORM 1 FROM "Community" WHERE "id" = agreement_community FOR SHARE;
    PERFORM 1 FROM "User" WHERE "id" = NEW."homeownerUserId" AND "role" = 'homeowner' FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Neighborhood visits require a homeowner identity'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'ServiceVisit_homeowner_identity';
    END IF;
    PERFORM 1 FROM "CommunityMembership"
    WHERE "communityId" = agreement_community AND "userId" = NEW."homeownerUserId" AND "status" = 'active' FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Neighborhood visits require active membership in the agreement community'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'ServiceVisit_homeowner_membership';
    END IF;
    PERFORM 1 FROM "HoaRequestParticipation"
    WHERE "requestId" = target_request AND "userId" = NEW."homeownerUserId" AND "response" = 'joined' FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Neighborhood visits require a locked joined participant'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'ServiceVisit_homeowner_participation';
    END IF;
  ELSE
    -- Exact original HOA guard, including its existing missing-parent result.
    SELECT "communityId" INTO unit_community FROM "CommunityUnit" WHERE "id" = NEW."unitId";
    IF agreement_community IS DISTINCT FROM unit_community THEN
      RAISE EXCEPTION 'visit unit must belong to the agreement''s HOA'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'ServiceVisit_unit_same_hoa';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER "ServiceVisit_validate" ON "ServiceVisit";
CREATE TRIGGER "ServiceVisit_validate"
  BEFORE INSERT OR UPDATE OF "occurrenceId", "unitId", "homeownerUserId"
  ON "ServiceVisit"
  FOR EACH ROW EXECUTE FUNCTION "bundleen_validate_service_visit"();
