-- Clarified community workflow:
--   * radius-matched neighborhood residents join immediately;
--   * HOA access is email-invitation based;
--   * HOA managers own community requests and monthly surveys.

ALTER TYPE "AdminAuditAction" ADD VALUE 'community_invitation_sent';
ALTER TYPE "AdminAuditAction" ADD VALUE 'community_invitation_accepted';
ALTER TYPE "AdminAuditAction" ADD VALUE 'community_invitation_revoked';
ALTER TYPE "AdminAuditAction" ADD VALUE 'hoa_request_created';
ALTER TYPE "AdminAuditAction" ADD VALUE 'hoa_request_status_changed';
ALTER TYPE "AdminAuditAction" ADD VALUE 'hoa_survey_created';
ALTER TYPE "AdminAuditAction" ADD VALUE 'hoa_survey_status_changed';

ALTER TYPE "AdminAuditTargetType" ADD VALUE 'community_invitation';
ALTER TYPE "AdminAuditTargetType" ADD VALUE 'hoa_request';
ALTER TYPE "AdminAuditTargetType" ADD VALUE 'hoa_survey';

CREATE TYPE "CommunityInvitationRole" AS ENUM ('hoa_manager', 'homeowner');
CREATE TYPE "CommunityInvitationStatus" AS ENUM ('pending', 'accepted', 'revoked');
CREATE TYPE "HoaRequestKind" AS ENUM ('compulsory_recurring', 'optional_group');
CREATE TYPE "HoaRequestStatus" AS ENUM ('draft', 'open', 'closed', 'cancelled');
CREATE TYPE "HoaSurveyStatus" AS ENUM ('draft', 'open', 'closed');

CREATE TABLE "CommunityInvitation" (
  "id" TEXT NOT NULL,
  "communityId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "role" "CommunityInvitationRole" NOT NULL,
  "status" "CommunityInvitationStatus" NOT NULL DEFAULT 'pending',
  "clerkInvitationId" TEXT,
  "invitedByUserId" TEXT NOT NULL,
  "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3),
  "acceptedByUserId" TEXT,
  "acceptedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CommunityInvitation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommunityInvitation_email_normalized" CHECK (
    "email" = LOWER(BTRIM("email")) AND LENGTH("email") BETWEEN 3 AND 254
  ),
  CONSTRAINT "CommunityInvitation_status_dates" CHECK (
    ("status" = 'pending' AND "acceptedAt" IS NULL AND "revokedAt" IS NULL)
    OR ("status" = 'accepted' AND "acceptedAt" IS NOT NULL AND "revokedAt" IS NULL)
    OR ("status" = 'revoked' AND "acceptedAt" IS NULL AND "revokedAt" IS NOT NULL)
  )
);

CREATE TABLE "HoaServiceRequest" (
  "id" TEXT NOT NULL,
  "communityId" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "kind" "HoaRequestKind" NOT NULL,
  "recurrenceLabel" TEXT,
  "status" "HoaRequestStatus" NOT NULL DEFAULT 'draft',
  "opensAt" TIMESTAMP(3),
  "closesAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HoaServiceRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "HoaServiceRequest_dates" CHECK (
    "opensAt" IS NULL OR "closesAt" IS NULL OR "closesAt" > "opensAt"
  ),
  CONSTRAINT "HoaServiceRequest_recurrence" CHECK (
    "kind" <> 'compulsory_recurring' OR NULLIF(BTRIM("recurrenceLabel"), '') IS NOT NULL
  )
);

CREATE TABLE "HoaRequestParticipation" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HoaRequestParticipation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HoaSurvey" (
  "id" TEXT NOT NULL,
  "communityId" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "monthKey" TEXT NOT NULL,
  "question" TEXT NOT NULL,
  "options" TEXT[] NOT NULL,
  "status" "HoaSurveyStatus" NOT NULL DEFAULT 'draft',
  "closesAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HoaSurvey_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "HoaSurvey_month_key" CHECK ("monthKey" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT "HoaSurvey_option_count" CHECK (CARDINALITY("options") BETWEEN 2 AND 10)
);

CREATE TABLE "HoaSurveyVote" (
  "id" TEXT NOT NULL,
  "surveyId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "optionIndex" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HoaSurveyVote_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "HoaSurveyVote_nonnegative_option" CHECK ("optionIndex" >= 0)
);

