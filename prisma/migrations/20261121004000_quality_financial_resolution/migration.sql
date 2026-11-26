ALTER TABLE "ServiceVisit" ADD COLUMN "redoOfVisitId" TEXT UNIQUE REFERENCES "ServiceVisit"("id") ON DELETE RESTRICT;
ALTER TABLE "ServiceQualityClaim"
 ADD COLUMN "financialPayerUserId" TEXT,
 ADD COLUMN "refundOperationId" TEXT UNIQUE REFERENCES "StripeTestRefund"("id") ON DELETE RESTRICT,
 ADD COLUMN "redoVisitId" TEXT UNIQUE REFERENCES "ServiceVisit"("id") ON DELETE RESTRICT,
 ADD COLUMN "resolvedAt" TIMESTAMP(3);
UPDATE "ServiceQualityClaim" q SET "financialPayerUserId"=v."billingPayerUserId" FROM "ServiceVisit" v WHERE v."id"=q."visitId";
ALTER TABLE "ServiceQualityClaim" DROP CONSTRAINT "ServiceQualityClaim_resolution_check";
ALTER TABLE "ServiceQualityClaim" ADD CONSTRAINT "ServiceQualityClaim_resolution_check" CHECK ("resolution" IN ('reported','redo_pending','refund_pending','redo_complete','refund_complete'));
ALTER TABLE "ServiceQualityClaim" ADD CHECK (("resolvedAt" IS NOT NULL)=("resolution" IN ('redo_complete','refund_complete')));
CREATE FUNCTION bundleen_quality_financial_identity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v "ServiceVisit"%ROWTYPE; p "StripeTestPayment"%ROWTYPE; r "StripeTestRefund"%ROWTYPE; redo "ServiceVisit"%ROWTYPE;
BEGIN
 SELECT * INTO v FROM "ServiceVisit" WHERE "id"=NEW."visitId" FOR UPDATE;
 SELECT * INTO p FROM "StripeTestPayment" WHERE "visitId"=NEW."visitId" FOR UPDATE;
 IF TG_OP='INSERT' THEN
  NEW."financialPayerUserId":=v."billingPayerUserId";
  IF NEW."resolution"<>'reported' OR NEW."refundOperationId" IS NOT NULL OR NEW."redoVisitId" IS NOT NULL THEN RAISE EXCEPTION 'New claims require intake before resolution'; END IF;
 ELSE
  IF ROW(NEW."visitId",NEW."ticketId",NEW."requesterUserId",NEW."providerUserId",NEW."financialPayerUserId") IS DISTINCT FROM ROW(OLD."visitId",OLD."ticketId",OLD."requesterUserId",OLD."providerUserId",OLD."financialPayerUserId") THEN RAISE EXCEPTION 'Claim identity is immutable'; END IF;
  IF OLD."refundOperationId" IS NOT NULL AND NEW."refundOperationId" IS DISTINCT FROM OLD."refundOperationId" OR OLD."redoVisitId" IS NOT NULL AND NEW."redoVisitId" IS DISTINCT FROM OLD."redoVisitId" THEN RAISE EXCEPTION 'Claim execution identity is immutable'; END IF;
  IF OLD."resolvedAt" IS NOT NULL AND ROW(NEW."resolution",NEW."resolvedAt") IS DISTINCT FROM ROW(OLD."resolution",OLD."resolvedAt") THEN RAISE EXCEPTION 'Resolved claim is immutable'; END IF;
 END IF;
 IF NEW."refundOperationId" IS NOT NULL THEN
  SELECT * INTO r FROM "StripeTestRefund" WHERE "id"=NEW."refundOperationId";
  IF NOT COALESCE(r."visitId"=NEW."visitId" AND r."reason"='service_quality' AND p."residentUserId"=NEW."financialPayerUserId" AND NEW."resolution" IN ('refund_pending','refund_complete') AND NEW."redoVisitId" IS NULL,false) THEN RAISE EXCEPTION 'Claim refund identity does not match'; END IF;
 END IF;
 IF NEW."redoVisitId" IS NOT NULL THEN
  SELECT * INTO redo FROM "ServiceVisit" WHERE "id"=NEW."redoVisitId";
  IF NOT COALESCE(redo."redoOfVisitId"=NEW."visitId" AND NEW."resolution" IN ('redo_pending','redo_complete') AND NEW."refundOperationId" IS NULL,false) THEN RAISE EXCEPTION 'Claim redo identity does not match'; END IF;
 END IF;
 IF NEW."resolution"='refund_complete' AND NOT COALESCE(r."state"='succeeded' AND r."stripeRefundId" IS NOT NULL AND (r."reversalCents"=0 OR r."stripeReversalId" IS NOT NULL),false) THEN RAISE EXCEPTION 'Refund and required reversal must finish'; END IF;
 IF NEW."resolution"='redo_complete' AND NOT COALESCE(redo."status"::text='completed' AND redo."completedAt" IS NOT NULL,false) THEN RAISE EXCEPTION 'Redo must actually complete'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "ServiceQualityClaim_financial_identity" BEFORE INSERT OR UPDATE ON "ServiceQualityClaim" FOR EACH ROW EXECUTE FUNCTION bundleen_quality_financial_identity();
