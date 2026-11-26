ALTER TABLE "ServiceVisit"
  ADD COLUMN "billingPayerUserId" TEXT,
  ADD CONSTRAINT "ServiceVisit_billingPayer_scope"
    CHECK (
      "billingPayerUserId" IS NULL
      OR ("allocatedVisitCents" IS NOT NULL AND "unitId" IS NOT NULL)
    );

CREATE FUNCTION "prevent_visit_billing_payer_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."billingPayerUserId" IS DISTINCT FROM OLD."billingPayerUserId" THEN
    RAISE EXCEPTION 'The visit billing payer is immutable'
      USING ERRCODE = '23514', CONSTRAINT = 'ServiceVisit_billingPayer_immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ServiceVisit_billingPayer_immutable"
  BEFORE UPDATE ON "ServiceVisit"
  FOR EACH ROW EXECUTE FUNCTION "prevent_visit_billing_payer_change"();

CREATE TABLE "VisitBillingConsent" (
  "agreementId" TEXT NOT NULL REFERENCES "ServiceAgreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "payerUserId" TEXT NOT NULL,
  "unitId" TEXT NOT NULL,
  "termsToken" TEXT NOT NULL,
  "termsVersion" TEXT NOT NULL,
  "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VisitBillingConsent_pkey" PRIMARY KEY ("agreementId", "payerUserId", "unitId")
);

CREATE FUNCTION "prevent_visit_billing_consent_update"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Final-price consent cannot be rewritten'
    USING ERRCODE = '23514', CONSTRAINT = 'VisitBillingConsent_immutable';
END;
$$;

-- Reject edits to captured consent. Deliberate deletion remains possible for
-- privacy cleanup or revocation; payment operations must require extant consent.
CREATE TRIGGER "VisitBillingConsent_immutable"
  BEFORE UPDATE ON "VisitBillingConsent"
  FOR EACH ROW EXECUTE FUNCTION "prevent_visit_billing_consent_update"();