CREATE UNIQUE INDEX "CommunityInvitation_clerkInvitationId_key"
  ON "CommunityInvitation"("clerkInvitationId");
CREATE UNIQUE INDEX "CommunityInvitation_communityId_email_role_key"
  ON "CommunityInvitation"("communityId", "email", "role");
CREATE INDEX "CommunityInvitation_email_status_idx"
  ON "CommunityInvitation"("email", "status");
CREATE INDEX "CommunityInvitation_communityId_status_idx"
  ON "CommunityInvitation"("communityId", "status");

CREATE INDEX "HoaServiceRequest_communityId_status_createdAt_idx"
  ON "HoaServiceRequest"("communityId", "status", "createdAt");
CREATE UNIQUE INDEX "HoaRequestParticipation_requestId_userId_key"
  ON "HoaRequestParticipation"("requestId", "userId");
CREATE INDEX "HoaRequestParticipation_userId_joinedAt_idx"
  ON "HoaRequestParticipation"("userId", "joinedAt");
CREATE UNIQUE INDEX "HoaSurvey_communityId_monthKey_key"
  ON "HoaSurvey"("communityId", "monthKey");
CREATE INDEX "HoaSurvey_communityId_status_createdAt_idx"
  ON "HoaSurvey"("communityId", "status", "createdAt");
CREATE UNIQUE INDEX "HoaSurveyVote_surveyId_userId_key"
  ON "HoaSurveyVote"("surveyId", "userId");
CREATE INDEX "HoaSurveyVote_userId_createdAt_idx"
  ON "HoaSurveyVote"("userId", "createdAt");

ALTER TABLE "CommunityInvitation"
  ADD CONSTRAINT "CommunityInvitation_communityId_fkey"
  FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommunityInvitation"
  ADD CONSTRAINT "CommunityInvitation_invitedByUserId_fkey"
  FOREIGN KEY ("invitedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CommunityInvitation"
  ADD CONSTRAINT "CommunityInvitation_acceptedByUserId_fkey"
  FOREIGN KEY ("acceptedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "HoaServiceRequest"
  ADD CONSTRAINT "HoaServiceRequest_communityId_fkey"
  FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HoaServiceRequest"
  ADD CONSTRAINT "HoaServiceRequest_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HoaRequestParticipation"
  ADD CONSTRAINT "HoaRequestParticipation_requestId_fkey"
  FOREIGN KEY ("requestId") REFERENCES "HoaServiceRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HoaRequestParticipation"
  ADD CONSTRAINT "HoaRequestParticipation_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "HoaSurvey"
  ADD CONSTRAINT "HoaSurvey_communityId_fkey"
  FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HoaSurvey"
  ADD CONSTRAINT "HoaSurvey_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HoaSurveyVote"
  ADD CONSTRAINT "HoaSurveyVote_surveyId_fkey"
  FOREIGN KEY ("surveyId") REFERENCES "HoaSurvey"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HoaSurveyVote"
  ADD CONSTRAINT "HoaSurveyVote_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Every invitation is for an HOA, and only Bundleen staff can issue the first
-- manager invitation. Resident invitations are issued by that scoped manager
-- in the service layer.
CREATE OR REPLACE FUNCTION "bundleen_validate_hoa_invitation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "Community"
    WHERE "id" = NEW."communityId" AND "type" = 'hoa' AND "status" = 'active'
  ) THEN
    RAISE EXCEPTION 'community invitation requires an active HOA'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'CommunityInvitation_active_hoa_required';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "CommunityInvitation_validate_hoa"
  BEFORE INSERT OR UPDATE OF "communityId", "status"
  ON "CommunityInvitation"
  FOR EACH ROW
  WHEN (NEW."status" = 'pending')
  EXECUTE FUNCTION "bundleen_validate_hoa_invitation"();

CREATE OR REPLACE FUNCTION "bundleen_validate_hoa_content"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "Community"
    WHERE "id" = NEW."communityId" AND "type" = 'hoa' AND "status" = 'active'
  ) THEN
    RAISE EXCEPTION 'HOA content requires an active HOA'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'HoaContent_active_hoa_required';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "CommunityStaffAssignment"
    WHERE "communityId" = NEW."communityId"
      AND "userId" = NEW."createdByUserId"
      AND "role" = 'hoa_manager'
      AND "status" = 'active'
  ) THEN
    RAISE EXCEPTION 'HOA content creator is not the active HOA manager'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'HoaContent_manager_required';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "HoaServiceRequest_validate_creator"
  BEFORE INSERT OR UPDATE OF "communityId", "createdByUserId"
  ON "HoaServiceRequest"
  FOR EACH ROW EXECUTE FUNCTION "bundleen_validate_hoa_content"();
