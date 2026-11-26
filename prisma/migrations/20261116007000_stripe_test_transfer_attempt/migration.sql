ALTER TABLE "StripeTestPayment" ADD COLUMN "transferAttemptedAt" TIMESTAMP(3);
CREATE FUNCTION "protect_stripe_test_transfer_identity"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD."transferAttemptedAt" IS NOT NULL AND NEW."transferAttemptedAt" IS DISTINCT FROM OLD."transferAttemptedAt" THEN
  RAISE EXCEPTION 'Transfer attempt time is immutable' USING ERRCODE='23514';
 END IF;
 IF OLD."stripeTransferId" IS NOT NULL AND NEW."stripeTransferId" IS DISTINCT FROM OLD."stripeTransferId" THEN
  RAISE EXCEPTION 'Transfer identity is immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "StripeTestPayment_transfer_identity" BEFORE UPDATE ON "StripeTestPayment" FOR EACH ROW EXECUTE FUNCTION "protect_stripe_test_transfer_identity"();
