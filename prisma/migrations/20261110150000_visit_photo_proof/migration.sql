-- Opt-in proof workflow. Legacy requests and visits retain false; no historical
-- job gains a new completion prerequisite when this migration is applied.
ALTER TYPE "MediaPurpose" ADD VALUE IF NOT EXISTS 'visit_before';
ALTER TYPE "MediaPurpose" ADD VALUE IF NOT EXISTS 'visit_after';
ALTER TABLE "HoaServiceRequest" ADD COLUMN "requiresAfterPhoto" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ServiceVisit" ADD COLUMN "requiresAfterPhoto" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "MediaAsset"
  ADD COLUMN "visitId" TEXT REFERENCES "ServiceVisit"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD COLUMN "marketingConsentUserId" TEXT REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD COLUMN "marketingConsentedAt" TIMESTAMP(3),
  ADD COLUMN "marketingConsentVersion" TEXT,
  ADD COLUMN "marketingConsentChangedByUserId" TEXT REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "MediaAsset_visitId_purpose_status_idx" ON "MediaAsset"("visitId", "purpose", "status");

CREATE TABLE "CategoryVisitPolicy" (
  "category" TEXT NOT NULL PRIMARY KEY,
  "requiresAfterPhoto" BOOLEAN NOT NULL DEFAULT false,
  "updatedByUserId" TEXT REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CategoryVisitPolicy_known_category" CHECK ("category" IN
    ('cleaning','electrical','gutter','handyman','hvac','lawn','plumbing','roofing','other','painting','pest_control','pool_care','landscaping','seasonal_maintenance'))
);
INSERT INTO "CategoryVisitPolicy" ("category", "requiresAfterPhoto")
SELECT category, category = 'pool_care' FROM unnest(ARRAY[
  'cleaning','electrical','gutter','handyman','hvac','lawn','plumbing','roofing','other','painting','pest_control','pool_care','landscaping','seasonal_maintenance'
]) AS category;

CREATE FUNCTION bundleen_visit_photo_policy_admin(actor_id TEXT) RETURNS void LANGUAGE plpgsql AS $$
DECLARE actor_email TEXT;
BEGIN
  SELECT "email" INTO actor_email FROM "User" WHERE "id" = actor_id AND "role" = 'admin' AND "isVerified" = true FOR SHARE;
  IF FOUND THEN
    PERFORM 1 FROM "AdminAccessGrant" WHERE "userId" = actor_id AND "email" = lower(actor_email)
      AND "status" = 'active' AND "isStaffAccount" = false FOR SHARE;
    IF FOUND THEN RETURN; END IF;
  END IF;
  RAISE EXCEPTION 'Exact active admin authority is required for photo policy' USING ERRCODE = 'P1710';
END;
$$;
CREATE FUNCTION bundleen_validate_visit_photo_policy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Category photo policy must remain configured' USING ERRCODE = 'P1710'; END IF;
  IF TG_OP = 'UPDATE' AND NEW."category" IS DISTINCT FROM OLD."category" THEN
    RAISE EXCEPTION 'Category photo policy identity is immutable' USING ERRCODE = 'P1710';
  END IF;
  PERFORM bundleen_visit_photo_policy_admin(NEW."updatedByUserId");
  RETURN NEW;
END;
$$;
CREATE TRIGGER "CategoryVisitPolicy_admin" BEFORE INSERT OR UPDATE OR DELETE ON "CategoryVisitPolicy"
  FOR EACH ROW EXECUTE FUNCTION bundleen_validate_visit_photo_policy();

