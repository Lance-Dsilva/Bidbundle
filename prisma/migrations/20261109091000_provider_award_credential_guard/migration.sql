-- Per-document, per-review reminder claims; reset only by a new approval.
ALTER TABLE "MediaAsset" ADD COLUMN "credentialReminder30At" TIMESTAMP(3), ADD COLUMN "credentialReminder7At" TIMESTAMP(3);

-- The existing bid guard first locks request and active provider identity.
-- This additional, alphabetically-last guard locks and checks the CURRENT
-- evidence/policy before acceptance, closing replacement/revocation/policy races.
CREATE OR REPLACE FUNCTION bundleen_guard_credential_award() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  p "ProviderProfile"%ROWTYPE;
  l "MediaAsset"%ROWTYPE;
  i "MediaAsset"%ROWTYPE;
  h "HoaProfile"%ROWTYPE;
  community_type text;
  community_id text;
  today_utc date;
BEGIN
  IF NEW."status"::text <> 'accepted' OR OLD."status"::text = 'accepted' THEN RETURN NEW; END IF;
  SELECT * INTO p FROM "ProviderProfile" WHERE "userId" = NEW."providerUserId" FOR SHARE;
  SELECT * INTO l FROM "MediaAsset" WHERE "id" = p."licenseDocumentId" FOR SHARE;
  SELECT * INTO i FROM "MediaAsset" WHERE "id" = p."insuranceDocumentId" FOR SHARE;
  SELECT c."type"::text, c."id" INTO community_type, community_id
    FROM "HoaServiceRequest" r JOIN "Community" c ON c."id" = r."communityId" WHERE r."id" = NEW."requestId";
  IF community_type = 'hoa' THEN
    SELECT * INTO h FROM "HoaProfile" WHERE "communityId" = community_id FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'HOA insurance policy missing' USING ERRCODE = 'P1702', CONSTRAINT = 'ServiceBid_credential_policy_required'; END IF;
  END IF;
  today_utc := (clock_timestamp() AT TIME ZONE 'UTC')::date;
  IF NOT COALESCE(
    p."accountStatus"::text = 'active'
    AND p."licenseVerifiedAt" IS NOT NULL AND p."insuranceVerifiedAt" IS NOT NULL
    AND p."licenseNumber" IS NOT NULL AND p."licenseNumber" <> ''
    AND p."insuranceProvider" IS NOT NULL AND p."insuranceProvider" <> ''
    AND p."licenseExpiresAt" >= today_utc AND p."insuranceExpiresAt" >= today_utc
    AND l."providerProfileId" = p."id" AND i."providerProfileId" = p."id"
    AND l."purpose"::text = 'provider_license' AND i."purpose"::text = 'provider_insurance'
    AND l."status"::text = 'active' AND i."status"::text = 'active'
    AND l."credentialReviewStatus"::text = 'approved' AND i."credentialReviewStatus"::text = 'approved'
    AND l."storageUrl" = '' AND i."storageUrl" = '' AND l."communityId" IS NULL AND i."communityId" IS NULL
    AND l."checksum" = p."licenseVerifiedDocumentChecksum" AND i."checksum" = p."insuranceVerifiedDocumentChecksum"
    AND l."credentialExpiresAt" = p."licenseExpiresAt" AND i."credentialExpiresAt" = p."insuranceExpiresAt"
    AND i."credentialCoverageCents" = p."insuranceCoverageCents" AND p."insuranceCoverageCents" >= 0
    AND i."credentialAdditionalInsured" = p."insuranceAdditionalInsured"
    AND l."credentialSnapshot" = jsonb_build_object('licenseNumber',p."licenseNumber",'licenseState',p."licenseState")
    AND i."credentialSnapshot" = jsonb_build_object('insuranceProvider',p."insuranceProvider",'insurancePolicyNumber',p."insurancePolicyNumber")
    AND (community_type <> 'hoa' OR (
      p."insuranceCoverageCents" >= h."minimumInsuranceCoverageCents"
      AND (NOT h."requiresAdditionalInsured" OR p."insuranceAdditionalInsured")
    )), false
  ) THEN
    RAISE EXCEPTION 'Provider credential evidence or HOA insurance policy changed or expired'
      USING ERRCODE = 'P1702', CONSTRAINT = 'ServiceBid_current_credentials_required';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS "zz_ServiceBid_credential_award_guard" ON "ServiceBid";
CREATE TRIGGER "zz_ServiceBid_credential_award_guard" BEFORE UPDATE OF "status" ON "ServiceBid"
  FOR EACH ROW EXECUTE FUNCTION bundleen_guard_credential_award();
