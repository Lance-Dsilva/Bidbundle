ALTER TABLE "StripeTestPayment"
 ADD COLUMN "amountRefundedCents" INTEGER NOT NULL DEFAULT 0 CHECK ("amountRefundedCents" BETWEEN 0 AND "amountCents"),
 ADD COLUMN "providerReversedCents" INTEGER NOT NULL DEFAULT 0 CHECK ("providerReversedCents" BETWEEN 0 AND "providerAmountCents"),
 ADD COLUMN "refundedAt" TIMESTAMP(3);
CREATE TABLE "StripeTestRefund" (
 "id" TEXT PRIMARY KEY, "visitId" TEXT NOT NULL REFERENCES "StripeTestPayment"("visitId") ON DELETE RESTRICT,
 "actorUserId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
 "reason" TEXT NOT NULL CHECK ("reason" IN ('service_quality','duplicate','requested_by_customer')),
 "amountCents" INTEGER NOT NULL CHECK ("amountCents" > 0),
 "refundedBeforeCents" INTEGER NOT NULL CHECK ("refundedBeforeCents" >= 0),
 "cumulativeRefundCents" INTEGER NOT NULL CHECK ("cumulativeRefundCents" = "refundedBeforeCents" + "amountCents"),
 "reversedBeforeCents" INTEGER NOT NULL CHECK ("reversedBeforeCents" >= 0),
 "reversalCents" INTEGER NOT NULL CHECK ("reversalCents" >= 0),
 "chargeId" TEXT NOT NULL, "transferId" TEXT,
 "state" TEXT NOT NULL DEFAULT 'pending' CHECK ("state" IN ('pending','refund_pending','reversal_pending','succeeded','failed','manual_review')),
 "stripeRefundId" TEXT UNIQUE, "stripeReversalId" TEXT UNIQUE,
 "refundAttemptedAt" TIMESTAMP(3), "reversalAttemptedAt" TIMESTAMP(3), "failureCode" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "StripeTestRefund_one_unfinished" ON "StripeTestRefund"("visitId") WHERE "state" NOT IN ('succeeded','failed');
CREATE INDEX "StripeTestRefund_state_updatedAt_idx" ON "StripeTestRefund"("state","updatedAt");
CREATE INDEX "StripeTestRefund_visitId_createdAt_idx" ON "StripeTestRefund"("visitId","createdAt");
CREATE FUNCTION guard_stripe_test_refund() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p "StripeTestPayment"%ROWTYPE; expected_reversal INTEGER;
BEGIN
 IF TG_OP IN ('DELETE','TRUNCATE') THEN RAISE EXCEPTION 'Refund audit history cannot be deleted'; END IF;
 IF TG_OP = 'UPDATE' THEN
  IF (to_jsonb(NEW)-ARRAY['state','stripeRefundId','stripeReversalId','refundAttemptedAt','reversalAttemptedAt','failureCode','updatedAt']) IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['state','stripeRefundId','stripeReversalId','refundAttemptedAt','reversalAttemptedAt','failureCode','updatedAt']) OR
     (OLD."stripeRefundId" IS NOT NULL AND NEW."stripeRefundId" IS DISTINCT FROM OLD."stripeRefundId") OR
     (OLD."stripeReversalId" IS NOT NULL AND NEW."stripeReversalId" IS DISTINCT FROM OLD."stripeReversalId") OR
     (OLD."refundAttemptedAt" IS NOT NULL AND NEW."refundAttemptedAt" IS DISTINCT FROM OLD."refundAttemptedAt") OR
     (OLD."reversalAttemptedAt" IS NOT NULL AND NEW."reversalAttemptedAt" IS DISTINCT FROM OLD."reversalAttemptedAt") OR
     (OLD."state" IN ('succeeded','failed') AND NEW."state" IS DISTINCT FROM OLD."state") THEN
   RAISE EXCEPTION 'Refund identity and completed operations are immutable';
  END IF;
  IF (NEW."state" IN ('refund_pending','reversal_pending','succeeded','failed') AND NEW."stripeRefundId" IS NULL) OR
     (NEW."state"='succeeded' AND NEW."reversalCents">0 AND NEW."stripeReversalId" IS NULL) OR
     (NEW."stripeReversalId" IS NOT NULL AND (NEW."stripeRefundId" IS NULL OR NEW."transferId" IS NULL OR NEW."reversalCents"=0)) OR
     (OLD."state"='reversal_pending' AND NEW."state" NOT IN ('reversal_pending','succeeded','manual_review')) THEN
   RAISE EXCEPTION 'Refund progress requires matching processor evidence';
  END IF;
  RETURN NEW;
 END IF;
 IF NEW."state"<>'pending' OR NEW."stripeRefundId" IS NOT NULL OR NEW."stripeReversalId" IS NOT NULL OR
    NEW."refundAttemptedAt" IS NOT NULL OR NEW."reversalAttemptedAt" IS NOT NULL THEN
  RAISE EXCEPTION 'Refund must start as an unattempted reservation';
 END IF;
 SELECT * INTO p FROM "StripeTestPayment" WHERE "visitId"=NEW."visitId" FOR UPDATE;
 IF p."status" NOT IN ('succeeded','partially_refunded') OR p."stripeChargeId" IS DISTINCT FROM NEW."chargeId" OR
    p."stripeTransferId" IS DISTINCT FROM NEW."transferId" OR p."amountRefundedCents"<>NEW."refundedBeforeCents" OR
    p."providerReversedCents"<>NEW."reversedBeforeCents" OR NEW."cumulativeRefundCents">p."amountCents" THEN
  RAISE EXCEPTION 'Refund does not match the paid balance';
 END IF;
 expected_reversal := CASE WHEN NEW."transferId" IS NULL THEN 0 ELSE
  floor(p."providerAmountCents"::numeric*NEW."cumulativeRefundCents"/p."amountCents") -
  floor(p."providerAmountCents"::numeric*NEW."refundedBeforeCents"/p."amountCents") END;
 IF NEW."reversalCents"<>expected_reversal THEN RAISE EXCEPTION 'Incorrect provider refund allocation'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "StripeTestRefund_guard" BEFORE INSERT OR UPDATE OR DELETE ON "StripeTestRefund" FOR EACH ROW EXECUTE FUNCTION guard_stripe_test_refund();
CREATE TRIGGER "StripeTestRefund_no_truncate" BEFORE TRUNCATE ON "StripeTestRefund" FOR EACH STATEMENT EXECUTE FUNCTION guard_stripe_test_refund();