CREATE FUNCTION bundleen_snapshot_request_photo_policy() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE required BOOLEAN;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW."requiresAfterPhoto" IS DISTINCT FROM OLD."requiresAfterPhoto" THEN
      RAISE EXCEPTION 'The quoted request photo policy cannot change' USING ERRCODE = 'P1710';
    END IF;
    RETURN NEW;
  END IF;
  SELECT "requiresAfterPhoto" INTO required FROM "CategoryVisitPolicy" WHERE "category" = NEW."category" FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Configure this service category photo policy before creating requests' USING ERRCODE = 'P1710'; END IF;
  NEW."requiresAfterPhoto" := required;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "HoaServiceRequest_photo_policy" BEFORE INSERT OR UPDATE ON "HoaServiceRequest"
  FOR EACH ROW EXECUTE FUNCTION bundleen_snapshot_request_photo_policy();

-- One shared lock order for provider uploads and completion. The actor is an
-- explicit server argument, never inferred from whichever provider is current
-- after a prepared action waited on an agreement/profile lock.
CREATE FUNCTION bundleen_assert_visit_photo_provider(actor_id TEXT, visit_id TEXT) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v "ServiceVisit"%ROWTYPE; a "ServiceAgreement"%ROWTYPE; occurrence_status TEXT;
BEGIN
  SELECT * INTO v FROM "ServiceVisit" WHERE "id" = visit_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Service visit is unavailable' USING ERRCODE = 'P1711'; END IF;
  SELECT agreement.* INTO a FROM "ServiceOccurrence" occurrence
    JOIN "ServiceAgreement" agreement ON agreement."id" = occurrence."agreementId"
    WHERE occurrence."id" = v."occurrenceId" FOR SHARE OF occurrence, agreement;
  SELECT "status"::text INTO occurrence_status FROM "ServiceOccurrence" WHERE "id" = v."occurrenceId";
  IF a."providerUserId" IS DISTINCT FROM actor_id OR a."status"::text IS DISTINCT FROM 'active' OR
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

ALTER TABLE "MediaAsset" DROP CONSTRAINT "MediaAsset_one_owner";
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_one_owner" CHECK (
  (("purpose"::text IN ('provider_license','provider_insurance'))
    AND "providerProfileId" IS NOT NULL AND "communityId" IS NULL AND "visitId" IS NULL
    AND "amenityId" IS NULL AND "reviewId" IS NULL AND "issueId" IS NULL
    AND "storageUrl" = '' AND "credentialSnapshot" IS NOT NULL)
  OR
  (("purpose"::text IN ('amenity_gallery','amenity_review','amenity_issue'))
    AND "providerProfileId" IS NULL AND "communityId" IS NOT NULL AND "visitId" IS NULL
    AND num_nonnulls("amenityId","reviewId","issueId") = 1
    AND ("purpose"::text <> 'amenity_gallery' OR "amenityId" IS NOT NULL)
    AND ("purpose"::text <> 'amenity_review' OR "reviewId" IS NOT NULL)
    AND ("purpose"::text <> 'amenity_issue' OR "issueId" IS NOT NULL))
  OR
  (("purpose"::text IN ('visit_before','visit_after'))
    AND "visitId" IS NOT NULL AND "communityId" IS NOT NULL AND "providerProfileId" IS NULL
    AND "amenityId" IS NULL AND "reviewId" IS NULL AND "issueId" IS NULL
    AND "credentialSnapshot" IS NULL AND "credentialReviewedAt" IS NULL AND "credentialReviewedByUserId" IS NULL
    AND "credentialReviewReason" IS NULL AND "credentialExpiresAt" IS NULL AND "credentialCoverageCents" IS NULL
    AND "credentialAdditionalInsured" IS NULL AND "credentialReminder30At" IS NULL AND "credentialReminder7At" IS NULL
    AND "credentialReviewStatus"::text = 'pending'
    AND "contentType" IN ('image/jpeg','image/png','image/webp') AND "byteSize" BETWEEN 1 AND 4194304
    AND "width" IS NOT NULL AND "height" IS NOT NULL
    AND "width" > 0 AND "height" > 0 AND "width" <= 4096 AND "height" <= 4096
    AND "checksum" ~ '^[a-f0-9]{64}$'
    AND left("storagePath", length('visit-photos/' || "visitId" || '/' || "purpose"::text || '/')) = ('visit-photos/' || "visitId" || '/' || "purpose"::text || '/')
    AND "storagePath" ~ '^visit-photos/[^/]+/(visit_before|visit_after)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](jpg|png|webp)$'
    AND (("contentType" = 'image/jpeg' AND "storagePath" LIKE '%.jpg')
      OR ("contentType" = 'image/png' AND "storagePath" LIKE '%.png')
      OR ("contentType" = 'image/webp' AND "storagePath" LIKE '%.webp'))
    AND "storagePath" NOT LIKE '%..%'
    AND "storageUrl" = '')
);
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_visit_photo_consent" CHECK (
  ("purpose"::text IN ('visit_before','visit_after') AND
    (("marketingConsentUserId" IS NULL AND "marketingConsentedAt" IS NULL AND "marketingConsentVersion" IS NULL)
      OR ("marketingConsentUserId" IS NOT NULL AND "marketingConsentedAt" IS NOT NULL AND "marketingConsentVersion" IS NOT NULL AND "marketingConsentVersion" = "checksum")))
  OR
  ("purpose"::text NOT IN ('visit_before','visit_after') AND "marketingConsentUserId" IS NULL AND "marketingConsentedAt" IS NULL
    AND "marketingConsentVersion" IS NULL AND "marketingConsentChangedByUserId" IS NULL)
);

