ALTER TABLE "StripeTestPayment" ADD COLUMN "receiptEmail" TEXT;
-- Historical payments intentionally retain null. Never infer a historical recipient.
CREATE FUNCTION bundleen_payment_receipt_identity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE payer "User"%ROWTYPE;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW."receiptEmail" IS DISTINCT FROM OLD."receiptEmail" THEN RAISE EXCEPTION 'Receipt recipient is immutable'; END IF;
  RETURN NEW;
 END IF;
 -- Null remains supported for historical/imported records; only application-prepared
 -- new payments require a recipient, preserving existing non-receipt integrations.
 IF NEW."receiptEmail" IS NOT NULL THEN
  SELECT * INTO payer FROM "User" WHERE "id"=NEW."residentUserId" FOR SHARE;
  IF NOT COALESCE(payer."isVerified" AND NEW."receiptEmail"=lower(btrim(payer."email")) AND length(NEW."receiptEmail")<=254 AND NEW."receiptEmail" ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$',false) THEN RAISE EXCEPTION 'Receipt requires verified original payer email'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "StripeTestPayment_receipt_identity" BEFORE INSERT OR UPDATE ON "StripeTestPayment" FOR EACH ROW EXECUTE FUNCTION bundleen_payment_receipt_identity();
