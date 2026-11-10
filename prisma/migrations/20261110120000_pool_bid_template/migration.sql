-- Additive, opt-in monthly pool quoting. Existing requests and prices stay null/unchanged.
ALTER TYPE "AdminAuditAction" ADD VALUE IF NOT EXISTS 'provider_bid_invited';
ALTER TABLE "HoaServiceRequest" ADD COLUMN "poolTemplate" JSONB;
ALTER TABLE "HoaRequestParticipation" ADD COLUMN "poolTier" TEXT;
ALTER TABLE "ServiceBid" ADD COLUMN "poolQuote" JSONB;
ALTER TABLE "ServiceAgreement" ADD COLUMN "poolSnapshot" JSONB;
ALTER TABLE "ProviderProfile" ADD COLUMN "businessStartedYear" INTEGER;
ALTER TABLE "ProviderProfile" ADD CONSTRAINT "ProviderProfile_business_started_year"
  CHECK ("businessStartedYear" IS NULL OR "businessStartedYear" BETWEEN 1800 AND 9999);
ALTER TABLE "HoaRequestParticipation" ADD CONSTRAINT "HoaRequestParticipation_pool_tier"
  CHECK ("poolTier" IS NULL OR "poolTier" IN ('standard', 'large', 'pool_spa'));

CREATE TABLE "ServiceBidRevision" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "bidId" TEXT NOT NULL REFERENCES "ServiceBid"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "version" INTEGER NOT NULL CHECK ("version" > 0),
  "amountCents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL,
  "submittedAt" TIMESTAMP(3) NOT NULL,
  "poolQuote" JSONB,
  "snapshot" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "ServiceBidRevision_bidId_version_key" ON "ServiceBidRevision"("bidId", "version");

CREATE TABLE "ProviderBidInvitation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "requestId" TEXT NOT NULL REFERENCES "HoaServiceRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "providerUserId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "invitedByUserId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "ProviderBidInvitation_requestId_providerUserId_key" ON "ProviderBidInvitation"("requestId", "providerUserId");

CREATE FUNCTION bundleen_validate_pool_template() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t JSONB; tier JSONB; months INTEGER; visits INTEGER;
BEGIN
  t := NEW."poolTemplate";
  IF TG_OP = 'UPDATE' AND t IS DISTINCT FROM OLD."poolTemplate" AND
     (OLD."status" <> 'draft' OR OLD."participantsLockedAt" IS NOT NULL OR
      EXISTS (SELECT 1 FROM "HoaRequestParticipation" WHERE "requestId" = OLD."id")) THEN
    RAISE EXCEPTION 'Pool scope cannot change after enrollment starts' USING ERRCODE = 'P1701';
  END IF;
  IF t IS NULL THEN RETURN NEW; END IF;
  IF NEW."category" <> 'pool_care' OR NEW."kind" <> 'optional_group' OR
     jsonb_typeof(t) IS DISTINCT FROM 'object' OR
     (SELECT count(*) FROM jsonb_object_keys(t)) <> 5 OR
     t->'version' IS DISTINCT FROM '1'::jsonb OR
     jsonb_typeof(t->'hideProviderNamesUntilAward') IS DISTINCT FROM 'boolean' OR
     jsonb_typeof(t->'serviceMonths') IS DISTINCT FROM 'number' OR
     jsonb_typeof(t->'visitsPerMonth') IS DISTINCT FROM 'number' OR
     (t->>'serviceMonths') !~ '^[0-9]+$' OR (t->>'visitsPerMonth') !~ '^[0-9]+$' OR
     jsonb_typeof(t->'tiers') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invalid pool template' USING ERRCODE = 'P1701';
  END IF;
  months := (t->>'serviceMonths')::integer;
  visits := (t->>'visitsPerMonth')::integer;
  IF months NOT BETWEEN 1 AND 24 OR visits NOT BETWEEN 1 AND 8 OR months * visits > 104 OR
     NEW."totalOccurrences" <> months * visits OR NEW."recurrenceIntervalDays" IS NOT NULL OR
     jsonb_array_length(t->'tiers') NOT BETWEEN 1 AND 3 OR
     (SELECT count(DISTINCT value) FROM jsonb_array_elements(t->'tiers')) <> jsonb_array_length(t->'tiers') THEN
    RAISE EXCEPTION 'Invalid finite pool service term or tiers' USING ERRCODE = 'P1701';
  END IF;
  FOR tier IN SELECT value FROM jsonb_array_elements(t->'tiers') LOOP
    IF tier NOT IN ('"standard"'::jsonb, '"large"'::jsonb, '"pool_spa"'::jsonb) THEN
      RAISE EXCEPTION 'Invalid pool tier' USING ERRCODE = 'P1701';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "HoaServiceRequest_pool_template" BEFORE INSERT OR UPDATE ON "HoaServiceRequest"
  FOR EACH ROW EXECUTE FUNCTION bundleen_validate_pool_template();