CREATE TRIGGER "HoaSurvey_validate_creator"
  BEFORE INSERT OR UPDATE OF "communityId", "createdByUserId"
  ON "HoaSurvey"
  FOR EACH ROW EXECUTE FUNCTION "bundleen_validate_hoa_content"();

CREATE OR REPLACE FUNCTION "bundleen_validate_hoa_survey_vote"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  option_count INTEGER;
  target_community TEXT;
  survey_state "HoaSurveyStatus";
BEGIN
  SELECT CARDINALITY("options"), "communityId", "status"
    INTO option_count, target_community, survey_state
  FROM "HoaSurvey" WHERE "id" = NEW."surveyId";

  IF survey_state IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION 'survey is not open'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'HoaSurveyVote_open_survey_required';
  END IF;
  IF NEW."optionIndex" >= option_count THEN
    RAISE EXCEPTION 'survey option is out of range'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'HoaSurveyVote_option_range';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "CommunityMembership"
    WHERE "communityId" = target_community
      AND "userId" = NEW."userId"
      AND "status" = 'active'
  ) THEN
    RAISE EXCEPTION 'survey vote requires active HOA membership'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'HoaSurveyVote_active_member_required';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "HoaSurveyVote_validate"
  BEFORE INSERT OR UPDATE OF "surveyId", "userId", "optionIndex"
  ON "HoaSurveyVote"
  FOR EACH ROW EXECUTE FUNCTION "bundleen_validate_hoa_survey_vote"();

CREATE OR REPLACE FUNCTION "bundleen_validate_hoa_request_participation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_community TEXT;
  request_kind "HoaRequestKind";
  request_state "HoaRequestStatus";
BEGIN
  SELECT "communityId", "kind", "status"
    INTO target_community, request_kind, request_state
  FROM "HoaServiceRequest" WHERE "id" = NEW."requestId";

  IF request_kind IS DISTINCT FROM 'optional_group' OR request_state IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION 'only open optional HOA requests may be joined'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'HoaRequestParticipation_open_optional_required';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "CommunityMembership"
    WHERE "communityId" = target_community
      AND "userId" = NEW."userId"
      AND "status" = 'active'
  ) THEN
    RAISE EXCEPTION 'request participation requires active HOA membership'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'HoaRequestParticipation_active_member_required';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "HoaRequestParticipation_validate"
  BEFORE INSERT OR UPDATE OF "requestId", "userId"
  ON "HoaRequestParticipation"
  FOR EACH ROW EXECUTE FUNCTION "bundleen_validate_hoa_request_participation"();

-- Existing algorithmic placements no longer wait for an admin decision.
ALTER TABLE "CommunityMembership" ALTER COLUMN "status" SET DEFAULT 'active';

UPDATE "CommunityMembership" membership
SET
  "status" = 'active',
  "joinedAt" = COALESCE(membership."joinedAt", CURRENT_TIMESTAMP),
  "updatedAt" = CURRENT_TIMESTAMP
FROM "Community" community
WHERE community."id" = membership."communityId"
  AND community."type" = 'neighborhood'
  AND membership."status" = 'pending'
  AND NOT membership."isAdminOverride";

-- Keep that rule at the database boundary as well as in the matcher. A future
-- code path cannot accidentally recreate an algorithmic approval queue.
CREATE OR REPLACE FUNCTION "bundleen_activate_automatic_neighborhood_membership"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."status" = 'pending' AND NOT NEW."isAdminOverride" AND EXISTS (
    SELECT 1 FROM "Community"
    WHERE "id" = NEW."communityId" AND "type" = 'neighborhood'
  ) THEN
    NEW."status" := 'active';
    NEW."joinedAt" := COALESCE(NEW."joinedAt", CURRENT_TIMESTAMP);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "CommunityMembership_activate_automatic_neighborhood"
  BEFORE INSERT OR UPDATE OF "communityId", "status", "isAdminOverride"
  ON "CommunityMembership"
  FOR EACH ROW EXECUTE FUNCTION "bundleen_activate_automatic_neighborhood_membership"();
