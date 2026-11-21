ALTER TABLE "StripeTestPayment"
 ADD COLUMN "reconciliationHoldReason" TEXT,
 ADD COLUMN "observedChargeRefundedCents" INTEGER NOT NULL DEFAULT 0 CHECK ("observedChargeRefundedCents" BETWEEN 0 AND "amountCents"),
 ADD COLUMN "observedProviderReversedCents" INTEGER NOT NULL DEFAULT 0 CHECK ("observedProviderReversedCents" BETWEEN 0 AND "providerAmountCents"),
 ADD COLUMN "observedDisputeId" TEXT,
 ADD COLUMN "observedDisputeStatus" TEXT;
CREATE TABLE "StripeTestFinancialObservation" (
 "eventId" TEXT PRIMARY KEY REFERENCES "StripeTestEvent"("id") ON DELETE RESTRICT,
 "visitId" TEXT NOT NULL REFERENCES "StripeTestPayment"("visitId") ON DELETE RESTRICT,
 "refundedCents" INTEGER NOT NULL CHECK ("refundedCents">=0),
 "reversedCents" INTEGER NOT NULL CHECK ("reversedCents">=0),
 "disputeId" TEXT, "disputeStatus" TEXT, "holdReason" TEXT,
 "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "StripeTestFinancialObservation_visitId_observedAt_idx" ON "StripeTestFinancialObservation"("visitId","observedAt");
CREATE FUNCTION protect_stripe_financial_observation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Financial observation history is immutable'; END; $$;
CREATE TRIGGER "StripeTestFinancialObservation_immutable" BEFORE UPDATE OR DELETE ON "StripeTestFinancialObservation" FOR EACH ROW EXECUTE FUNCTION protect_stripe_financial_observation();
CREATE TRIGGER "StripeTestFinancialObservation_no_truncate" BEFORE TRUNCATE ON "StripeTestFinancialObservation" FOR EACH STATEMENT EXECUTE FUNCTION protect_stripe_financial_observation();

ALTER TABLE "StripeTestEvent" ADD COLUMN "nextAttemptAt" TIMESTAMP(3), ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0 CHECK ("attempts">=0);
CREATE INDEX "StripeTestEvent_retry_queue" ON "StripeTestEvent"("processedAt","nextAttemptAt","receivedAt");