-- This supplements, rather than replaces, the existing membership/authority
-- validator. It runs after that validator's locks and checks the wall clock.
CREATE FUNCTION bundleen_validate_pool_participation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r "HoaServiceRequest"%ROWTYPE; prior "HoaServiceRequest"%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT * INTO r FROM "HoaServiceRequest" WHERE "id" = OLD."requestId" FOR UPDATE;
    IF r."poolTemplate" IS NOT NULL AND (r."participantsLockedAt" IS NOT NULL OR r."status" <> 'collecting_interest') THEN
      RAISE EXCEPTION 'Pool household snapshot is locked' USING ERRCODE = 'P1701';
    END IF;
    RETURN OLD;
  END IF;
  SELECT * INTO r FROM "HoaServiceRequest" WHERE "id" = NEW."requestId" FOR UPDATE;
  IF TG_OP = 'UPDATE' AND NEW."requestId" IS DISTINCT FROM OLD."requestId" THEN
    SELECT * INTO prior FROM "HoaServiceRequest" WHERE "id" = OLD."requestId" FOR UPDATE;
    IF prior."poolTemplate" IS NOT NULL AND (prior."participantsLockedAt" IS NOT NULL OR prior."status" <> 'collecting_interest') THEN
      RAISE EXCEPTION 'Previous pool household snapshot is locked' USING ERRCODE = 'P1701';
    END IF;
  END IF;
  IF r."poolTemplate" IS NULL THEN
    IF NEW."poolTier" IS NOT NULL THEN RAISE EXCEPTION 'Request has no pool tiers' USING ERRCODE = 'P1701'; END IF;
    RETURN NEW;
  END IF;
  IF r."participantsLockedAt" IS NOT NULL OR r."status" <> 'collecting_interest' OR
     (r."enrollmentClosesAt" IS NOT NULL AND r."enrollmentClosesAt" <= (clock_timestamp() AT TIME ZONE 'UTC')) THEN
    RAISE EXCEPTION 'Pool enrollment is closed or locked' USING ERRCODE = 'P1701';
  END IF;
  IF (NEW."response" = 'joined' AND (NEW."poolTier" IS NULL OR NOT (r."poolTemplate"->'tiers' ? NEW."poolTier"))) OR
     (NEW."response" = 'declined' AND NEW."poolTier" IS NOT NULL) THEN
    RAISE EXCEPTION 'Choose an applicable pool tier when joining' USING ERRCODE = 'P1701';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "zz_HoaRequestParticipation_pool_guard" BEFORE INSERT OR UPDATE OR DELETE ON "HoaRequestParticipation"
  FOR EACH ROW EXECUTE FUNCTION bundleen_validate_pool_participation();

CREATE FUNCTION bundleen_stamp_pool_participation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE request_id TEXT;
BEGIN
  request_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."requestId" ELSE NEW."requestId" END;
  UPDATE "HoaServiceRequest" SET "updatedAt" = GREATEST(clock_timestamp() AT TIME ZONE 'UTC', "updatedAt" + INTERVAL '1 millisecond')
  WHERE "id" = request_id AND "poolTemplate" IS NOT NULL;
  IF TG_OP = 'UPDATE' AND OLD."requestId" IS DISTINCT FROM NEW."requestId" THEN
    UPDATE "HoaServiceRequest" SET "updatedAt" = GREATEST(clock_timestamp() AT TIME ZONE 'UTC', "updatedAt" + INTERVAL '1 millisecond')
    WHERE "id" = OLD."requestId" AND "poolTemplate" IS NOT NULL;
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER "HoaRequestParticipation_stamp_pool" AFTER INSERT OR UPDATE OR DELETE ON "HoaRequestParticipation"
  FOR EACH ROW EXECUTE FUNCTION bundleen_stamp_pool_participation();

