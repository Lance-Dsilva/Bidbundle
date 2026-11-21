-- Draft follow-up: worker cursor and claim execution linkage.
CREATE TABLE "RecurringFinancialCursor"(id text PRIMARY KEY,"lastKey" text,"updatedAt" timestamp(3) NOT NULL);

ALTER TABLE "ServiceQualityClaim" ADD COLUMN "recurringRefundOperationId" text UNIQUE REFERENCES "RecurringChargeRefund"(id) ON DELETE RESTRICT;
CREATE OR REPLACE FUNCTION bundleen_quality_financial_identity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v "ServiceVisit"%ROWTYPE; p "StripeTestPayment"%ROWTYPE; r "StripeTestRefund"%ROWTYPE; redo "ServiceVisit"%ROWTYPE; rr "RecurringChargeRefund"; rc "RecurringCharge"; rl "RecurringChargeLine";
BEGIN
 SELECT * INTO v FROM "ServiceVisit" WHERE "id"=NEW."visitId" FOR UPDATE;
 SELECT * INTO p FROM "StripeTestPayment" WHERE "visitId"=NEW."visitId" FOR UPDATE;
 IF TG_OP='INSERT' THEN
  NEW."financialPayerUserId":=v."billingPayerUserId";
  IF NEW."resolution"<>'reported' OR NEW."recurringRefundOperationId" IS NOT NULL OR NEW."refundOperationId" IS NOT NULL OR NEW."redoVisitId" IS NOT NULL THEN RAISE EXCEPTION 'New claims require intake before resolution'; END IF;
 ELSE
  IF ROW(NEW."visitId",NEW."ticketId",NEW."requesterUserId",NEW."providerUserId",NEW."financialPayerUserId") IS DISTINCT FROM ROW(OLD."visitId",OLD."ticketId",OLD."requesterUserId",OLD."providerUserId",OLD."financialPayerUserId") THEN RAISE EXCEPTION 'Claim identity is immutable'; END IF;
  IF OLD."recurringRefundOperationId" IS NOT NULL AND NEW."recurringRefundOperationId" IS DISTINCT FROM OLD."recurringRefundOperationId" THEN RAISE EXCEPTION 'Recurring claim execution identity is immutable'; END IF;
  IF OLD."refundOperationId" IS NOT NULL AND NEW."refundOperationId" IS DISTINCT FROM OLD."refundOperationId" OR OLD."redoVisitId" IS NOT NULL AND NEW."redoVisitId" IS DISTINCT FROM OLD."redoVisitId" THEN RAISE EXCEPTION 'Claim execution identity is immutable'; END IF;
  IF OLD."resolvedAt" IS NOT NULL AND ROW(NEW."resolution",NEW."resolvedAt") IS DISTINCT FROM ROW(OLD."resolution",OLD."resolvedAt") THEN RAISE EXCEPTION 'Resolved claim is immutable'; END IF;
 END IF;
 IF NEW."refundOperationId" IS NOT NULL THEN
  SELECT * INTO r FROM "StripeTestRefund" WHERE "id"=NEW."refundOperationId";
  IF NOT COALESCE(r."visitId"=NEW."visitId" AND r."reason"='service_quality' AND p."residentUserId"=NEW."financialPayerUserId" AND NEW."resolution" IN ('refund_pending','refund_complete') AND NEW."redoVisitId" IS NULL,false) THEN RAISE EXCEPTION 'Claim refund identity does not match'; END IF;
 END IF;
 IF NEW."recurringRefundOperationId" IS NOT NULL THEN
  SELECT * INTO rr FROM "RecurringChargeRefund" WHERE id=NEW."recurringRefundOperationId";
  SELECT * INTO rl FROM "RecurringChargeLine" WHERE id=rr."lineId";
  SELECT * INTO rc FROM "RecurringCharge" WHERE id=rr."chargeId";
  IF NOT COALESCE(rl."visitId"=NEW."visitId" AND rl."chargeId"=rc.id AND rr.reason='service_quality' AND rc."payerUserId"=NEW."financialPayerUserId" AND NEW.resolution IN('refund_pending','refund_complete') AND NEW."redoVisitId" IS NULL AND NEW."refundOperationId" IS NULL,false) THEN RAISE EXCEPTION 'Recurring claim refund mismatch'; END IF;
 END IF;
 IF NEW."redoVisitId" IS NOT NULL THEN
  SELECT * INTO redo FROM "ServiceVisit" WHERE "id"=NEW."redoVisitId";
  IF NOT COALESCE(redo."redoOfVisitId"=NEW."visitId" AND NEW."resolution" IN ('redo_pending','redo_complete') AND NEW."refundOperationId" IS NULL AND NEW."recurringRefundOperationId" IS NULL,false) THEN RAISE EXCEPTION 'Claim redo identity does not match'; END IF;
 END IF;
 IF NEW."resolution"='refund_complete' AND NEW."recurringRefundOperationId" IS NULL AND NOT COALESCE(r."state"='succeeded' AND r."stripeRefundId" IS NOT NULL AND (r."reversalCents"=0 OR r."stripeReversalId" IS NOT NULL),false) THEN RAISE EXCEPTION 'Refund and required reversal must finish'; END IF;
 IF NEW."resolution"='refund_complete' AND NEW."recurringRefundOperationId" IS NOT NULL AND NOT COALESCE(rr.status='succeeded' AND rr."stripeRefundId" IS NOT NULL AND (rr."providerReversalCents"=0 OR rr."stripeReversalId" IS NOT NULL),false) THEN RAISE EXCEPTION 'Recurring refund and reversal must finish'; END IF;
 IF NEW."resolution"='redo_complete' AND NOT COALESCE(redo."status"::text='completed' AND redo."completedAt" IS NOT NULL,false) THEN RAISE EXCEPTION 'Redo must actually complete'; END IF;
 RETURN NEW;
END $$;
