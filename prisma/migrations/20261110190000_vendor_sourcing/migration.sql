-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AdminAuditAction" ADD VALUE 'vendor_lead_updated';
ALTER TYPE "AdminAuditAction" ADD VALUE 'vendor_leads_imported';
ALTER TYPE "AdminAuditAction" ADD VALUE 'vendor_referral_added';
ALTER TYPE "AdminAuditAction" ADD VALUE 'vendor_invites_queued';
ALTER TYPE "AdminAuditAction" ADD VALUE 'vendor_invitation_claimed';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AdminAuditTargetType" ADD VALUE 'vendor_lead';
ALTER TYPE "AdminAuditTargetType" ADD VALUE 'vendor_invitation';

-- AlterTable
ALTER TABLE "ServiceBid" ADD COLUMN     "vendorInvitationId" TEXT;

-- CreateTable
CREATE TABLE "VendorLead" (
    "id" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "licenseNumber" TEXT,
    "licenseJurisdiction" TEXT NOT NULL DEFAULT 'CA',
    "licenseClasses" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "licenseStatus" TEXT NOT NULL DEFAULT 'unknown',
    "licenseExpiresAt" DATE,
    "workersCompOnFile" BOOLEAN,
    "bondOnFile" BOOLEAN,
    "phone" TEXT,
    "phoneNormalized" TEXT,
    "email" TEXT,
    "emailDigest" TEXT,
    "emailDomain" TEXT,
    "contactConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "website" TEXT,
    "city" TEXT,
    "region" TEXT,
    "postalCode" TEXT,
    "county" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'new',
    "convertedProviderUserId" TEXT,
    "createdByUserId" TEXT,
    "lastInvitedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorLeadReferral" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendorLeadReferral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorRequestInvitation" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "invitedByUserId" TEXT NOT NULL,
    "recipientEmail" TEXT NOT NULL,
    "emailDigest" TEXT NOT NULL,
    "tokenNonce" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "claimedProviderUserId" TEXT,
    "claimedAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),
    "clickedAt" TIMESTAMP(3),
    "proposalStartedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorRequestInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorEmailSuppression" (
    "emailDigest" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorEmailSuppression_pkey" PRIMARY KEY ("emailDigest")
);

-- CreateTable
CREATE TABLE "VendorOutreachMessage" (
    "id" TEXT NOT NULL,
    "invitationId" TEXT NOT NULL,
    "slot" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "dueAt" TIMESTAMP(3) NOT NULL,
    "firstAttemptAt" TIMESTAMP(3),
    "reservationDay" TEXT,
    "payload" JSONB,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "providerMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorOutreachMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorOutreachBudget" (
    "key" TEXT NOT NULL,
    "used" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendorOutreachBudget_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "VendorWebhookEvent" (
    "id" TEXT NOT NULL,
    "providerMessageId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendorWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VendorLead_emailDigest_idx" ON "VendorLead"("emailDigest");

-- CreateIndex
CREATE INDEX "VendorLead_phoneNormalized_nameKey_idx" ON "VendorLead"("phoneNormalized", "nameKey");

-- CreateIndex
CREATE INDEX "VendorLead_status_updatedAt_idx" ON "VendorLead"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "VendorLead_licenseJurisdiction_licenseNumber_key" ON "VendorLead"("licenseJurisdiction", "licenseNumber");

-- CreateIndex
CREATE UNIQUE INDEX "VendorLeadReferral_leadId_requestId_createdByUserId_key" ON "VendorLeadReferral"("leadId", "requestId", "createdByUserId");

-- CreateIndex
CREATE INDEX "VendorRequestInvitation_emailDigest_idx" ON "VendorRequestInvitation"("emailDigest");

-- CreateIndex
CREATE INDEX "VendorRequestInvitation_requestId_createdAt_idx" ON "VendorRequestInvitation"("requestId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "VendorRequestInvitation_leadId_requestId_key" ON "VendorRequestInvitation"("leadId", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "VendorOutreachMessage_providerMessageId_key" ON "VendorOutreachMessage"("providerMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "VendorOutreachMessage_invitationId_slot_key" ON "VendorOutreachMessage"("invitationId", "slot");

-- CreateIndex
CREATE INDEX "VendorWebhookEvent_providerMessageId_processedAt_idx" ON "VendorWebhookEvent"("providerMessageId", "processedAt");

-- AddForeignKey
ALTER TABLE "ServiceBid" ADD CONSTRAINT "ServiceBid_vendorInvitationId_fkey" FOREIGN KEY ("vendorInvitationId") REFERENCES "VendorRequestInvitation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorLead" ADD CONSTRAINT "VendorLead_convertedProviderUserId_fkey" FOREIGN KEY ("convertedProviderUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorLead" ADD CONSTRAINT "VendorLead_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorLeadReferral" ADD CONSTRAINT "VendorLeadReferral_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "VendorLead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorLeadReferral" ADD CONSTRAINT "VendorLeadReferral_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "HoaServiceRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorLeadReferral" ADD CONSTRAINT "VendorLeadReferral_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorRequestInvitation" ADD CONSTRAINT "VendorRequestInvitation_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "VendorLead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorRequestInvitation" ADD CONSTRAINT "VendorRequestInvitation_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "HoaServiceRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorRequestInvitation" ADD CONSTRAINT "VendorRequestInvitation_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorRequestInvitation" ADD CONSTRAINT "VendorRequestInvitation_claimedProviderUserId_fkey" FOREIGN KEY ("claimedProviderUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorOutreachMessage" ADD CONSTRAINT "VendorOutreachMessage_invitationId_fkey" FOREIGN KEY ("invitationId") REFERENCES "VendorRequestInvitation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Durable invariants complement HTTP authorization. This migration never
-- promotes an imported lead to a verified provider or grants award authority.
ALTER TABLE "VendorLead" ADD CONSTRAINT "VendorLead_valid_contact" CHECK (
  ("email" IS NULL AND "emailDigest" IS NULL AND "contactConfirmed" = false) OR
  ("email" IS NOT NULL AND "emailDigest" IS NOT NULL AND "email" = lower(btrim("email")) AND "email" !~ E'[\\r\\n]' AND "emailDigest" = encode(sha256(convert_to("email", 'UTF8')), 'hex'))
);
ALTER TABLE "VendorLead" ADD CONSTRAINT "VendorLead_status" CHECK ("status" IN ('new','invited','engaged','signed_up','declined','unsubscribed','bounced'));
ALTER TABLE "VendorLead" ADD CONSTRAINT "VendorLead_location" CHECK (("latitude" IS NULL OR "latitude" BETWEEN -90 AND 90) AND ("longitude" IS NULL OR "longitude" BETWEEN -180 AND 180));
ALTER TABLE "VendorOutreachMessage" ADD CONSTRAINT "VendorOutreachMessage_slot" CHECK ("slot" BETWEEN 0 AND 2);
ALTER TABLE "VendorOutreachMessage" ADD CONSTRAINT "VendorOutreachMessage_status" CHECK ("status" IN ('pending','sent','skipped','uncertain'));
ALTER TABLE "VendorOutreachMessage" ADD CONSTRAINT "VendorOutreachMessage_reservation" CHECK (("firstAttemptAt" IS NULL AND "reservationDay" IS NULL AND "payload" IS NULL) OR ("firstAttemptAt" IS NOT NULL AND "reservationDay" IS NOT NULL AND "payload" IS NOT NULL));
ALTER TABLE "VendorOutreachBudget" ADD CONSTRAINT "VendorOutreachBudget_nonnegative" CHECK ("used" >= 0);
ALTER TABLE "VendorRequestInvitation" ADD CONSTRAINT "VendorRequestInvitation_claim" CHECK (("claimedProviderUserId" IS NULL) = ("claimedAt" IS NULL));
ALTER TABLE "VendorEmailSuppression" ADD CONSTRAINT "VendorEmailSuppression_format" CHECK ("emailDigest" ~ '^[a-f0-9]{64}$' AND "reason" IN ('unsubscribed','bounced'));

CREATE FUNCTION bundleen_assert_vendor_admin(actor_id TEXT) RETURNS void LANGUAGE plpgsql AS $$
DECLARE actor_email TEXT;
BEGIN
 SELECT "email" INTO actor_email FROM "User" WHERE "id"=actor_id AND "role"='admin' AND "isVerified" FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Active admin required' USING ERRCODE='P1703'; END IF;
 PERFORM 1 FROM "AdminAccessGrant" WHERE "userId"=actor_id AND "email"=lower(actor_email) AND "status"='active' AND NOT "isStaffAccount" FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Active exact admin grant required' USING ERRCODE='P1703'; END IF;
END; $$;

CREATE FUNCTION bundleen_validate_vendor_referral() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r "HoaServiceRequest"%ROWTYPE; via TEXT;
BEGIN
 SELECT * INTO r FROM "HoaServiceRequest" WHERE id=NEW."requestId" FOR UPDATE;
 IF r.status NOT IN ('collecting_interest','open_for_bids') THEN RAISE EXCEPTION 'Request not accepting referrals' USING ERRCODE='P1701'; END IF;
 PERFORM 1 FROM "Community" WHERE id=r."communityId" AND status='active' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Active community required' USING ERRCODE='P1701'; END IF;
 PERFORM 1 FROM "User" WHERE id=NEW."createdByUserId" AND "isVerified" FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Verified referral actor required' USING ERRCODE='P1703'; END IF;
 IF NEW.source='resident_referral' THEN
  PERFORM 1 FROM "CommunityMembership" WHERE "communityId"=r."communityId" AND "userId"=NEW."createdByUserId" AND status='active' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active community membership required' USING ERRCODE='P1703'; END IF;
 ELSIF NEW.source='hoa_referral' THEN
  IF EXISTS(SELECT 1 FROM "User" WHERE id=NEW."createdByUserId" AND role='admin') THEN
   PERFORM bundleen_assert_vendor_admin(NEW."createdByUserId");
  ELSE
   SELECT "role"::text INTO via FROM "CommunityStaffAssignment" WHERE "communityId"=r."communityId" AND "userId"=NEW."createdByUserId" AND status='active';
   PERFORM bundleen_assert_request_manager(NEW."createdByUserId", r.id, via);
  END IF;
 ELSE RAISE EXCEPTION 'Invalid referral source' USING ERRCODE='P1703';
 END IF;
 IF TG_OP='INSERT' AND (SELECT count(*) FROM "VendorLeadReferral" WHERE "requestId"=NEW."requestId" AND "createdByUserId"=NEW."createdByUserId") >= 5 THEN
  RAISE EXCEPTION 'Referral limit reached' USING ERRCODE='P1701';
 END IF;
 IF TG_OP='UPDATE' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Referral provenance immutable' USING ERRCODE='P1701'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "VendorLeadReferral_authority" BEFORE INSERT OR UPDATE ON "VendorLeadReferral" FOR EACH ROW EXECUTE FUNCTION bundleen_validate_vendor_referral();

CREATE FUNCTION bundleen_vendor_license_covers(category TEXT, classes TEXT[]) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE WHEN category='pool_care' THEN classes && ARRAY['D-35','C-53'] WHEN category='landscaping' THEN 'C-27'=ANY(classes) ELSE false END;
$$;

CREATE FUNCTION bundleen_validate_vendor_invitation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r "HoaServiceRequest"%ROWTYPE; l "VendorLead"%ROWTYPE; u "User"%ROWTYPE; p "ProviderProfile"%ROWTYPE;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF ROW(NEW.id,NEW."leadId",NEW."requestId",NEW."invitedByUserId",NEW."recipientEmail",NEW."emailDigest",NEW."tokenNonce",NEW."createdAt") IS DISTINCT FROM
     ROW(OLD.id,OLD."leadId",OLD."requestId",OLD."invitedByUserId",OLD."recipientEmail",OLD."emailDigest",OLD."tokenNonce",OLD."createdAt") OR NEW."expiresAt">OLD."expiresAt" OR
     (OLD."revokedAt" IS NOT NULL AND NEW."revokedAt" IS DISTINCT FROM OLD."revokedAt") OR
     (OLD."claimedProviderUserId" IS NOT NULL AND ROW(NEW."claimedProviderUserId",NEW."claimedAt") IS DISTINCT FROM ROW(OLD."claimedProviderUserId",OLD."claimedAt")) THEN
    RAISE EXCEPTION 'Invitation identity cannot change' USING ERRCODE='P1701';
  END IF;
  IF NEW."claimedProviderUserId" IS NOT DISTINCT FROM OLD."claimedProviderUserId" THEN RETURN NEW; END IF;
 END IF;
 SELECT * INTO r FROM "HoaServiceRequest" WHERE id=NEW."requestId" FOR UPDATE;
 SELECT * INTO l FROM "VendorLead" WHERE id=NEW."leadId" FOR SHARE;
 PERFORM 1 FROM "Community" WHERE id=r."communityId" AND status='active' FOR SHARE;
 IF NOT FOUND OR r.status<>'open_for_bids' OR r."biddingClosesAt" IS NULL THEN RAISE EXCEPTION 'Open active request required' USING ERRCODE='P1701'; END IF;
 IF TG_OP='INSERT' THEN PERFORM bundleen_assert_vendor_admin(NEW."invitedByUserId"); END IF;
 IF NOT COALESCE(l."licenseStatus"='active' AND l."licenseNumber" IS NOT NULL AND l."licenseExpiresAt">=(clock_timestamp() AT TIME ZONE 'UTC')::date
    AND r.category=ANY(l.categories) AND bundleen_vendor_license_covers(r.category,l."licenseClasses")
    AND l."contactConfirmed" AND l.email=NEW."recipientEmail" AND l."emailDigest"=NEW."emailDigest"
    AND (l.status NOT IN ('declined','unsubscribed','bounced','signed_up') OR (l.status='signed_up' AND NEW."claimedProviderUserId"=l."convertedProviderUserId")),false) OR EXISTS(SELECT 1 FROM "VendorEmailSuppression" WHERE "emailDigest"=NEW."emailDigest") THEN
   RAISE EXCEPTION 'Lead is not eligible for invitation' USING ERRCODE='P1701';
 END IF;
 IF NEW."claimedProviderUserId" IS NOT NULL THEN
  SELECT * INTO u FROM "User" WHERE id=NEW."claimedProviderUserId" FOR SHARE;
  SELECT * INTO p FROM "ProviderProfile" WHERE "userId"=u.id FOR SHARE;
  IF NOT COALESCE(u.role='provider' AND u."isVerified" AND lower(btrim(u.email))=NEW."recipientEmail" AND p."accountStatus" IN ('active','pending'),false) THEN
   RAISE EXCEPTION 'Exact verified provider claim required' USING ERRCODE='P1703';
  END IF;
  IF l."convertedProviderUserId" IS NOT NULL AND l."convertedProviderUserId"<>u.id THEN RAISE EXCEPTION 'Lead claimed by another provider' USING ERRCODE='P1703'; END IF;
 END IF;
 IF NEW."revokedAt" IS NOT NULL OR NEW."expiresAt">r."biddingClosesAt" OR NEW."expiresAt" <= (clock_timestamp() AT TIME ZONE 'UTC') OR r."biddingClosesAt" <= (clock_timestamp() AT TIME ZONE 'UTC') THEN
  RAISE EXCEPTION 'Invitation expired or revoked' USING ERRCODE='P1701';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "VendorRequestInvitation_guard" BEFORE INSERT OR UPDATE ON "VendorRequestInvitation" FOR EACH ROW EXECUTE FUNCTION bundleen_validate_vendor_invitation();

CREATE FUNCTION bundleen_validate_vendor_message() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE i "VendorRequestInvitation"%ROWTYPE;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF ROW(NEW.id,NEW."invitationId",NEW.slot,NEW."dueAt") IS DISTINCT FROM ROW(OLD.id,OLD."invitationId",OLD.slot,OLD."dueAt") OR
    (OLD."firstAttemptAt" IS NOT NULL AND ROW(NEW."firstAttemptAt",NEW."reservationDay",NEW.payload) IS DISTINCT FROM ROW(OLD."firstAttemptAt",OLD."reservationDay",OLD.payload)) OR
    (OLD."providerMessageId" IS NOT NULL AND NEW."providerMessageId" IS DISTINCT FROM OLD."providerMessageId") OR
    (OLD.status<>'pending' AND NEW.status IS DISTINCT FROM OLD.status) THEN
    RAISE EXCEPTION 'Outreach identity and attempt snapshot are immutable' USING ERRCODE='P1701';
  END IF;
 END IF;
 SELECT * INTO i FROM "VendorRequestInvitation" WHERE id=NEW."invitationId" FOR SHARE;
 IF TG_OP='INSERT' AND (NEW."dueAt">=i."expiresAt" OR NEW."dueAt"<i."createdAt" - INTERVAL '1 minute') THEN RAISE EXCEPTION 'Outreach slot outside invitation window' USING ERRCODE='P1701'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "VendorOutreachMessage_guard" BEFORE INSERT OR UPDATE ON "VendorOutreachMessage" FOR EACH ROW EXECUTE FUNCTION bundleen_validate_vendor_message();

CREATE FUNCTION bundleen_guard_vendor_suppression() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Global opt-out cannot be deleted by application flow' USING ERRCODE='P1703'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('vendor-email:' || NEW."emailDigest",0));
 IF TG_OP='UPDATE' AND NEW."emailDigest"<>OLD."emailDigest" THEN RAISE EXCEPTION 'Suppression identity immutable' USING ERRCODE='P1703'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "VendorEmailSuppression_guard" BEFORE INSERT OR UPDATE OR DELETE ON "VendorEmailSuppression" FOR EACH ROW EXECUTE FUNCTION bundleen_guard_vendor_suppression();

CREATE FUNCTION bundleen_assert_vendor_bid_grant(invitation_id TEXT, request_id TEXT, provider_id TEXT) RETURNS void LANGUAGE plpgsql AS $$
DECLARE i "VendorRequestInvitation"%ROWTYPE; r "HoaServiceRequest"%ROWTYPE; l "VendorLead"%ROWTYPE; u "User"%ROWTYPE; p "ProviderProfile"%ROWTYPE;
BEGIN
 SELECT * INTO r FROM "HoaServiceRequest" WHERE id=request_id FOR UPDATE;
 SELECT * INTO i FROM "VendorRequestInvitation" WHERE id=invitation_id FOR SHARE;
 SELECT * INTO l FROM "VendorLead" WHERE id=i."leadId" FOR SHARE;
 SELECT * INTO u FROM "User" WHERE id=provider_id FOR SHARE;
 SELECT * INTO p FROM "ProviderProfile" WHERE "userId"=provider_id FOR SHARE;
 IF NOT COALESCE(i."requestId"=r.id AND i."claimedProviderUserId"=provider_id AND i."claimedAt" IS NOT NULL AND i."revokedAt" IS NULL
    AND u.role='provider' AND u."isVerified" AND lower(btrim(u.email))=i."recipientEmail" AND p."accountStatus" IN ('active','pending')
    AND l."convertedProviderUserId"=provider_id AND l."licenseNumber" IS NOT NULL AND length(btrim(l."licenseNumber"))>0 AND l."licenseStatus"='active'
    AND EXISTS (SELECT 1 FROM "HoaProfile" hp WHERE hp."communityId"=r."communityId" AND upper(l."licenseJurisdiction")=CASE WHEN upper(hp.region)='CALIFORNIA' THEN 'CA' ELSE upper(hp.region) END) AND l."licenseExpiresAt">=(clock_timestamp() AT TIME ZONE 'UTC')::date
    AND r.category=ANY(l.categories) AND bundleen_vendor_license_covers(r.category,l."licenseClasses")
    AND r.status='open_for_bids' AND r."biddingClosesAt">(clock_timestamp() AT TIME ZONE 'UTC') AND i."expiresAt">(clock_timestamp() AT TIME ZONE 'UTC'),false) THEN
   RAISE EXCEPTION 'Valid claimed provider invitation required' USING ERRCODE='P1703';
 END IF;
END; $$;

-- Preserve normal lifecycle and award gates; only a verified invitation claim
-- permits a pending profile to submit a proposal, never to receive an award.
CREATE OR REPLACE FUNCTION "bundleen_validate_service_bid_mutation"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  request_state "HoaRequestStatus";
  closes_at TIMESTAMP(3);
  target_community TEXT;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(NEW) - 'updatedAt') IS NOT DISTINCT FROM (to_jsonb(OLD) - 'updatedAt') THEN
      RETURN NEW;
    END IF;
    IF NEW."requestId" IS DISTINCT FROM OLD."requestId"
       OR NEW."providerUserId" IS DISTINCT FROM OLD."providerUserId"
       OR NEW."vendorInvitationId" IS DISTINCT FROM OLD."vendorInvitationId" THEN
      RAISE EXCEPTION 'Bid identity cannot change'
        USING ERRCODE = 'P1701', CONSTRAINT = 'ServiceBid_identity_immutable';
    END IF;
  END IF;

  SELECT "status", "biddingClosesAt", "communityId"
  INTO request_state, closes_at, target_community
  FROM "HoaServiceRequest" WHERE "id" = NEW."requestId" FOR UPDATE;

  IF NEW."status" IN ('draft', 'submitted', 'withdrawn') THEN
    IF request_state IS DISTINCT FROM 'open_for_bids'
       OR (closes_at IS NOT NULL AND closes_at <= (clock_timestamp() AT TIME ZONE 'UTC')) THEN
      RAISE EXCEPTION 'Bid mutation requires an open bidding window'
        USING ERRCODE = 'P1701', CONSTRAINT = 'ServiceBid_request_open_required';
    END IF;
    IF TG_OP = 'INSERT' AND NEW."status" NOT IN ('draft', 'submitted') THEN
      RAISE EXCEPTION 'A new bid starts as draft or submitted'
        USING ERRCODE = 'P1701', CONSTRAINT = 'ServiceBid_initial_status';
    END IF;
    IF TG_OP = 'UPDATE' AND (OLD."status" NOT IN ('draft', 'submitted', 'withdrawn')
       OR (NEW."status" = 'withdrawn' AND OLD."status" <> 'submitted')) THEN
      RAISE EXCEPTION 'A decided bid cannot be resubmitted'
        USING ERRCODE = 'P1701', CONSTRAINT = 'ServiceBid_decided_immutable';
    END IF;
    PERFORM 1 FROM "Community" WHERE "id" = target_community AND "status" = 'active' FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Bid mutation requires an active community'
        USING ERRCODE = 'P1701', CONSTRAINT = 'ServiceBid_active_community_required';
    END IF;
  ELSE
    -- Manager decisions change status/timestamps only, never the quote terms.
    IF TG_OP <> 'UPDATE' THEN
      RAISE EXCEPTION 'A new bid starts as draft or submitted'
        USING ERRCODE = 'P1701', CONSTRAINT = 'ServiceBid_initial_status';
    END IF;
    IF OLD."status" <> 'submitted' OR
       (to_jsonb(NEW) - ARRAY['status', 'decidedAt', 'updatedAt']) IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['status', 'decidedAt', 'updatedAt']) THEN
      RAISE EXCEPTION 'A bid decision cannot rewrite quote terms'
        USING ERRCODE = 'P1702', CONSTRAINT = 'ServiceBid_decision_terms_immutable';
    END IF;
    IF (NEW."status" IN ('accepted', 'rejected') AND request_state IS DISTINCT FROM 'awarded')
       OR (NEW."status" = 'expired' AND request_state IS DISTINCT FROM 'cancelled') THEN
      RAISE EXCEPTION 'Bid decision conflicts with the request lifecycle'
        USING ERRCODE = 'P1702', CONSTRAINT = 'ServiceBid_request_decision_state';
    END IF;
    IF NEW."status" = 'accepted' AND (
       NEW."pricingBasis" <> 'total' OR NEW."perHomeCents" IS NOT NULL OR
       (NEW."validUntil" IS NOT NULL AND NEW."validUntil" <= (clock_timestamp() AT TIME ZONE 'UTC'))) THEN
      RAISE EXCEPTION 'Accepted quote must remain valid and use a whole job total'
        USING ERRCODE = 'P1702', CONSTRAINT = 'ServiceBid_valid_total_required';
    END IF;
    IF NEW."status" <> 'accepted' THEN RETURN NEW; END IF;
  END IF;

  -- Check the provider after acquiring the parent, including an accepted
  -- quote that may have waited behind another transaction. Losing decisions
  -- deliberately remain possible for a provider who was later suspended.
  PERFORM 1 FROM "User" WHERE "id" = NEW."providerUserId" AND "role" = 'provider' FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bid provider identity changed'
      USING ERRCODE = 'P1702', CONSTRAINT = 'ServiceBid_active_provider_required';
  END IF;
  IF NEW."vendorInvitationId" IS NOT NULL AND NEW."status" IN ('draft','submitted','withdrawn') THEN
    PERFORM bundleen_assert_vendor_bid_grant(NEW."vendorInvitationId", NEW."requestId", NEW."providerUserId");
    RETURN NEW;
  END IF;
  PERFORM 1 FROM "ProviderProfile"
  WHERE "userId" = NEW."providerUserId" AND "accountStatus" = 'active' FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bid provider is not active'
      USING ERRCODE = 'P1702', CONSTRAINT = 'ServiceBid_active_provider_required';
  END IF;
  -- Provider identity/profile locks may have waited past quote validity. The
  -- acceptance clock check must follow every awaited provider lock.
  IF NEW."status" = 'accepted' AND NEW."validUntil" IS NOT NULL
     AND NEW."validUntil" <= (clock_timestamp() AT TIME ZONE 'UTC') THEN
    RAISE EXCEPTION 'Accepted quote must remain valid and use a whole job total'
      USING ERRCODE = 'P1702', CONSTRAINT = 'ServiceBid_valid_total_required';
  END IF;
  -- A normal provider mutation can wait on those same locks. Recheck its
  -- bidding deadline here as well, after the wait rather than before it.
  IF NEW."status" IN ('draft', 'submitted', 'withdrawn') AND closes_at IS NOT NULL
     AND closes_at <= (clock_timestamp() AT TIME ZONE 'UTC') THEN
    RAISE EXCEPTION 'Bid mutation requires an open bidding window'
      USING ERRCODE = 'P1701', CONSTRAINT = 'ServiceBid_request_open_required';
  END IF;
  RETURN NEW;
END;
$$;

-- Generalize the existing admin invitation guard to supported categories;
-- current approved credential requirements remain unchanged.
CREATE OR REPLACE FUNCTION bundleen_validate_provider_bid_invitation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r "HoaServiceRequest"%ROWTYPE; actor_email TEXT; p "ProviderProfile"%ROWTYPE; l "MediaAsset"%ROWTYPE; i "MediaAsset"%ROWTYPE; today_utc DATE;
BEGIN
  SELECT * INTO r FROM "HoaServiceRequest" WHERE "id" = NEW."requestId" FOR UPDATE;
  IF r."status" IS DISTINCT FROM 'open_for_bids' THEN RAISE EXCEPTION 'Pool request is not accepting invitations' USING ERRCODE = 'P1701'; END IF;
  PERFORM 1 FROM "Community" WHERE "id" = r."communityId" AND "status" = 'active' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Community is inactive' USING ERRCODE = 'P1701'; END IF;
  SELECT "email" INTO actor_email FROM "User" WHERE "id" = NEW."invitedByUserId" AND "role" = 'admin' AND "isVerified" = true FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active admin required' USING ERRCODE = 'P1703'; END IF;
  PERFORM 1 FROM "AdminAccessGrant" WHERE "userId" = NEW."invitedByUserId" AND "email" = lower(actor_email)
    AND "status" = 'active' AND "isStaffAccount" = false FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active exact admin grant required' USING ERRCODE = 'P1703'; END IF;
  PERFORM 1 FROM "User" WHERE "id" = NEW."providerUserId" AND "role" = 'provider' AND "isVerified" FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active provider required' USING ERRCODE = 'P1701'; END IF;
  SELECT * INTO p FROM "ProviderProfile" WHERE "userId" = NEW."providerUserId" AND "accountStatus" = 'active' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active provider required' USING ERRCODE = 'P1701'; END IF;
  SELECT * INTO l FROM "MediaAsset" WHERE "id" = p."licenseDocumentId" FOR SHARE;
  SELECT * INTO i FROM "MediaAsset" WHERE "id" = p."insuranceDocumentId" FOR SHARE;
  today_utc := (clock_timestamp() AT TIME ZONE 'UTC')::date;
  IF NOT COALESCE(
    r."category" = ANY(p."trades")
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
    AND i."credentialSnapshot" = jsonb_build_object('insuranceProvider',p."insuranceProvider",'insurancePolicyNumber',p."insurancePolicyNumber"), false
  ) THEN RAISE EXCEPTION 'Invited provider needs current approved pool credentials' USING ERRCODE = 'P1701'; END IF;
  IF r."biddingClosesAt" IS NOT NULL AND r."biddingClosesAt" <= (clock_timestamp() AT TIME ZONE 'UTC') THEN
    RAISE EXCEPTION 'Bidding closed while preparing invitation' USING ERRCODE = 'P1701';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION bundleen_validate_approved_vendor() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Approved vendor identity is immutable' USING ERRCODE='P1703'; END IF;
 PERFORM bundleen_assert_provider_policy_manager(NEW."createdByUserId", NEW."communityId");
 PERFORM 1 FROM "User" WHERE id=NEW."providerUserId" AND role='provider' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Provider identity required' USING ERRCODE='P1703'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "ProviderCommunityApproval_authority" BEFORE INSERT OR UPDATE ON "ProviderCommunityApproval" FOR EACH ROW EXECUTE FUNCTION bundleen_validate_approved_vendor();