CREATE FUNCTION bundleen_pool_bid_total(template JSONB, quote JSONB, request_id TEXT) RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE tier TEXT; rate JSONB; monthly BIGINT := 0; homes BIGINT := 0; total BIGINT; term_months INTEGER;
BEGIN
  IF jsonb_typeof(quote) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(quote)) <> 6 OR
     jsonb_typeof(quote->'monthlyCents') IS DISTINCT FROM 'object' OR
     jsonb_typeof(quote->'chemicalsIncluded') IS DISTINCT FROM 'boolean' OR
     quote->'equipmentRepairsExcluded' IS DISTINCT FROM 'true'::jsonb OR
     quote->>'routeDay' IS NULL OR quote->>'routeDay' NOT IN ('flexible','mon','tue','wed','thu','fri','sat','sun') OR
     jsonb_typeof(quote->'cancellationNoticeDays') IS DISTINCT FROM 'number' OR
     (quote->>'cancellationNoticeDays') !~ '^[0-9]+$' OR (quote->>'cancellationNoticeDays')::integer NOT BETWEEN 0 AND 90 OR
     jsonb_typeof(quote->'earliestStartDate') IS DISTINCT FROM 'string' OR
     (quote->>'earliestStartDate') !~ '^\d{4}-\d{2}-\d{2}T' OR
     (SELECT count(*) FROM jsonb_object_keys(quote->'monthlyCents')) <> jsonb_array_length(template->'tiers') THEN
    RAISE EXCEPTION 'Invalid structured pool quote' USING ERRCODE = 'P1701';
  END IF;
  PERFORM (quote->>'earliestStartDate')::timestamptz;
  term_months := (template->>'serviceMonths')::integer;
  IF EXISTS (SELECT 1 FROM "HoaRequestParticipation" WHERE "requestId" = request_id AND "response" = 'joined'
             AND ("poolTier" IS NULL OR NOT (template->'tiers' ? "poolTier"))) THEN
    RAISE EXCEPTION 'Incomplete locked pool tiers' USING ERRCODE = 'P1701';
  END IF;
  FOR tier IN SELECT jsonb_array_elements_text(template->'tiers') LOOP
    rate := quote->'monthlyCents'->tier;
    IF jsonb_typeof(rate) IS DISTINCT FROM 'number' OR rate::text !~ '^[0-9]+$' OR
       rate::text::bigint NOT BETWEEN 1 AND 50000000 THEN
      RAISE EXCEPTION 'Quote every applicable pool tier in integer cents' USING ERRCODE = 'P1701';
    END IF;
    monthly := monthly + rate::text::bigint * (SELECT count(*) FROM "HoaRequestParticipation" WHERE "requestId" = request_id AND "response" = 'joined' AND "poolTier" = tier);
  END LOOP;
  SELECT count(*) INTO homes FROM "HoaRequestParticipation" WHERE "requestId" = request_id AND "response" = 'joined';
  total := monthly * term_months;
  IF homes < 1 OR total NOT BETWEEN 1 AND 50000000 THEN
    RAISE EXCEPTION 'Pool whole-job total is outside supported bounds' USING ERRCODE = 'P1701';
  END IF;
  RETURN total;
END;
$$;

