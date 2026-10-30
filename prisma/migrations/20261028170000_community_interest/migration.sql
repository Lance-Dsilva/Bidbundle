-- A contact lead is not a Bundleen identity or an authorization grant.
CREATE TYPE "CommunityInterestContactRole" AS ENUM (
  'community_manager', 'hoa_board', 'property_manager', 'resident', 'other'
);

CREATE TABLE "CommunityInterest" (
  "id" TEXT NOT NULL,
  "contactName" TEXT NOT NULL,
  "contactRole" "CommunityInterestContactRole" NOT NULL,
  "communityName" TEXT NOT NULL,
  "communityKey" TEXT NOT NULL,
  "numberOfHomes" INTEGER NOT NULL,
  "email" TEXT NOT NULL,
  "phone" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommunityInterest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommunityInterest_contactName_bounds" CHECK (LENGTH(BTRIM("contactName")) BETWEEN 1 AND 120),
  CONSTRAINT "CommunityInterest_communityName_bounds" CHECK (LENGTH(BTRIM("communityName")) BETWEEN 1 AND 160),
  CONSTRAINT "CommunityInterest_communityKey_bounds" CHECK (LENGTH(BTRIM("communityKey")) BETWEEN 1 AND 320),
  CONSTRAINT "CommunityInterest_home_count_bounds" CHECK ("numberOfHomes" BETWEEN 1 AND 10000),
  CONSTRAINT "CommunityInterest_email_normalized" CHECK (
    LENGTH("email") BETWEEN 3 AND 254 AND "email" = LOWER(BTRIM("email"))
  ),
  CONSTRAINT "CommunityInterest_phone_bounds" CHECK ("phone" IS NULL OR LENGTH(BTRIM("phone")) BETWEEN 1 AND 32)
);
CREATE UNIQUE INDEX "CommunityInterest_email_communityKey_key" ON "CommunityInterest"("email", "communityKey");
CREATE INDEX "CommunityInterest_createdAt_id_idx" ON "CommunityInterest"("createdAt", "id");
