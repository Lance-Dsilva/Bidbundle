ALTER TABLE "HoaServiceRequest" ADD COLUMN "requiresPriceCommitment" BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE "PriceLadderCommitment" (
 "id" TEXT PRIMARY KEY, "requestId" TEXT NOT NULL UNIQUE REFERENCES "HoaServiceRequest"("id") ON DELETE RESTRICT,
 "providerUserId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
 "actorUserId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
 "scope" TEXT NOT NULL, "guaranteedPerHomeCents" INTEGER NOT NULL CHECK ("guaranteedPerHomeCents" BETWEEN 0 AND 50000000),
 "acceptedAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "ServiceBidPriceTier" (
 "id" TEXT PRIMARY KEY, "commitmentId" TEXT NOT NULL REFERENCES "PriceLadderCommitment"("id") ON DELETE RESTRICT,
 "bidId" TEXT REFERENCES "ServiceBid"("id") ON DELETE RESTRICT,
 "minHomes" INTEGER NOT NULL CHECK ("minHomes" BETWEEN 1 AND 10000),
 "perHomeCents" INTEGER NOT NULL CHECK ("perHomeCents" BETWEEN 0 AND 50000000),
 UNIQUE ("commitmentId", "minHomes")
);
CREATE INDEX "ServiceBidPriceTier_bidId_idx" ON "ServiceBidPriceTier"("bidId");
ALTER TABLE "HoaRequestParticipation" ADD COLUMN "maximumPriceCents" INTEGER CHECK ("maximumPriceCents" >= 0);

CREATE FUNCTION bundleen_ladder_commitment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r "HoaServiceRequest"%ROWTYPE;
BEGIN
 IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Provider commitments cannot be deleted'; END IF;
 SELECT * INTO r FROM "HoaServiceRequest" WHERE "id"=NEW."requestId" FOR UPDATE;
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-ARRAY['guaranteedPerHomeCents','acceptedAt']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['guaranteedPerHomeCents','acceptedAt']) OR (OLD."acceptedAt" IS NOT NULL AND NEW."acceptedAt" IS DISTINCT FROM OLD."acceptedAt") OR (OLD."acceptedAt" IS NOT NULL AND NEW."guaranteedPerHomeCents">OLD."guaranteedPerHomeCents") THEN
   RAISE EXCEPTION 'Provider commitment terms are immutable';
  END IF;
  RETURN NEW;
 END IF;
 IF r."kind"<>'optional_group' OR r."status" NOT IN ('draft','collecting_interest') OR r."participantsLockedAt" IS NOT NULL OR r."poolTemplate" IS NOT NULL OR
 EXISTS(SELECT 1 FROM "HoaRequestParticipation" WHERE "requestId"=r."id") THEN
  RAISE EXCEPTION 'Commit pricing before enrollment starts';
 END IF;
 PERFORM 1 FROM "User" u JOIN "ProviderProfile" p ON p."userId"=u."id" WHERE u."id"=NEW."providerUserId" AND u."role"='provider' AND p."accountStatus"='active' FOR SHARE OF u,p;
 IF NOT FOUND THEN RAISE EXCEPTION 'Active provider required'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "PriceLadderCommitment_guard" BEFORE INSERT OR UPDATE OR DELETE ON "PriceLadderCommitment" FOR EACH ROW EXECUTE FUNCTION bundleen_ladder_commitment_guard();

CREATE FUNCTION bundleen_ladder_tiers_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c TEXT; n INTEGER; first_home INTEGER; bad BOOLEAN;
BEGIN
 c:=COALESCE(NEW."commitmentId",OLD."commitmentId");
 SELECT count(*),min("minHomes"),bool_or(prior_price IS NOT NULL AND "perHomeCents">=prior_price)
 INTO n,first_home,bad FROM (SELECT *,lag("perHomeCents") OVER(ORDER BY "minHomes") prior_price FROM "ServiceBidPriceTier" WHERE "commitmentId"=c) t;
 IF n NOT BETWEEN 1 AND 20 OR first_home<>1 OR COALESCE(bad,false) THEN RAISE EXCEPTION 'Invalid provider price ladder'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "ServiceBidPriceTier_validate" AFTER INSERT OR UPDATE OR DELETE ON "ServiceBidPriceTier" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION bundleen_ladder_tiers_guard();