CREATE FUNCTION bundleen_visit_photo_resident(actor_id TEXT, visit_id TEXT) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE v "ServiceVisit"%ROWTYPE; community_id TEXT;
BEGIN
  SELECT * INTO v FROM "ServiceVisit" WHERE "id" = visit_id FOR UPDATE;
  SELECT a."communityId" INTO community_id FROM "ServiceOccurrence" o JOIN "ServiceAgreement" a ON a."id" = o."agreementId"
    WHERE o."id" = v."occurrenceId" FOR SHARE OF o, a;
  PERFORM 1 FROM "Community" WHERE "id" = community_id AND "status" = 'active' FOR SHARE;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM 1 FROM "User" WHERE "id" = actor_id AND "role" = 'homeowner' FOR SHARE;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM 1 FROM "CommunityMembership" WHERE "communityId" = community_id AND "userId" = actor_id AND "status" = 'active'
    AND ((v."unitId" IS NOT NULL AND "unitId" = v."unitId") OR (v."unitId" IS NULL AND v."homeownerUserId" = actor_id)) FOR SHARE;
  RETURN FOUND;
END;
$$;

CREATE FUNCTION bundleen_validate_visit_photo() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v "ServiceVisit"%ROWTYPE; community_id TEXT; photo_count INTEGER; consent_changed BOOLEAN;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."purpose"::text IN ('visit_before','visit_after') THEN
      RAISE EXCEPTION 'Visit photo evidence cannot be physically deleted' USING ERRCODE = 'P1711';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW."purpose" IS DISTINCT FROM OLD."purpose" AND
     (NEW."purpose"::text IN ('visit_before','visit_after') OR OLD."purpose"::text IN ('visit_before','visit_after')) THEN
    RAISE EXCEPTION 'Visit evidence cannot be reclassified from or into another media purpose' USING ERRCODE = 'P1711';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."purpose"::text IN ('visit_before','visit_after') THEN
    IF (to_jsonb(NEW) - ARRAY['status','deletedAt','moderatedByUserId','position','updatedAt','marketingConsentUserId','marketingConsentedAt','marketingConsentVersion','marketingConsentChangedByUserId']) IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['status','deletedAt','moderatedByUserId','position','updatedAt','marketingConsentUserId','marketingConsentedAt','marketingConsentVersion','marketingConsentChangedByUserId']) THEN
      RAISE EXCEPTION 'Visit photo subject, bytes and association are immutable' USING ERRCODE = 'P1711';
    END IF;
  END IF;
  IF NEW."purpose"::text NOT IN ('visit_before','visit_after') THEN RETURN NEW; END IF;
  SELECT * INTO v FROM "ServiceVisit" WHERE "id" = NEW."visitId" FOR UPDATE;
  SELECT a."communityId" INTO community_id FROM "ServiceOccurrence" o JOIN "ServiceAgreement" a ON a."id" = o."agreementId"
    WHERE o."id" = v."occurrenceId" FOR SHARE OF o, a;
  IF v."id" IS NULL OR NEW."communityId" IS DISTINCT FROM community_id THEN
    RAISE EXCEPTION 'Photo belongs to a different service visit community' USING ERRCODE = 'P1711';
  END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM bundleen_assert_visit_photo_provider(NEW."uploaderUserId", NEW."visitId");
    IF NEW."status"::text <> 'active' OR NEW."marketingConsentUserId" IS NOT NULL OR NEW."marketingConsentChangedByUserId" IS NOT NULL THEN
      RAISE EXCEPTION 'New provider proof has no resident marketing consent' USING ERRCODE = 'P1711';
    END IF;
    SELECT count(*) INTO photo_count FROM "MediaAsset" WHERE "visitId" = NEW."visitId" AND "purpose" = NEW."purpose" AND "status" = 'active';
    IF photo_count >= 8 THEN RAISE EXCEPTION 'At most eight active photos of each purpose are allowed per visit' USING ERRCODE = 'P1711'; END IF;
  ELSE
    IF NEW."status" IS DISTINCT FROM OLD."status" OR NEW."deletedAt" IS DISTINCT FROM OLD."deletedAt" THEN
      IF v."status"::text = 'completed' OR OLD."status"::text = 'removed' THEN
        RAISE EXCEPTION 'Completed visit proof cannot be removed or restored' USING ERRCODE = 'P1711';
      END IF;
      PERFORM bundleen_assert_visit_photo_provider(NEW."uploaderUserId", NEW."visitId");
    END IF;
    consent_changed := NEW."marketingConsentUserId" IS DISTINCT FROM OLD."marketingConsentUserId" OR
      NEW."marketingConsentedAt" IS DISTINCT FROM OLD."marketingConsentedAt" OR
      NEW."marketingConsentVersion" IS DISTINCT FROM OLD."marketingConsentVersion" OR
      NEW."marketingConsentChangedByUserId" IS DISTINCT FROM OLD."marketingConsentChangedByUserId";
    IF consent_changed THEN
      IF NEW."marketingConsentChangedByUserId" IS NULL THEN RAISE EXCEPTION 'Photo consent needs its exact actor' USING ERRCODE = 'P1712'; END IF;
      IF NEW."marketingConsentUserId" IS NULL THEN
        IF NEW."marketingConsentChangedByUserId" IS DISTINCT FROM OLD."marketingConsentUserId" AND
           NOT bundleen_visit_photo_resident(NEW."marketingConsentChangedByUserId", NEW."visitId") THEN
          RAISE EXCEPTION 'Only the original consenter or current household can revoke photo consent' USING ERRCODE = 'P1712';
        END IF;
      ELSE
        IF NEW."status"::text <> 'active' OR NEW."marketingConsentUserId" IS DISTINCT FROM NEW."marketingConsentChangedByUserId" OR
           NEW."marketingConsentVersion" IS DISTINCT FROM NEW."checksum" OR
           NOT bundleen_visit_photo_resident(NEW."marketingConsentChangedByUserId", NEW."visitId") THEN
          RAISE EXCEPTION 'Only the current resident can opt in to this exact photo version' USING ERRCODE = 'P1712';
        END IF;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "zz_MediaAsset_visit_photo" BEFORE INSERT OR UPDATE OR DELETE ON "MediaAsset"
  FOR EACH ROW EXECUTE FUNCTION bundleen_validate_visit_photo();

