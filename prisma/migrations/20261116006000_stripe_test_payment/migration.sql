CREATE TABLE "StripeTestPayment" (
 "visitId" TEXT PRIMARY KEY REFERENCES "ServiceVisit"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "requestId" TEXT NOT NULL, "agreementId" TEXT NOT NULL, "communityId" TEXT NOT NULL,
 "residentUserId" TEXT NOT NULL, "providerUserId" TEXT NOT NULL, "unitId" TEXT NOT NULL,
 "customerId" TEXT NOT NULL, "paymentMethodId" TEXT NOT NULL, "providerAccountId" TEXT NOT NULL,
 "termsToken" TEXT NOT NULL,
 "amountCents" INTEGER NOT NULL CHECK ("amountCents" >= 50),
 "platformFeeCents" INTEGER NOT NULL CHECK ("platformFeeCents" >= 0 AND "platformFeeCents"::bigint * 10 <= "amountCents"),
 "hoaShareCents" INTEGER NOT NULL DEFAULT 0 CHECK ("hoaShareCents" >= 0 AND "hoaShareCents" <= "platformFeeCents"),
 "providerAmountCents" INTEGER NOT NULL CHECK ("providerAmountCents" = "amountCents" - "platformFeeCents" AND "providerAmountCents" >= 0),
 "currency" TEXT NOT NULL CHECK ("currency" = 'usd'),
 "stripePaymentIntentId" TEXT, "stripeChargeId" TEXT, "stripeTransferId" TEXT,
 "status" TEXT NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending','requires_action','succeeded','failed','refunded','partially_refunded','disputed')),
 "failureCode" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "StripeTestPayment_stripePaymentIntentId_key" ON "StripeTestPayment"("stripePaymentIntentId");
CREATE UNIQUE INDEX "StripeTestPayment_stripeChargeId_key" ON "StripeTestPayment"("stripeChargeId");
CREATE UNIQUE INDEX "StripeTestPayment_stripeTransferId_key" ON "StripeTestPayment"("stripeTransferId");
CREATE INDEX "StripeTestPayment_status_createdAt_idx" ON "StripeTestPayment"("status", "createdAt");
CREATE FUNCTION "protect_stripe_test_payment_identity"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW."visitId", NEW."requestId", NEW."agreementId", NEW."communityId", NEW."residentUserId", NEW."providerUserId", NEW."unitId", NEW."customerId", NEW."paymentMethodId", NEW."providerAccountId", NEW."termsToken", NEW."amountCents", NEW."platformFeeCents", NEW."hoaShareCents", NEW."providerAmountCents", NEW."currency", NEW."createdAt") IS DISTINCT FROM
 ROW(OLD."visitId", OLD."requestId", OLD."agreementId", OLD."communityId", OLD."residentUserId", OLD."providerUserId", OLD."unitId", OLD."customerId", OLD."paymentMethodId", OLD."providerAccountId", OLD."termsToken", OLD."amountCents", OLD."platformFeeCents", OLD."hoaShareCents", OLD."providerAmountCents", OLD."currency", OLD."createdAt") THEN
  RAISE EXCEPTION 'Payment identity and allocation are immutable' USING ERRCODE='23514';
 END IF;
 IF OLD."stripePaymentIntentId" IS NOT NULL AND NEW."stripePaymentIntentId" IS DISTINCT FROM OLD."stripePaymentIntentId" THEN
  RAISE EXCEPTION 'Payment intent identity is immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "StripeTestPayment_identity" BEFORE UPDATE ON "StripeTestPayment" FOR EACH ROW EXECUTE FUNCTION "protect_stripe_test_payment_identity"();

CREATE FUNCTION "prevent_stripe_test_payment_delete"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Payment identity cannot be deleted or truncated' USING ERRCODE='23514';
END; $$;
CREATE TRIGGER "StripeTestPayment_no_delete" BEFORE DELETE ON "StripeTestPayment" FOR EACH ROW EXECUTE FUNCTION "prevent_stripe_test_payment_delete"();
CREATE TRIGGER "StripeTestPayment_no_truncate" BEFORE TRUNCATE ON "StripeTestPayment" FOR EACH STATEMENT EXECUTE FUNCTION "prevent_stripe_test_payment_delete"();
