ALTER TABLE "HoaServiceRequest" ADD COLUMN "stripeTestEnrollmentRequired" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "HoaRequestParticipation" ADD COLUMN "enrollmentConsentId" TEXT;
ALTER TABLE "StripeTestPayment" ADD COLUMN "enrollmentAuthorizationId" TEXT;
CREATE TABLE "EnrollmentBillingConsent" (
 "id" TEXT PRIMARY KEY, "requestId" TEXT NOT NULL REFERENCES "HoaServiceRequest"("id") ON DELETE RESTRICT,
 "payerUserId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT, "unitId" TEXT NOT NULL REFERENCES "CommunityUnit"("id") ON DELETE RESTRICT,
 "membershipId" TEXT NOT NULL REFERENCES "CommunityMembership"("id") ON DELETE RESTRICT,
 "commitmentId" TEXT NOT NULL REFERENCES "PriceLadderCommitment"("id") ON DELETE RESTRICT,
 "providerUserId" TEXT NOT NULL, "maximumCents" INTEGER NOT NULL CHECK("maximumCents">=50), "currency" TEXT NOT NULL CHECK("currency"='usd'),
 "termsToken" TEXT NOT NULL, "termsVersion" TEXT NOT NULL CHECK("termsVersion"='capped-completed-visit-v1'),
 "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "revokedAt" TIMESTAMP(3)
);
CREATE INDEX "EnrollmentBillingConsent_requestId_payerUserId_idx" ON "EnrollmentBillingConsent"("requestId","payerUserId");
CREATE TABLE "EnrollmentBillingCard" (
 "consentId" TEXT PRIMARY KEY REFERENCES "EnrollmentBillingConsent"("id") ON DELETE RESTRICT,
 "customerId" TEXT NOT NULL, "paymentMethodId" TEXT NOT NULL, "setupIntentId" TEXT NOT NULL UNIQUE,
 "brand" TEXT NOT NULL, "last4" TEXT NOT NULL, "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "AgreementBillingAuthorization" (
 "id" TEXT PRIMARY KEY, "agreementId" TEXT NOT NULL REFERENCES "ServiceAgreement"("id") ON DELETE RESTRICT,
 "enrollmentConsentId" TEXT NOT NULL UNIQUE REFERENCES "EnrollmentBillingConsent"("id") ON DELETE RESTRICT,
 "payerUserId" TEXT NOT NULL, "unitId" TEXT NOT NULL, "authorizedTotalCents" INTEGER NOT NULL CHECK("authorizedTotalCents">=0),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE("agreementId","unitId")
);
ALTER TABLE "HoaRequestParticipation" ADD CONSTRAINT "HoaParticipation_enrollment_consent" FOREIGN KEY("enrollmentConsentId") REFERENCES "EnrollmentBillingConsent"("id") ON DELETE RESTRICT;
ALTER TABLE "StripeTestPayment" ADD CONSTRAINT "StripePayment_enrollment_authorization" FOREIGN KEY("enrollmentAuthorizationId") REFERENCES "AgreementBillingAuthorization"("id") ON DELETE RESTRICT;

CREATE FUNCTION bundleen_enrollment_policy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD."stripeTestEnrollmentRequired" AND NOT NEW."stripeTestEnrollmentRequired" THEN RAISE EXCEPTION 'Enrollment billing policy cannot be removed'; END IF;
 IF NOT OLD."stripeTestEnrollmentRequired" AND NEW."stripeTestEnrollmentRequired" THEN
  IF NEW."kind"::text<>'optional_group' OR NEW."status"::text<>'collecting_interest' OR NEW."participantsLockedAt" IS NOT NULL
   OR NOT EXISTS(SELECT 1 FROM "Community" WHERE "id"=NEW."communityId" AND "type"::text='hoa')
   OR NOT EXISTS(SELECT 1 FROM "PriceLadderCommitment" WHERE "requestId"=NEW."id" AND "acceptedAt" IS NOT NULL)
   OR EXISTS(SELECT 1 FROM "HoaRequestParticipation" WHERE "requestId"=NEW."id") THEN
   RAISE EXCEPTION 'Enable billing only before enrollment begins on an accepted HOA commitment';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "HoaRequest_enrollment_policy" BEFORE UPDATE ON "HoaServiceRequest" FOR EACH ROW EXECUTE FUNCTION bundleen_enrollment_policy();