CREATE FUNCTION bundleen_validate_pool_bid() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r "HoaServiceRequest"%ROWTYPE; total BIGINT;
BEGIN
  SELECT * INTO r FROM "HoaServiceRequest" WHERE "id" = NEW."requestId" FOR UPDATE;
  IF r."poolTemplate" IS NULL THEN
    IF NEW."poolQuote" IS NOT NULL THEN RAISE EXCEPTION 'Request has no pool quote template' USING ERRCODE = 'P1701'; END IF;
    RETURN NEW;
  END IF;
  total := bundleen_pool_bid_total(r."poolTemplate", NEW."poolQuote", NEW."requestId");
  IF r."participantsLockedAt" IS NULL OR NEW."pricingBasis" <> 'total' OR NEW."perHomeCents" IS NOT NULL OR
     NEW."currency" <> 'usd' OR NEW."amountCents" <> total OR NEW."validUntil" IS NULL OR
     NEW."proposedStartDate" IS DISTINCT FROM ((NEW."poolQuote"->>'earliestStartDate')::timestamptz AT TIME ZONE 'UTC') THEN
    RAISE EXCEPTION 'Pool quote must preserve the exact finite whole-job total and validity' USING ERRCODE = 'P1701';
  END IF;
  IF TG_OP = 'INSERT' AND NEW."version" <> 1 THEN RAISE EXCEPTION 'Initial quote version is one' USING ERRCODE = 'P1701'; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW."version" NOT IN (OLD."version", OLD."version" + 1) OR
       ((to_jsonb(NEW) - ARRAY['status','decidedAt','withdrawnAt','updatedAt','version']) IS DISTINCT FROM
        (to_jsonb(OLD) - ARRAY['status','decidedAt','withdrawnAt','updatedAt','version']) AND NEW."version" <> OLD."version" + 1) THEN
      RAISE EXCEPTION 'Pool quote edits require the next version' USING ERRCODE = 'P1701';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "z_ServiceBid_pool_guard" BEFORE INSERT OR UPDATE ON "ServiceBid"
  FOR EACH ROW EXECUTE FUNCTION bundleen_validate_pool_bid();

CREATE FUNCTION bundleen_record_pool_bid_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."poolQuote" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."version" IS DISTINCT FROM OLD."version") THEN
    INSERT INTO "ServiceBidRevision" ("id","bidId","version","amountCents","currency","submittedAt","poolQuote","snapshot")
    VALUES ('pool-revision:' || NEW."id" || ':' || NEW."version", NEW."id", NEW."version", NEW."amountCents", NEW."currency", NEW."submittedAt", NEW."poolQuote", to_jsonb(NEW));
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER "ServiceBid_record_pool_revision" AFTER INSERT OR UPDATE ON "ServiceBid"
  FOR EACH ROW EXECUTE FUNCTION bundleen_record_pool_bid_revision();
CREATE FUNCTION bundleen_protect_bid_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b "ServiceBid"%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO b FROM "ServiceBid" WHERE "id" = NEW."bidId" FOR SHARE;
    IF NOT FOUND OR b."poolQuote" IS NULL OR NEW."version" <> b."version" OR
       NEW."amountCents" <> b."amountCents" OR NEW."currency" <> b."currency" OR
       NEW."submittedAt" <> b."submittedAt" OR NEW."poolQuote" IS DISTINCT FROM b."poolQuote" OR
       NEW."snapshot" IS DISTINCT FROM to_jsonb(b) THEN
      RAISE EXCEPTION 'Revision must match the exact current pool bid' USING ERRCODE = 'P1702';
    END IF;
    RETURN NEW;
  END IF;
  -- Cascading deletion retains existing account/request deletion semantics.
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Bid revision history is append only' USING ERRCODE = 'P1702';
END;
$$;
CREATE TRIGGER "ServiceBidRevision_append_only" BEFORE INSERT OR UPDATE OR DELETE ON "ServiceBidRevision"
  FOR EACH ROW EXECUTE FUNCTION bundleen_protect_bid_revision();
CREATE TRIGGER "ServiceBidRevision_no_truncate" BEFORE TRUNCATE ON "ServiceBidRevision"
  FOR EACH STATEMENT EXECUTE FUNCTION bundleen_protect_bid_revision();

