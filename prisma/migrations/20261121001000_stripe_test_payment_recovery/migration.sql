ALTER TABLE "StripeTestPayment" ADD COLUMN "lastRecoveryAttemptId" TEXT;
CREATE TABLE "StripeTestPaymentAttempt" (
  "id" TEXT PRIMARY KEY,
  "visitId" TEXT NOT NULL REFERENCES "StripeTestPayment"("visitId") ON DELETE RESTRICT,
  "customerId" TEXT NOT NULL,
  "paymentMethodId" TEXT NOT NULL,
  "setupIntentId" TEXT NOT NULL UNIQUE,
  "sequence" INTEGER NOT NULL CHECK ("sequence" > 0),
  "termsVersion" TEXT NOT NULL CHECK ("termsVersion" = 'completed-visit-retry-v1'),
  "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "StripeTestPaymentAttempt_visitId_sequence_key" ON "StripeTestPaymentAttempt"("visitId", "sequence");
CREATE FUNCTION protect_stripe_test_payment_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Payment recovery consent is immutable';
END;
$$;
CREATE TRIGGER "StripeTestPaymentAttempt_immutable" BEFORE UPDATE OR DELETE ON "StripeTestPaymentAttempt"
FOR EACH ROW EXECUTE FUNCTION protect_stripe_test_payment_attempt();
CREATE TRIGGER "StripeTestPaymentAttempt_no_truncate" BEFORE TRUNCATE ON "StripeTestPaymentAttempt"
FOR EACH STATEMENT EXECUTE FUNCTION protect_stripe_test_payment_attempt();

CREATE FUNCTION validate_stripe_test_payment_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected_customer TEXT; expected_sequence INTEGER;
BEGIN
  SELECT "customerId" INTO expected_customer FROM "StripeTestPayment" WHERE "visitId" = NEW."visitId" FOR UPDATE;
  SELECT COALESCE(MAX("sequence"), 0) + 1 INTO expected_sequence FROM "StripeTestPaymentAttempt" WHERE "visitId" = NEW."visitId";
  IF expected_customer IS DISTINCT FROM NEW."customerId" OR NEW."sequence" <> expected_sequence THEN
    RAISE EXCEPTION 'Payment recovery identity or sequence changed';
  END IF;
  NEW."acceptedAt" := clock_timestamp();
  RETURN NEW;
END;
$$;
CREATE TRIGGER "StripeTestPaymentAttempt_identity" BEFORE INSERT ON "StripeTestPaymentAttempt"
FOR EACH ROW EXECUTE FUNCTION validate_stripe_test_payment_attempt();
CREATE FUNCTION validate_stripe_test_last_recovery() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."lastRecoveryAttemptId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "StripeTestPaymentAttempt" WHERE "id" = NEW."lastRecoveryAttemptId" AND "visitId" = NEW."visitId"
  ) THEN RAISE EXCEPTION 'Recovery attempt does not belong to payment'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "StripeTestPayment_scoped_recovery" BEFORE INSERT OR UPDATE OF "lastRecoveryAttemptId" ON "StripeTestPayment"
FOR EACH ROW EXECUTE FUNCTION validate_stripe_test_last_recovery();