CREATE FUNCTION bundleen_ladder_tier_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c "PriceLadderCommitment"%ROWTYPE;
BEGIN
 SELECT * INTO c FROM "PriceLadderCommitment" WHERE "id"=COALESCE(NEW."commitmentId",OLD."commitmentId") FOR UPDATE;
 IF c."acceptedAt" IS NOT NULL THEN
  IF TG_OP<>'UPDATE' OR (to_jsonb(NEW)-'bidId') IS DISTINCT FROM (to_jsonb(OLD)-'bidId') OR OLD."bidId" IS NOT NULL THEN RAISE EXCEPTION 'Accepted price tiers are immutable'; END IF;
  IF NEW."bidId" IS DISTINCT FROM 'ladder:'||c."id" THEN RAISE EXCEPTION 'Only the committed bid may own price tiers'; END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM "HoaRequestParticipation" WHERE "requestId"=c."requestId" AND "response"='joined') THEN RAISE EXCEPTION 'Enrollment has started'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "ServiceBidPriceTier_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "ServiceBidPriceTier" FOR EACH ROW EXECUTE FUNCTION bundleen_ladder_tier_immutable();

-- Participation already holds the request lock via the existing audience guards.
CREATE FUNCTION bundleen_ladder_join_cap() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c "PriceLadderCommitment"%ROWTYPE; homes INTEGER; price INTEGER;
BEGIN
 SELECT * INTO c FROM "PriceLadderCommitment" WHERE "requestId"=NEW."requestId" FOR UPDATE;
 IF NOT FOUND THEN
  IF NEW."response"='joined' AND EXISTS(SELECT 1 FROM "HoaServiceRequest" WHERE "id"=NEW."requestId" AND "requiresPriceCommitment") THEN RAISE EXCEPTION 'Provider acceptance required before enrollment'; END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='UPDATE' AND OLD."maximumPriceCents" IS NOT NULL THEN NEW."maximumPriceCents":=OLD."maximumPriceCents"; END IF;
 IF NEW."response"='joined' THEN
  IF c."acceptedAt" IS NULL THEN RAISE EXCEPTION 'Provider must accept the price commitment before enrollment'; END IF;
  SELECT count(*)+1 INTO homes FROM "HoaRequestParticipation" WHERE "requestId"=NEW."requestId" AND "response"='joined' AND "id"<>NEW."id";
  SELECT "perHomeCents" INTO price FROM "ServiceBidPriceTier" WHERE "commitmentId"=c."id" AND "minHomes"<=homes ORDER BY "minHomes" DESC LIMIT 1;
  IF price IS NULL THEN RAISE EXCEPTION 'Provider pricing is not committed'; END IF;
  price:=LEAST(price,c."guaranteedPerHomeCents");
  NEW."maximumPriceCents":=LEAST(COALESCE(NEW."maximumPriceCents",price),price);
  UPDATE "PriceLadderCommitment" SET "guaranteedPerHomeCents"=price WHERE "id"=c."id";
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "zz_HoaParticipation_ladder_cap" BEFORE INSERT OR UPDATE ON "HoaRequestParticipation" FOR EACH ROW EXECUTE FUNCTION bundleen_ladder_join_cap();