CREATE FUNCTION bundleen_validate_pool_agreement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r "HoaServiceRequest"%ROWTYPE; b "ServiceBid"%ROWTYPE; homes JSONB; counts JSONB; s JSONB;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW."poolSnapshot" IS DISTINCT FROM OLD."poolSnapshot" OR
       (OLD."poolSnapshot" IS NOT NULL AND
        (to_jsonb(NEW) - ARRAY['status','updatedAt']) IS DISTINCT FROM
        (to_jsonb(OLD) - ARRAY['status','updatedAt'])) THEN
      RAISE EXCEPTION 'Awarded pool pricing snapshot is immutable' USING ERRCODE = 'P1702';
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO r FROM "HoaServiceRequest" WHERE "id" = NEW."requestId" FOR UPDATE;
  IF r."poolTemplate" IS NULL THEN
    IF NEW."poolSnapshot" IS NOT NULL THEN RAISE EXCEPTION 'Legacy agreement has no pool snapshot' USING ERRCODE = 'P1702'; END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO b FROM "ServiceBid" WHERE "id" = NEW."bidId" FOR SHARE;
  SELECT jsonb_agg(jsonb_build_object('unitId', p."unitId", 'userId', p."userId", 'tier', p."poolTier",
      'monthlyCents', (b."poolQuote"->'monthlyCents'->>p."poolTier")::integer,
      'termCents', (b."poolQuote"->'monthlyCents'->>p."poolTier")::integer * (r."poolTemplate"->>'serviceMonths')::integer) ORDER BY p."id") INTO homes
    FROM "HoaRequestParticipation" p WHERE p."requestId" = r."id" AND p."response" = 'joined';
  SELECT jsonb_object_agg(t.tier, t.n) INTO counts FROM
    (SELECT "poolTier" AS tier, count(*) AS n FROM "HoaRequestParticipation" WHERE "requestId" = r."id" AND "response" = 'joined' GROUP BY "poolTier") t;
  s := NEW."poolSnapshot";
  IF s IS NULL OR s->'version' IS DISTINCT FROM '1'::jsonb OR s->'template' IS DISTINCT FROM r."poolTemplate" OR
     s->'quote' IS DISTINCT FROM b."poolQuote" OR s->'tierCounts' IS DISTINCT FROM counts OR
     s->'amountCents' IS DISTINCT FROM to_jsonb(NEW."amountCents") OR
     NEW."amountCents" <> bundleen_pool_bid_total(r."poolTemplate", b."poolQuote", r."id") OR
     NEW."amountCents" <> b."amountCents" OR NEW."lockedHomeCount" <> jsonb_array_length(homes) OR
     jsonb_typeof(s->'homes') IS DISTINCT FROM 'array' OR
     jsonb_array_length(s->'homes') <> jsonb_array_length(homes) OR
     NOT ((s->'homes') @> homes AND homes @> (s->'homes')) THEN
    RAISE EXCEPTION 'Pool agreement must freeze exact home tiers and prices' USING ERRCODE = 'P1702';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "z_ServiceAgreement_pool_snapshot" BEFORE INSERT OR UPDATE ON "ServiceAgreement"
  FOR EACH ROW EXECUTE FUNCTION bundleen_validate_pool_agreement();

