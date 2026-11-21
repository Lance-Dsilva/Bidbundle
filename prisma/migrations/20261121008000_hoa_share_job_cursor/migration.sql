CREATE OR REPLACE FUNCTION hoa_payment_snapshot_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cap integer; count integer; seq integer; expected integer;
BEGIN
 IF TG_OP='UPDATE' AND ROW(NEW."hoaRevenueShareBps",NEW."hoaShareCents",NEW."residentSavingsCents") IS DISTINCT FROM ROW(OLD."hoaRevenueShareBps",OLD."hoaShareCents",OLD."residentSavingsCents") THEN RAISE EXCEPTION 'HOA payment snapshot is immutable'; END IF;
 PERFORM 1 FROM "Community" WHERE "id"=NEW."communityId" FOR UPDATE;
 IF TG_OP='INSERT' AND NOT EXISTS(SELECT 1 FROM "Community" WHERE "id"=NEW."communityId" AND "type"='hoa' AND "hoaRevenueShareBps"=coalesce(NEW."hoaRevenueShareBps",0)) THEN RAISE EXCEPTION 'HOA rate snapshot mismatch'; END IF;
 IF TG_OP='INSERT' THEN
  IF (NEW."hoaShareCents">0 OR NEW."residentSavingsCents">0) AND NOT EXISTS(SELECT 1 FROM "ServiceVisit" v JOIN "ServiceOccurrence" o ON o."id"=v."occurrenceId" JOIN "ServiceAgreement" a ON a."id"=o."agreementId" JOIN "HoaServiceRequest" r ON r."id"=a."requestId" WHERE v."id"=NEW."visitId" AND a."id"=NEW."agreementId" AND a."communityId"=NEW."communityId" AND a."requestId"=NEW."requestId" AND a."providerUserId"=NEW."providerUserId" AND v."billingPayerUserId"=NEW."residentUserId" AND v."unitId"=NEW."unitId" AND v."allocatedVisitCents"=NEW."amountCents" AND r."kind"='optional_group' AND v."status"='completed' AND v."completedAt" IS NOT NULL AND v."redoOfVisitId" IS NULL) THEN RAISE EXCEPTION 'HOA revenue requires original completed resident visit'; END IF;
  expected:=0;
  IF NEW."enrollmentAuthorizationId" IS NOT NULL THEN
   SELECT c."maximumCents",r."totalOccurrences",o."sequence" INTO cap,count,seq FROM "AgreementBillingAuthorization" a JOIN "EnrollmentBillingConsent" c ON c."id"=a."enrollmentConsentId" JOIN "HoaServiceRequest" r ON r."id"=c."requestId" JOIN "ServiceVisit" v ON v."id"=NEW."visitId" JOIN "ServiceOccurrence" o ON o."id"=v."occurrenceId" WHERE a."id"=NEW."enrollmentAuthorizationId";
   IF count>0 THEN expected:=greatest(0,cap/count+CASE WHEN seq<=cap%count THEN 1 ELSE 0 END-NEW."amountCents"); END IF;
  END IF;
  IF NEW."residentSavingsCents"<>expected THEN RAISE EXCEPTION 'Resident savings snapshot mismatch'; END IF;
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION hoa_entry_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p "StripeTestPayment"; r integer; old_h bigint; old_s bigint; seq integer;
BEGIN
 SELECT * INTO p FROM "StripeTestPayment" WHERE "visitId"=NEW."paymentVisitId" FOR UPDATE;
 PERFORM 1 FROM "Community" WHERE "id"=p."communityId" FOR UPDATE;
 IF p."communityId" IS DISTINCT FROM NEW."communityId" OR p."status" NOT IN ('succeeded','partially_refunded','refunded') OR NOT EXISTS(SELECT 1 FROM "ServiceVisit" WHERE "id"=p."visitId" AND "status"='completed' AND "completedAt" IS NOT NULL AND "redoOfVisitId" IS NULL) THEN RAISE EXCEPTION 'No completed paid HOA revenue'; END IF;
 r:=greatest(p."amountRefundedCents",p."observedChargeRefundedCents");
 SELECT coalesce(sum("amountCents"),0),coalesce(sum("savingsCents"),0),coalesce(max("sequence"),0)+1 INTO old_h,old_s,seq FROM "HoaShareEntry" WHERE "paymentVisitId"=p."visitId";
 IF NEW."kind"<>(CASE WHEN seq=1 THEN 'earned' ELSE 'refund_adjustment' END) OR NEW."sequence"<>seq OR NEW."refundedCents"<>r OR NEW."amountCents"<>p."hoaShareCents"-(p."hoaShareCents"::bigint*r/p."amountCents")-old_h OR NEW."savingsCents"<>p."residentSavingsCents"-(p."residentSavingsCents"::bigint*r/p."amountCents")-old_s OR (NEW."amountCents"=0 AND NEW."savingsCents"=0) THEN RAISE EXCEPTION 'HOA earned ledger mismatch'; END IF;
 NEW."createdAt":=clock_timestamp(); RETURN NEW;
END $$;
CREATE TABLE "HoaShareJobCursor" ("id" TEXT PRIMARY KEY, "lastCommunityId" TEXT, "updatedAt" TIMESTAMP(3) NOT NULL);