CREATE FUNCTION bundleen_ladder_materialize_bid() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c "PriceLadderCommitment"%ROWTYPE; homes INTEGER; bid_id TEXT;
BEGIN
 IF NEW."status"='open_for_bids' AND OLD."status"='collecting_interest' THEN
  SELECT * INTO c FROM "PriceLadderCommitment" WHERE "requestId"=NEW."id" FOR UPDATE;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF c."acceptedAt" IS NULL THEN RAISE EXCEPTION 'Provider acceptance required'; END IF;
  SELECT count(*) INTO homes FROM "HoaRequestParticipation" WHERE "requestId"=NEW."id" AND "response"='joined';
  IF homes=0 OR homes::bigint*c."guaranteedPerHomeCents">50000000 THEN RAISE EXCEPTION 'Ladder total out of bounds'; END IF;
  bid_id:='ladder:'||c."id";
  INSERT INTO "ServiceBid"("id","requestId","providerUserId","status","amountCents","currency","pricingBasis","perHomeCents","scope","updatedAt")
   VALUES(bid_id,NEW."id",c."providerUserId",'submitted',homes*c."guaranteedPerHomeCents",'usd','per_home',c."guaranteedPerHomeCents",c."scope",CURRENT_TIMESTAMP);
  UPDATE "ServiceBidPriceTier" SET "bidId"=bid_id WHERE "commitmentId"=c."id";
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "HoaRequest_ladder_materialize" AFTER UPDATE OF "status" ON "HoaServiceRequest" FOR EACH ROW EXECUTE FUNCTION bundleen_ladder_materialize_bid();

CREATE OR REPLACE FUNCTION "bundleen_validate_service_bid_mutation"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  request_state "HoaRequestStatus";
  closes_at TIMESTAMP(3);
  target_community TEXT;
  ladder "PriceLadderCommitment"%ROWTYPE;
  homes INTEGER;
  ladder_valid BOOLEAN:=false;
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

  SELECT * INTO ladder FROM "PriceLadderCommitment" WHERE "requestId"=NEW."requestId";
  IF FOUND THEN
    SELECT count(*) INTO homes FROM "HoaRequestParticipation" WHERE "requestId"=NEW."requestId" AND "response"='joined';
    ladder_valid := NEW."id"='ladder:'||ladder."id" AND NEW."providerUserId"=ladder."providerUserId" AND NEW."pricingBasis"='per_home' AND NEW."perHomeCents"=ladder."guaranteedPerHomeCents" AND NEW."amountCents"=homes*ladder."guaranteedPerHomeCents" AND NEW."scope"=ladder."scope" AND NEW."currency"='usd';
    IF NEW."status"='accepted' AND NOT ladder_valid THEN RAISE EXCEPTION 'Award must honor the committed ladder'; END IF;
    IF NEW."id"='ladder:'||ladder."id" AND (NOT ladder_valid OR NEW."status"='withdrawn' OR (TG_OP='UPDATE' AND NEW."status"='submitted')) THEN RAISE EXCEPTION 'Committed ladder cannot be revised or withdrawn'; END IF;
  END IF;
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
       ((NEW."pricingBasis" <> 'total' OR NEW."perHomeCents" IS NOT NULL) AND NOT ladder_valid) OR
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

-- A provider accepts a service term, not just a list of numbers. Preserve the
-- request description, audience rules, dates and recurrence beneath that promise.
CREATE FUNCTION bundleen_ladder_request_terms() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM "PriceLadderCommitment" WHERE "requestId"=OLD."id") AND
 ROW(NEW."requiresPriceCommitment",NEW."title",NEW."description",NEW."category",NEW."kind",NEW."recurrenceLabel",NEW."recurrenceIntervalDays",NEW."totalOccurrences",NEW."startDate",NEW."enrollmentClosesAt",NEW."minHomes",NEW."maxHomes",NEW."poolTemplate",NEW."requiresAfterPhoto") IS DISTINCT FROM
 ROW(OLD."requiresPriceCommitment",OLD."title",OLD."description",OLD."category",OLD."kind",OLD."recurrenceLabel",OLD."recurrenceIntervalDays",OLD."totalOccurrences",OLD."startDate",OLD."enrollmentClosesAt",OLD."minHomes",OLD."maxHomes",OLD."poolTemplate",OLD."requiresAfterPhoto") THEN
 RAISE EXCEPTION 'Service terms under a provider price commitment are immutable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "HoaRequest_ladder_terms" BEFORE UPDATE ON "HoaServiceRequest" FOR EACH ROW EXECUTE FUNCTION bundleen_ladder_request_terms();