CREATE FUNCTION bundleen_protect_enrollment_consent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'UPDATE' THEN RAISE EXCEPTION 'Enrollment authorization audit cannot be deleted'; END IF;
 PERFORM 1 FROM "HoaServiceRequest" WHERE "id"=OLD."requestId" FOR UPDATE;
 IF (to_jsonb(NEW)-'revokedAt') IS DISTINCT FROM (to_jsonb(OLD)-'revokedAt') OR OLD."revokedAt" IS NOT NULL
  OR NEW."revokedAt" IS NULL OR EXISTS(SELECT 1 FROM "AgreementBillingAuthorization" WHERE "enrollmentConsentId"=OLD."id") THEN
  RAISE EXCEPTION 'Enrollment authorization is immutable after award';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "EnrollmentConsent_protect" BEFORE UPDATE OR DELETE ON "EnrollmentBillingConsent" FOR EACH ROW EXECUTE FUNCTION bundleen_protect_enrollment_consent();
CREATE TRIGGER "EnrollmentConsent_no_truncate" BEFORE TRUNCATE ON "EnrollmentBillingConsent" FOR EACH STATEMENT EXECUTE FUNCTION protect_stripe_test_payment_attempt();
CREATE TRIGGER "EnrollmentCard_immutable" BEFORE UPDATE OR DELETE ON "EnrollmentBillingCard" FOR EACH ROW EXECUTE FUNCTION protect_stripe_test_payment_attempt();
CREATE TRIGGER "EnrollmentCard_no_truncate" BEFORE TRUNCATE ON "EnrollmentBillingCard" FOR EACH STATEMENT EXECUTE FUNCTION protect_stripe_test_payment_attempt();
CREATE TRIGGER "AgreementAuthorization_immutable" BEFORE UPDATE OR DELETE ON "AgreementBillingAuthorization" FOR EACH ROW EXECUTE FUNCTION protect_stripe_test_payment_attempt();
CREATE TRIGGER "AgreementAuthorization_no_truncate" BEFORE TRUNCATE ON "AgreementBillingAuthorization" FOR EACH STATEMENT EXECUTE FUNCTION protect_stripe_test_payment_attempt();