CREATE FUNCTION bundleen_redo_identity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original "ServiceVisit"%ROWTYPE; original_agreement TEXT; new_agreement TEXT;
BEGIN
 IF TG_OP='UPDATE' AND NEW."redoOfVisitId" IS DISTINCT FROM OLD."redoOfVisitId" THEN RAISE EXCEPTION 'Redo identity is immutable'; END IF;
 IF NEW."redoOfVisitId" IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO original FROM "ServiceVisit" WHERE "id"=NEW."redoOfVisitId" FOR SHARE;
 SELECT "agreementId" INTO original_agreement FROM "ServiceOccurrence" WHERE "id"=original."occurrenceId";
 SELECT "agreementId" INTO new_agreement FROM "ServiceOccurrence" WHERE "id"=NEW."occurrenceId";
 IF original."redoOfVisitId" IS NOT NULL OR original."status"::text<>'completed' OR original_agreement IS DISTINCT FROM new_agreement OR NOT EXISTS(SELECT 1 FROM "ServiceAgreement" WHERE "id"=new_agreement AND "status"::text IN ('active','completed'))
 OR ROW(NEW."unitId",NEW."homeownerUserId",NEW."billingPayerUserId",NEW."requiresAfterPhoto",NEW."serviceLabel",NEW."serviceAddressLine1",NEW."serviceAddressLine2",NEW."serviceLocality",NEW."serviceRegion",NEW."servicePostalCode",NEW."serviceCountry",NEW."serviceLatitude",NEW."serviceLongitude",NEW."serviceAccessNotes") IS DISTINCT FROM ROW(original."unitId",original."homeownerUserId",original."billingPayerUserId",original."requiresAfterPhoto",original."serviceLabel",original."serviceAddressLine1",original."serviceAddressLine2",original."serviceLocality",original."serviceRegion",original."servicePostalCode",original."serviceCountry",original."serviceLatitude",original."serviceLongitude",original."serviceAccessNotes")
 OR NEW."allocatedVisitCents" IS DISTINCT FROM 0 OR NOT EXISTS(SELECT 1 FROM "ServiceQualityClaim" WHERE "visitId"=original."id" AND "resolution"='redo_pending') THEN RAISE EXCEPTION 'Redo must preserve original scope and be free'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "ServiceVisit_redo_identity" BEFORE INSERT OR UPDATE ON "ServiceVisit" FOR EACH ROW EXECUTE FUNCTION bundleen_redo_identity();
CREATE FUNCTION bundleen_no_redo_charge() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM "ServiceVisit" WHERE "id"=NEW."visitId" AND "redoOfVisitId" IS NOT NULL) THEN RAISE EXCEPTION 'Redo visits cannot be charged'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "StripeTestPayment_no_redo" BEFORE INSERT ON "StripeTestPayment" FOR EACH ROW EXECUTE FUNCTION bundleen_no_redo_charge();
CREATE FUNCTION bundleen_no_redo_charge_outbox() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."kind"='stripe_test_visit_charge' AND EXISTS(SELECT 1 FROM "ServiceVisit" WHERE "id"=NEW."payload"->>'visitId' AND "redoOfVisitId" IS NOT NULL) THEN RAISE EXCEPTION 'Redo visits cannot enqueue charges'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "OutboxEvent_no_redo_charge" BEFORE INSERT OR UPDATE ON "OutboxEvent" FOR EACH ROW EXECUTE FUNCTION bundleen_no_redo_charge_outbox();