CREATE FUNCTION bundleen_validate_visit_completion_proof() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE required BOOLEAN;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."status"::text = 'completed' OR NEW."completedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'New visits must pass the completion workflow after creation' USING ERRCODE = 'P1710';
    END IF;
    SELECT r."requiresAfterPhoto" INTO required FROM "ServiceOccurrence" o
      JOIN "ServiceAgreement" a ON a."id" = o."agreementId" JOIN "HoaServiceRequest" r ON r."id" = a."requestId"
      WHERE o."id" = NEW."occurrenceId" FOR SHARE OF o, a, r;
    NEW."requiresAfterPhoto" := required;
    RETURN NEW;
  END IF;
  IF NEW."requiresAfterPhoto" IS DISTINCT FROM OLD."requiresAfterPhoto" THEN
    RAISE EXCEPTION 'Awarded visit proof policy is immutable' USING ERRCODE = 'P1710';
  END IF;
  IF (OLD."requiresAfterPhoto" OR EXISTS (SELECT 1 FROM "MediaAsset" WHERE "visitId" = OLD."id")) AND
     (NEW."occurrenceId" IS DISTINCT FROM OLD."occurrenceId" OR NEW."unitId" IS DISTINCT FROM OLD."unitId" OR NEW."homeownerUserId" IS DISTINCT FROM OLD."homeownerUserId") THEN
    RAISE EXCEPTION 'Visit photo household subject is immutable' USING ERRCODE = 'P1710';
  END IF;
  IF OLD."status"::text = 'completed' AND (NEW."status" IS DISTINCT FROM OLD."status" OR NEW."completedAt" IS DISTINCT FROM OLD."completedAt") THEN
    RAISE EXCEPTION 'Completed proof cannot be undone' USING ERRCODE = 'P1710';
  END IF;
  IF NEW."status"::text = 'completed' AND OLD."status"::text <> 'completed' THEN
    IF NEW."completedAt" IS NULL THEN RAISE EXCEPTION 'Visit completion needs its timestamp' USING ERRCODE = 'P1710'; END IF;
    IF NEW."requiresAfterPhoto" AND NOT EXISTS (SELECT 1 FROM "MediaAsset" WHERE "visitId" = NEW."id" AND "purpose"::text = 'visit_after' AND "status" = 'active') THEN
      RAISE EXCEPTION 'An active private after photo is required to complete this visit' USING ERRCODE = 'P1710';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "zzz_ServiceVisit_photo_proof" BEFORE INSERT OR UPDATE ON "ServiceVisit"
  FOR EACH ROW EXECUTE FUNCTION bundleen_validate_visit_completion_proof();

-- Real visit ratings stay tied to the completed service, its provider, and
-- the resident's own household; comments may be empty, ratings remain 1..5.
CREATE FUNCTION bundleen_validate_visit_review_owner() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v "ServiceVisit"%ROWTYPE; provider_id TEXT;
BEGIN
  IF NEW."visitId" IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO v FROM "ServiceVisit" WHERE "id" = NEW."visitId" FOR UPDATE;
  SELECT a."providerUserId" INTO provider_id FROM "ServiceOccurrence" o JOIN "ServiceAgreement" a ON a."id" = o."agreementId"
    WHERE o."id" = v."occurrenceId" FOR SHARE OF o, a;
  IF v."status"::text IS DISTINCT FROM 'completed' OR NEW."providerUserId" IS DISTINCT FROM provider_id OR
     NOT bundleen_visit_photo_resident(NEW."reviewerUserId", NEW."visitId") THEN
    RAISE EXCEPTION 'A resident may review only completed work at their own home' USING ERRCODE = 'P1710';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "Review_visit_household" BEFORE INSERT OR UPDATE OF "visitId","reviewerUserId","providerUserId","rating","comment" ON "Review"
  FOR EACH ROW EXECUTE FUNCTION bundleen_validate_visit_review_owner();