CREATE FUNCTION bundleen_validate_enrollment_join() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r "HoaServiceRequest"%ROWTYPE; e "EnrollmentBillingConsent"%ROWTYPE; card "EnrollmentBillingCard"%ROWTYPE; m "CommunityMembership"%ROWTYPE; customer TEXT;
BEGIN
 IF TG_OP='UPDATE' AND (NEW."requestId" IS DISTINCT FROM OLD."requestId" OR NEW."unitId" IS DISTINCT FROM OLD."unitId") AND EXISTS(SELECT 1 FROM "HoaServiceRequest" WHERE "id"=OLD."requestId" AND "stripeTestEnrollmentRequired") THEN RAISE EXCEPTION 'Protected enrollment identity is immutable'; END IF;
 SELECT * INTO r FROM "HoaServiceRequest" WHERE "id"=COALESCE(NEW."requestId",OLD."requestId") FOR UPDATE;
 IF NOT r."stripeTestEnrollmentRequired" THEN IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF; END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Decline enrolled participation instead of deleting its audit'; END IF;
 IF TG_OP='UPDATE' AND OLD."response"::text='joined' AND NEW."response"::text='joined' AND NEW."enrollmentConsentId" IS DISTINCT FROM OLD."enrollmentConsentId" THEN
  RAISE EXCEPTION 'Withdraw before replacing enrollment authorization';
 END IF;
 IF NEW."response"::text<>'joined' THEN
  IF EXISTS(SELECT 1 FROM "ServiceAgreement" WHERE "requestId"=r."id") THEN RAISE EXCEPTION 'Awarded authorization cannot be revoked'; END IF;
  UPDATE "EnrollmentBillingConsent" SET "revokedAt"=clock_timestamp() WHERE "requestId"=r."id" AND "unitId"=NEW."unitId" AND "revokedAt" IS NULL;
  NEW."enrollmentConsentId":=NULL;
  RETURN NEW;
 END IF;
 SELECT * INTO e FROM "EnrollmentBillingConsent" WHERE "id"=NEW."enrollmentConsentId" FOR SHARE;
 SELECT * INTO card FROM "EnrollmentBillingCard" WHERE "consentId"=e."id" FOR SHARE;
 SELECT "stripeTestCustomerId" INTO customer FROM "User" WHERE "id"=NEW."userId" FOR SHARE;
 SELECT * INTO m FROM "CommunityMembership" WHERE "id"=e."membershipId" FOR SHARE;
 IF NOT COALESCE(r."status"::text='collecting_interest' AND r."participantsLockedAt" IS NULL AND (r."enrollmentClosesAt" IS NULL OR r."enrollmentClosesAt">clock_timestamp()) AND e."requestId"=r."id" AND e."payerUserId"=NEW."userId" AND e."unitId"=NEW."unitId" AND e."revokedAt" IS NULL
  AND m."userId"=NEW."userId" AND m."unitId"=NEW."unitId" AND m."communityId"=r."communityId" AND m."status"::text='active'
  AND card."customerId"=customer AND card."verifiedAt">=e."acceptedAt"
  AND NEW."maximumPriceCents"<=e."maximumCents"
  AND EXISTS(SELECT 1 FROM "PriceLadderCommitment" c WHERE c."id"=e."commitmentId" AND c."requestId"=r."id" AND c."providerUserId"=e."providerUserId" AND c."acceptedAt" IS NOT NULL AND c."guaranteedPerHomeCents"<=e."maximumCents"),false)
 THEN RAISE EXCEPTION 'Verified enrollment card and current capped consent required' USING ERRCODE='P1744'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "zzz_HoaParticipation_enrollment" BEFORE INSERT OR UPDATE OR DELETE ON "HoaRequestParticipation" FOR EACH ROW EXECUTE FUNCTION bundleen_validate_enrollment_join();

CREATE FUNCTION bundleen_award_enrollment_authorizations() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r "HoaServiceRequest"%ROWTYPE; p RECORD; e "EnrollmentBillingConsent"%ROWTYPE; card "EnrollmentBillingCard"%ROWTYPE; homes INTEGER:=0;
BEGIN
 SELECT * INTO r FROM "HoaServiceRequest" WHERE "id"=NEW."requestId" FOR UPDATE;
 IF NOT r."stripeTestEnrollmentRequired" THEN RETURN NEW; END IF;
 PERFORM bundleen_assert_stripe_test_award_payouts(NEW."providerUserId", (SELECT "stripeTestAccountId" FROM "ProviderProfile" WHERE "userId"=NEW."providerUserId"));
 IF NEW."pricingBasis"::text<>'per_home' OR NEW."perHomeCents" IS NULL OR NEW."currency"<>'usd' THEN RAISE EXCEPTION 'Capped enrollment requires committed per-home award'; END IF;
 FOR p IN SELECT * FROM "HoaRequestParticipation" WHERE "requestId"=r."id" AND "response"::text='joined' ORDER BY "id" FOR SHARE LOOP
  SELECT * INTO e FROM "EnrollmentBillingConsent" WHERE "id"=p."enrollmentConsentId" FOR SHARE;
  SELECT * INTO card FROM "EnrollmentBillingCard" WHERE "consentId"=e."id" FOR SHARE;
  PERFORM 1 FROM "User" WHERE "id"=e."payerUserId" FOR SHARE;
  PERFORM 1 FROM "CommunityMembership" WHERE "id"=e."membershipId" FOR SHARE;
  IF NOT COALESCE(e."requestId"=r."id" AND e."payerUserId"=p."userId" AND e."unitId"=p."unitId" AND e."providerUserId"=NEW."providerUserId"
   AND e."revokedAt" IS NULL AND card."consentId"=e."id" AND EXISTS(SELECT 1 FROM "User" WHERE "id"=e."payerUserId" AND "stripeTestCustomerId"=card."customerId") AND NEW."perHomeCents"<=e."maximumCents" AND NEW."perHomeCents"<=p."maximumPriceCents"
   AND EXISTS(SELECT 1 FROM "CommunityMembership" m WHERE m."id"=e."membershipId" AND m."status"::text='active' AND m."userId"=e."payerUserId" AND m."unitId"=e."unitId"),false)
  THEN RAISE EXCEPTION 'Every household needs valid capped enrollment authorization' USING ERRCODE='P1744'; END IF;
  homes:=homes+1;
  INSERT INTO "AgreementBillingAuthorization"("id","agreementId","enrollmentConsentId","payerUserId","unitId","authorizedTotalCents")
   VALUES(NEW."id"||':'||e."id",NEW."id",e."id",e."payerUserId",e."unitId",NEW."perHomeCents");
 END LOOP;
 IF homes<>NEW."lockedHomeCount" OR homes<COALESCE(r."minHomes",1) OR homes::bigint*NEW."perHomeCents"<>NEW."amountCents" THEN RAISE EXCEPTION 'Award household totals do not match consent'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "zzz_Agreement_enrollment" AFTER INSERT ON "ServiceAgreement" FOR EACH ROW EXECUTE FUNCTION bundleen_award_enrollment_authorizations();
