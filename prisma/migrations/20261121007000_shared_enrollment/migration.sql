CREATE TABLE "SharedEnrollmentFlow" (
 "token" TEXT PRIMARY KEY,
 "requestId" TEXT NOT NULL REFERENCES "HoaServiceRequest"("id") ON DELETE RESTRICT,
 "communityTokenHash" TEXT NOT NULL,
 "requestTokenHash" TEXT NOT NULL,
 "userId" TEXT REFERENCES "User"("id") ON DELETE RESTRICT,
 "consentId" TEXT NOT NULL UNIQUE,
 "confirmedMembershipId" TEXT REFERENCES "CommunityMembership"("id") ON DELETE RESTRICT,
 "confirmedUnitId" TEXT REFERENCES "CommunityUnit"("id") ON DELETE RESTRICT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "expiresAt" TIMESTAMP(3) NOT NULL,
 CHECK ("token" ~ '^[A-Za-z0-9_-]{32}$'),
 CHECK ("communityTokenHash" ~ '^[a-f0-9]{64}$' AND "requestTokenHash" ~ '^[a-f0-9]{64}$'),
 CHECK ("expiresAt" > "createdAt" AND "expiresAt" <= "createdAt" + INTERVAL '2 hours'),
 CHECK (("confirmedMembershipId" IS NULL) = ("confirmedUnitId" IS NULL)),
 CHECK ("confirmedMembershipId" IS NULL OR "userId" IS NOT NULL)
);
CREATE INDEX "SharedEnrollmentFlow_expiresAt_idx" ON "SharedEnrollmentFlow"("expiresAt");
CREATE FUNCTION shared_enrollment_flow_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r "HoaServiceRequest"; u "User"; m "CommunityMembership"; ct TEXT; rt TEXT;
BEGIN
 IF TG_OP='INSERT' THEN
  NEW."createdAt" := clock_timestamp();
  NEW."expiresAt" := LEAST(NEW."expiresAt", NEW."createdAt" + INTERVAL '2 hours');
 END IF;
 SELECT * INTO r FROM "HoaServiceRequest" WHERE id=NEW."requestId" FOR UPDATE;
 IF NOT FOUND OR r.kind<>'optional_group' OR r.status NOT IN ('collecting_interest','open_for_bids','bidding_closed','awarded','scheduled','in_progress') THEN RAISE EXCEPTION 'Invalid shared enrollment request'; END IF;
 IF TG_OP='UPDATE' THEN
  IF ROW(NEW.token,NEW."requestId",NEW."communityTokenHash",NEW."requestTokenHash",NEW."createdAt",NEW."expiresAt") IS DISTINCT FROM ROW(OLD.token,OLD."requestId",OLD."communityTokenHash",OLD."requestTokenHash",OLD."createdAt",OLD."expiresAt") OR (OLD."userId" IS NOT NULL AND NEW."userId" IS DISTINCT FROM OLD."userId") THEN RAISE EXCEPTION 'Shared enrollment identity is immutable'; END IF;
  IF NEW."consentId"<>OLD."consentId" AND EXISTS(SELECT 1 FROM "EnrollmentBillingConsent" WHERE id=OLD."consentId" AND "revokedAt" IS NULL) THEN RAISE EXCEPTION 'Revoke previous consent before restarting'; END IF;
 END IF;
 IF NEW."expiresAt"<=clock_timestamp() THEN RAISE EXCEPTION 'Shared enrollment expired'; END IF;
 SELECT cs.token,rs.token INTO ct,rt FROM "RequestPublicShare" rs JOIN "CommunityPublicShare" cs ON cs."communityId"=r."communityId" JOIN "Community" c ON c.id=r."communityId" WHERE rs."requestId"=r.id AND rs.enabled AND c.type='hoa' AND c.status='active';
 IF ct IS NULL OR rt IS NULL OR encode(sha256(convert_to(ct,'UTF8')),'hex')<>NEW."communityTokenHash" OR encode(sha256(convert_to(rt,'UTF8')),'hex')<>NEW."requestTokenHash" THEN RAISE EXCEPTION 'Shared enrollment publication changed'; END IF;
 IF NEW."userId" IS NOT NULL THEN
  SELECT * INTO u FROM "User" WHERE id=NEW."userId" FOR SHARE;
  IF NOT FOUND OR u.role<>'homeowner' OR NOT u."isVerified" THEN RAISE EXCEPTION 'Verified homeowner required'; END IF;
 END IF;
 IF NEW."confirmedMembershipId" IS NOT NULL THEN
  SELECT * INTO m FROM "CommunityMembership" WHERE id=NEW."confirmedMembershipId" FOR SHARE;
  IF NOT FOUND OR m.status<>'active' OR m."userId" IS DISTINCT FROM NEW."userId" OR m."communityId"<>r."communityId" OR m."unitId" IS DISTINCT FROM NEW."confirmedUnitId" THEN RAISE EXCEPTION 'Shared enrollment home changed'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER shared_enrollment_flow_guard BEFORE INSERT OR UPDATE ON "SharedEnrollmentFlow" FOR EACH ROW EXECUTE FUNCTION shared_enrollment_flow_guard();
