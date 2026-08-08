-- CreateEnum
CREATE TYPE "Weekday" AS ENUM ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('not_connected', 'pending', 'active', 'restricted');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "address" TEXT,
ADD COLUMN     "avatarPath" TEXT,
ADD COLUMN     "avatarUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "avatarUrl" TEXT,
ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION,
ADD COLUMN     "neighborhood" TEXT;

-- CreateTable
CREATE TABLE "HomeownerProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "notifyBids" BOOLEAN NOT NULL DEFAULT true,
    "notifyGroups" BOOLEAN NOT NULL DEFAULT true,
    "notifySavings" BOOLEAN NOT NULL DEFAULT false,
    "notifyEmail" BOOLEAN NOT NULL DEFAULT true,
    "notifyPush" BOOLEAN NOT NULL DEFAULT true,
    "serviceRadiusMi" INTEGER NOT NULL DEFAULT 4,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HomeownerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyName" TEXT,
    "bio" TEXT,
    "trades" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "serviceRadiusMi" INTEGER NOT NULL DEFAULT 4,
    "workingDays" "Weekday"[] DEFAULT ARRAY[]::"Weekday"[],
    "workingHoursStart" TEXT,
    "workingHoursEnd" TEXT,
    "licenseNumber" TEXT,
    "licenseState" TEXT,
    "insuranceProvider" TEXT,
    "insurancePolicyNumber" TEXT,
    "licenseVerifiedAt" TIMESTAMP(3),
    "insuranceVerifiedAt" TIMESTAMP(3),
    "payoutStatus" "PayoutStatus" NOT NULL DEFAULT 'not_connected',
    "payoutLast4" TEXT,
    "payoutProvider" TEXT,
    "payoutUpdatedAt" TIMESTAMP(3),
    "notifyNewJobs" BOOLEAN NOT NULL DEFAULT true,
    "notifyMessages" BOOLEAN NOT NULL DEFAULT true,
    "notifyPayouts" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HomeownerProfile_userId_key" ON "HomeownerProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderProfile_userId_key" ON "ProviderProfile"("userId");

-- AddForeignKey
ALTER TABLE "HomeownerProfile" ADD CONSTRAINT "HomeownerProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderProfile" ADD CONSTRAINT "ProviderProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: give every existing user the role profile the application now
-- expects to exist. Purely additive — no existing row is updated or removed,
-- and the NOT EXISTS guard makes a re-run a no-op. Admins get neither profile;
-- nothing reads one for them.
INSERT INTO "HomeownerProfile" ("id", "userId", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, u."id", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "User" u
WHERE u."role" = 'homeowner'
  AND NOT EXISTS (SELECT 1 FROM "HomeownerProfile" h WHERE h."userId" = u."id");

INSERT INTO "ProviderProfile" ("id", "userId", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, u."id", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "User" u
WHERE u."role" = 'provider'
  AND NOT EXISTS (SELECT 1 FROM "ProviderProfile" p WHERE p."userId" = u."id");