CREATE FUNCTION bundleen_payment_enrollment_identity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a "AgreementBillingAuthorization"%ROWTYPE; e "EnrollmentBillingConsent"%ROWTYPE;
BEGIN
 IF TG_OP='UPDATE' AND NEW."enrollmentAuthorizationId" IS DISTINCT FROM OLD."enrollmentAuthorizationId" THEN RAISE EXCEPTION 'Payment authorization identity is immutable'; END IF;
 IF NEW."enrollmentAuthorizationId" IS NOT NULL THEN
  SELECT * INTO a FROM "AgreementBillingAuthorization" WHERE "id"=NEW."enrollmentAuthorizationId";
  SELECT * INTO e FROM "EnrollmentBillingConsent" WHERE "id"=a."enrollmentConsentId";
  IF NOT COALESCE(a."agreementId"=NEW."agreementId" AND a."payerUserId"=NEW."residentUserId" AND a."unitId"=NEW."unitId" AND e."termsToken"=NEW."termsToken" AND e."requestId"=NEW."requestId" AND e."providerUserId"=NEW."providerUserId" AND e."currency"=NEW."currency"
   AND EXISTS(SELECT 1 FROM "EnrollmentBillingCard" c WHERE c."consentId"=e."id" AND c."customerId"=NEW."customerId" AND c."paymentMethodId"=NEW."paymentMethodId")
   AND EXISTS(SELECT 1 FROM "ServiceVisit" v JOIN "ServiceOccurrence" o ON o."id"=v."occurrenceId" WHERE v."id"=NEW."visitId" AND v."unitId"=NEW."unitId" AND v."billingPayerUserId"=NEW."residentUserId" AND o."agreementId"=NEW."agreementId" AND v."allocatedVisitCents"=NEW."amountCents")
   AND EXISTS(SELECT 1 FROM "ServiceAgreement" g WHERE g."id"=NEW."agreementId" AND g."requestId"=NEW."requestId" AND g."communityId"=NEW."communityId" AND g."providerUserId"=NEW."providerUserId" AND g."currency"=NEW."currency"),false) THEN RAISE EXCEPTION 'Payment authorization does not match'; END IF;
 ELSIF EXISTS(SELECT 1 FROM "HoaServiceRequest" WHERE "id"=NEW."requestId" AND "stripeTestEnrollmentRequired") THEN RAISE EXCEPTION 'Protected payment requires enrollment authorization'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "StripePayment_enrollment_identity" BEFORE INSERT OR UPDATE ON "StripeTestPayment" FOR EACH ROW EXECUTE FUNCTION bundleen_payment_enrollment_identity();