CREATE FUNCTION bundleen_validate_provider_bid_invitation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r "HoaServiceRequest"%ROWTYPE; actor_email TEXT; p "ProviderProfile"%ROWTYPE; l "MediaAsset"%ROWTYPE; i "MediaAsset"%ROWTYPE; today_utc DATE;
BEGIN
  SELECT * INTO r FROM "HoaServiceRequest" WHERE "id" = NEW."requestId" FOR UPDATE;
  IF r."status" IS DISTINCT FROM 'open_for_bids' OR r."poolTemplate" IS NULL OR
     r."category" <> 'pool_care' THEN RAISE EXCEPTION 'Pool request is not accepting invitations' USING ERRCODE = 'P1701'; END IF;
  PERFORM 1 FROM "Community" WHERE "id" = r."communityId" AND "status" = 'active' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Community is inactive' USING ERRCODE = 'P1701'; END IF;
  SELECT "email" INTO actor_email FROM "User" WHERE "id" = NEW."invitedByUserId" AND "role" = 'admin' AND "isVerified" = true FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active admin required' USING ERRCODE = 'P1703'; END IF;
  PERFORM 1 FROM "AdminAccessGrant" WHERE "userId" = NEW."invitedByUserId" AND "email" = lower(actor_email)
    AND "status" = 'active' AND "isStaffAccount" = false FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active exact admin grant required' USING ERRCODE = 'P1703'; END IF;
  PERFORM 1 FROM "User" WHERE "id" = NEW."providerUserId" AND "role" = 'provider' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active provider required' USING ERRCODE = 'P1701'; END IF;
  SELECT * INTO p FROM "ProviderProfile" WHERE "userId" = NEW."providerUserId" AND "accountStatus" = 'active' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active provider required' USING ERRCODE = 'P1701'; END IF;
  SELECT * INTO l FROM "MediaAsset" WHERE "id" = p."licenseDocumentId" FOR SHARE;
  SELECT * INTO i FROM "MediaAsset" WHERE "id" = p."insuranceDocumentId" FOR SHARE;
  today_utc := (clock_timestamp() AT TIME ZONE 'UTC')::date;
  IF NOT COALESCE(
    'pool_care' = ANY(p."trades")
    AND p."licenseVerifiedAt" IS NOT NULL AND p."insuranceVerifiedAt" IS NOT NULL
    AND p."licenseNumber" IS NOT NULL AND p."licenseNumber" <> ''
    AND p."insuranceProvider" IS NOT NULL AND p."insuranceProvider" <> ''
    AND p."licenseExpiresAt" >= today_utc AND p."insuranceExpiresAt" >= today_utc
    AND l."providerProfileId" = p."id" AND i."providerProfileId" = p."id"
    AND l."purpose"::text = 'provider_license' AND i."purpose"::text = 'provider_insurance'
    AND l."status"::text = 'active' AND i."status"::text = 'active'
    AND l."credentialReviewStatus"::text = 'approved' AND i."credentialReviewStatus"::text = 'approved'
    AND l."storageUrl" = '' AND i."storageUrl" = '' AND l."communityId" IS NULL AND i."communityId" IS NULL
    AND l."checksum" = p."licenseVerifiedDocumentChecksum" AND i."checksum" = p."insuranceVerifiedDocumentChecksum"
    AND l."credentialExpiresAt" = p."licenseExpiresAt" AND i."credentialExpiresAt" = p."insuranceExpiresAt"
    AND i."credentialCoverageCents" = p."insuranceCoverageCents" AND p."insuranceCoverageCents" >= 0
    AND i."credentialAdditionalInsured" = p."insuranceAdditionalInsured"
    AND l."credentialSnapshot" = jsonb_build_object('licenseNumber',p."licenseNumber",'licenseState',p."licenseState")
    AND i."credentialSnapshot" = jsonb_build_object('insuranceProvider',p."insuranceProvider",'insurancePolicyNumber',p."insurancePolicyNumber"), false
  ) THEN RAISE EXCEPTION 'Invited provider needs current approved pool credentials' USING ERRCODE = 'P1701'; END IF;
  IF r."biddingClosesAt" IS NOT NULL AND r."biddingClosesAt" <= (clock_timestamp() AT TIME ZONE 'UTC') THEN
    RAISE EXCEPTION 'Bidding closed while preparing invitation' USING ERRCODE = 'P1701';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ProviderBidInvitation_validate" BEFORE INSERT ON "ProviderBidInvitation"
  FOR EACH ROW EXECUTE FUNCTION bundleen_validate_provider_bid_invitation();

-- Alphabetically last: credential/policy guards may themselves wait on a
-- document lock after the older bid guard checked time. Check quote validity
-- against the wall clock only after all of those awaited locks are held.
CREATE FUNCTION bundleen_pool_bid_final_validity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."poolQuote" IS NOT NULL AND
     (NEW."status" = 'accepted' OR (NEW."status" = 'submitted' AND
       (TG_OP = 'INSERT' OR NEW."version" IS DISTINCT FROM OLD."version"))) AND
     (NEW."validUntil" IS NULL OR NEW."validUntil" <= (clock_timestamp() AT TIME ZONE 'UTC')) THEN
    RAISE EXCEPTION 'Pool quote expired while this action was being prepared' USING ERRCODE = 'P1701';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "zzz_ServiceBid_pool_validity" BEFORE INSERT OR UPDATE ON "ServiceBid"
  FOR EACH ROW EXECUTE FUNCTION bundleen_pool_bid_final_validity();