CREATE OR REPLACE FUNCTION bundleen_assert_visit_photo_provider(actor_id TEXT, visit_id TEXT) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v "ServiceVisit"%ROWTYPE; a "ServiceAgreement"%ROWTYPE; occurrence_status TEXT;
BEGIN
  SELECT * INTO v FROM "ServiceVisit" WHERE "id" = visit_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Service visit is unavailable' USING ERRCODE = 'P1711'; END IF;
  SELECT agreement.* INTO a FROM "ServiceOccurrence" occurrence
    JOIN "ServiceAgreement" agreement ON agreement."id" = occurrence."agreementId"
    WHERE occurrence."id" = v."occurrenceId" FOR SHARE OF occurrence, agreement;
  SELECT "status"::text INTO occurrence_status FROM "ServiceOccurrence" WHERE "id" = v."occurrenceId";
  IF a."providerUserId" IS DISTINCT FROM actor_id OR (a."status"::text <> 'active' AND NOT (a."status"::text='completed' AND v."redoOfVisitId" IS NOT NULL)) OR
     v."status"::text NOT IN ('scheduled','en_route','in_progress') OR occurrence_status IN ('completed','cancelled') THEN
    RAISE EXCEPTION 'Current awarded provider and a live scheduled visit are required' USING ERRCODE = 'P1711';
  END IF;
  PERFORM 1 FROM "Community" WHERE "id" = a."communityId" AND "status" = 'active' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Service community is no longer active' USING ERRCODE = 'P1711'; END IF;
  PERFORM 1 FROM "User" WHERE "id" = actor_id AND "role" = 'provider' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Provider identity changed' USING ERRCODE = 'P1711'; END IF;
  PERFORM 1 FROM "ProviderProfile" WHERE "userId" = actor_id AND "accountStatus" = 'active' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Provider account is no longer active' USING ERRCODE = 'P1711'; END IF;
END;
$$;


ALTER TABLE "StripeTestPayment" ADD COLUMN "transferAmountCents" INTEGER, ADD COLUMN "transferRefundedBeforeCents" INTEGER;
-- Historical transfer attempts always targeted the full original share.
UPDATE "StripeTestPayment" SET "transferAmountCents"="providerAmountCents", "transferRefundedBeforeCents"=0 WHERE "transferAttemptedAt" IS NOT NULL OR "stripeTransferId" IS NOT NULL;
ALTER TABLE "StripeTestPayment" ADD CHECK (("transferAmountCents" IS NULL)=("transferRefundedBeforeCents" IS NULL));
ALTER TABLE "StripeTestPayment" ADD CHECK ("transferAmountCents" IS NULL OR ("transferRefundedBeforeCents" BETWEEN 0 AND "amountCents" AND "transferAmountCents"="providerAmountCents"-floor("providerAmountCents"::numeric*"transferRefundedBeforeCents"/"amountCents") AND "transferAmountCents">0 AND "providerReversedCents"<="transferAmountCents"));
CREATE FUNCTION bundleen_transfer_amount_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' AND (NEW."transferAttemptedAt" IS NOT NULL OR NEW."stripeTransferId" IS NOT NULL OR NEW."transferAmountCents" IS NOT NULL OR NEW."transferRefundedBeforeCents" IS NOT NULL) THEN RAISE EXCEPTION 'New payments require unattempted transfer state'; END IF;
 IF TG_OP='UPDATE' AND OLD."transferAmountCents" IS NOT NULL AND ROW(NEW."transferAmountCents",NEW."transferRefundedBeforeCents") IS DISTINCT FROM ROW(OLD."transferAmountCents",OLD."transferRefundedBeforeCents") THEN RAISE EXCEPTION 'Transfer amount snapshot is immutable'; END IF;
 IF (TG_OP='INSERT' OR OLD."transferAmountCents" IS NULL) AND NEW."transferAmountCents" IS NOT NULL AND (NEW."transferRefundedBeforeCents"<>NEW."amountRefundedCents" OR NEW."transferAttemptedAt" IS NULL) THEN RAISE EXCEPTION 'Transfer reservation must match settled refund balance'; END IF;
 IF (NEW."transferAttemptedAt" IS NOT NULL OR NEW."stripeTransferId" IS NOT NULL) AND NEW."transferAmountCents" IS NULL THEN RAISE EXCEPTION 'Transfer requires frozen amount'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "StripeTestPayment_transfer_amount_identity" BEFORE INSERT OR UPDATE ON "StripeTestPayment" FOR EACH ROW EXECUTE FUNCTION bundleen_transfer_amount_identity();
CREATE FUNCTION bundleen_quality_no_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Quality resolution audit history cannot be deleted'; END $$;
CREATE TRIGGER "ServiceQualityClaim_no_delete" BEFORE DELETE ON "ServiceQualityClaim" FOR EACH ROW EXECUTE FUNCTION bundleen_quality_no_delete();
CREATE TRIGGER "ServiceQualityClaim_no_truncate" BEFORE TRUNCATE ON "ServiceQualityClaim" FOR EACH STATEMENT EXECUTE FUNCTION bundleen_quality_no_delete();