CREATE FUNCTION bundleen_enrollment_consent_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r "HoaServiceRequest"%ROWTYPE;
BEGIN
 SELECT * INTO r FROM "HoaServiceRequest" WHERE "id"=NEW."requestId" FOR UPDATE;
 PERFORM 1 FROM "User" WHERE "id"=NEW."payerUserId" FOR SHARE;
 PERFORM 1 FROM "Community" WHERE "id"=r."communityId" FOR SHARE;
 PERFORM 1 FROM "CommunityMembership" WHERE "id"=NEW."membershipId" FOR SHARE;
 IF NOT COALESCE(r."stripeTestEnrollmentRequired" AND r."status"::text='collecting_interest' AND r."participantsLockedAt" IS NULL
  AND (r."enrollmentClosesAt" IS NULL OR r."enrollmentClosesAt">clock_timestamp())
  AND EXISTS(SELECT 1 FROM "CommunityMembership" m JOIN "User" u ON u."id"=m."userId" JOIN "Community" c ON c."id"=m."communityId"
    WHERE m."id"=NEW."membershipId" AND m."userId"=NEW."payerUserId" AND m."unitId"=NEW."unitId" AND m."communityId"=r."communityId" AND m."status"::text='active' AND u."role"::text='homeowner' AND c."status"::text='active')
  AND EXISTS(SELECT 1 FROM "PriceLadderCommitment" c WHERE c."id"=NEW."commitmentId" AND c."requestId"=r."id" AND c."providerUserId"=NEW."providerUserId" AND c."acceptedAt" IS NOT NULL AND c."guaranteedPerHomeCents"=NEW."maximumCents"),false)
 THEN RAISE EXCEPTION 'Enrollment consent does not match current offer'; END IF;
 NEW."acceptedAt":=clock_timestamp(); RETURN NEW;
END $$;
CREATE TRIGGER "EnrollmentConsent_identity" BEFORE INSERT ON "EnrollmentBillingConsent" FOR EACH ROW EXECUTE FUNCTION bundleen_enrollment_consent_insert();
CREATE FUNCTION bundleen_enrollment_card_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e "EnrollmentBillingConsent"%ROWTYPE;
BEGIN
 SELECT * INTO e FROM "EnrollmentBillingConsent" WHERE "id"=NEW."consentId";
 PERFORM 1 FROM "HoaServiceRequest" WHERE "id"=e."requestId" FOR UPDATE;
 PERFORM 1 FROM "User" WHERE "id"=e."payerUserId" FOR SHARE;
 SELECT * INTO e FROM "EnrollmentBillingConsent" WHERE "id"=NEW."consentId" FOR SHARE;
 IF e."revokedAt" IS NOT NULL OR NOT EXISTS(SELECT 1 FROM "User" WHERE "id"=e."payerUserId" AND "stripeTestCustomerId"=NEW."customerId") THEN RAISE EXCEPTION 'Enrollment card customer changed'; END IF;
 NEW."verifiedAt":=clock_timestamp(); RETURN NEW;
END $$;
CREATE TRIGGER "EnrollmentCard_identity" BEFORE INSERT ON "EnrollmentBillingCard" FOR EACH ROW EXECUTE FUNCTION bundleen_enrollment_card_insert();

CREATE FUNCTION bundleen_protected_visit_authorization() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE agreement_id TEXT; protected BOOLEAN; a "AgreementBillingAuthorization"%ROWTYPE; allocated BIGINT;
BEGIN
 SELECT g."id", r."stripeTestEnrollmentRequired" INTO agreement_id, protected FROM "ServiceOccurrence" o JOIN "ServiceAgreement" g ON g."id"=o."agreementId" JOIN "HoaServiceRequest" r ON r."id"=g."requestId" WHERE o."id"=NEW."occurrenceId";
 IF NOT protected THEN RETURN NEW; END IF;
 SELECT * INTO a FROM "AgreementBillingAuthorization" WHERE "agreementId"=agreement_id AND "unitId"=NEW."unitId";
 IF NOT COALESCE(a."payerUserId"=NEW."billingPayerUserId" AND NEW."allocatedVisitCents" IS NOT NULL,false) THEN RAISE EXCEPTION 'Visit requires original enrollment authorization'; END IF;
 SELECT SUM(v."allocatedVisitCents") INTO allocated FROM "ServiceVisit" v JOIN "ServiceOccurrence" o ON o."id"=v."occurrenceId" WHERE o."agreementId"=agreement_id AND v."unitId"=NEW."unitId";
 IF allocated>a."authorizedTotalCents" THEN RAISE EXCEPTION 'Visit allocations exceed authorized total'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER "ServiceVisit_enrollment_authorization" AFTER INSERT OR UPDATE ON "ServiceVisit" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION bundleen_protected_visit_authorization();

-- Serialize all protected visit writers on the agreement before inserting any
-- allocation; the deferred aggregate check then sees the prior writer's commit.
CREATE FUNCTION bundleen_lock_protected_visit_parent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND ROW(NEW."occurrenceId",NEW."unitId",NEW."billingPayerUserId",NEW."allocatedVisitCents") IS DISTINCT FROM ROW(OLD."occurrenceId",OLD."unitId",OLD."billingPayerUserId",OLD."allocatedVisitCents")
  AND EXISTS(SELECT 1 FROM "ServiceOccurrence" o JOIN "ServiceAgreement" g ON g."id"=o."agreementId" JOIN "HoaServiceRequest" r ON r."id"=g."requestId" WHERE o."id" IN (OLD."occurrenceId",NEW."occurrenceId") AND r."stripeTestEnrollmentRequired") THEN RAISE EXCEPTION 'Protected visit allocation identity is immutable'; END IF;
 PERFORM g."id" FROM "ServiceOccurrence" o JOIN "ServiceAgreement" g ON g."id"=o."agreementId" JOIN "HoaServiceRequest" r ON r."id"=g."requestId"
  WHERE o."id"=NEW."occurrenceId" AND r."stripeTestEnrollmentRequired" FOR UPDATE OF g;
 RETURN NEW;
END $$;
CREATE TRIGGER "ServiceVisit_enrollment_parent_lock" BEFORE INSERT OR UPDATE ON "ServiceVisit" FOR EACH ROW EXECUTE FUNCTION bundleen_lock_protected_visit_parent();
CREATE FUNCTION bundleen_validate_agreement_authorization() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE g "ServiceAgreement"%ROWTYPE; e "EnrollmentBillingConsent"%ROWTYPE;
BEGIN
 SELECT * INTO g FROM "ServiceAgreement" WHERE "id"=NEW."agreementId" FOR UPDATE;
 SELECT * INTO e FROM "EnrollmentBillingConsent" WHERE "id"=NEW."enrollmentConsentId" FOR SHARE;
 IF NOT COALESCE(e."revokedAt" IS NULL AND e."requestId"=g."requestId" AND e."providerUserId"=g."providerUserId" AND e."currency"=g."currency"
  AND e."payerUserId"=NEW."payerUserId" AND e."unitId"=NEW."unitId" AND NEW."authorizedTotalCents"=g."perHomeCents" AND NEW."authorizedTotalCents"<=e."maximumCents"
  AND EXISTS(SELECT 1 FROM "EnrollmentBillingCard" WHERE "consentId"=e."id")
  AND EXISTS(SELECT 1 FROM "HoaRequestParticipation" p WHERE p."requestId"=g."requestId" AND p."response"::text='joined' AND p."unitId"=NEW."unitId" AND p."userId"=NEW."payerUserId" AND p."enrollmentConsentId"=e."id")
  AND EXISTS(SELECT 1 FROM "HoaServiceRequest" WHERE "id"=g."requestId" AND "stripeTestEnrollmentRequired"),false)
 THEN RAISE EXCEPTION 'Agreement authorization source does not match'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "AgreementAuthorization_identity" BEFORE INSERT ON "AgreementBillingAuthorization" FOR EACH ROW EXECUTE FUNCTION bundleen_validate_agreement_authorization();
