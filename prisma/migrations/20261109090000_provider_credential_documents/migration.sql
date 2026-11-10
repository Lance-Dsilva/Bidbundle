-- CreateEnum
CREATE TYPE "CredentialReviewStatus" AS ENUM ('pending', 'approved', 'rejected');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "MediaPurpose" ADD VALUE 'provider_license';
ALTER TYPE "MediaPurpose" ADD VALUE 'provider_insurance';

-- AlterTable
ALTER TABLE "HoaProfile" ADD COLUMN     "minimumInsuranceCoverageCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "requiresAdditionalInsured" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ProviderProfile" ADD COLUMN     "insuranceAdditionalInsured" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "insuranceCoverageCents" INTEGER,
ADD COLUMN     "insuranceDocumentId" TEXT,
ADD COLUMN     "insuranceExpiresAt" DATE,
ADD COLUMN     "insuranceVerifiedDocumentChecksum" TEXT,
ADD COLUMN     "licenseDocumentId" TEXT,
ADD COLUMN     "licenseExpiresAt" DATE,
ADD COLUMN     "licenseVerifiedDocumentChecksum" TEXT;

-- AlterTable
ALTER TABLE "MediaAsset" ADD COLUMN     "credentialAdditionalInsured" BOOLEAN,
ADD COLUMN     "credentialCoverageCents" INTEGER,
ADD COLUMN     "credentialExpiresAt" DATE,
ADD COLUMN     "credentialReviewReason" TEXT,
ADD COLUMN     "credentialReviewStatus" "CredentialReviewStatus" NOT NULL DEFAULT 'pending',
ADD COLUMN     "credentialReviewedAt" TIMESTAMP(3),
ADD COLUMN     "credentialReviewedByUserId" TEXT,
ADD COLUMN     "credentialSnapshot" JSONB,
ADD COLUMN     "providerProfileId" TEXT,
ALTER COLUMN "communityId" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "ProviderProfile_licenseDocumentId_key" ON "ProviderProfile"("licenseDocumentId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderProfile_insuranceDocumentId_key" ON "ProviderProfile"("insuranceDocumentId");

-- AddForeignKey
ALTER TABLE "ProviderProfile" ADD CONSTRAINT "ProviderProfile_licenseDocumentId_fkey" FOREIGN KEY ("licenseDocumentId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderProfile" ADD CONSTRAINT "ProviderProfile_insuranceDocumentId_fkey" FOREIGN KEY ("insuranceDocumentId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_providerProfileId_fkey" FOREIGN KEY ("providerProfileId") REFERENCES "ProviderProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Credential evidence is not community media. Keep the existing amenity owner
-- matrix strict; only provider documents may have a null community and a PDF.
ALTER TABLE "MediaAsset" DROP CONSTRAINT "MediaAsset_one_owner";
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_one_owner" CHECK (
  (("purpose"::text IN ('provider_license','provider_insurance'))
    AND "providerProfileId" IS NOT NULL AND "communityId" IS NULL
    AND "amenityId" IS NULL AND "reviewId" IS NULL AND "issueId" IS NULL
    AND "storageUrl" = '' AND "credentialSnapshot" IS NOT NULL)
  OR
  (("purpose"::text IN ('amenity_gallery','amenity_review','amenity_issue'))
    AND "providerProfileId" IS NULL AND "communityId" IS NOT NULL
    AND num_nonnulls("amenityId","reviewId","issueId") = 1
    AND ("purpose"::text <> 'amenity_gallery' OR "amenityId" IS NOT NULL)
    AND ("purpose"::text <> 'amenity_review' OR "reviewId" IS NOT NULL)
    AND ("purpose"::text <> 'amenity_issue' OR "issueId" IS NOT NULL))
);
ALTER TABLE "MediaAsset" DROP CONSTRAINT "MediaAsset_supported_type";
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_supported_type" CHECK (
  "byteSize" > 0 AND (
    "contentType" IN ('image/jpeg','image/png','image/webp')
    OR ("purpose"::text IN ('provider_license','provider_insurance') AND "contentType" = 'application/pdf')
  ) AND ("purpose"::text NOT IN ('provider_license','provider_insurance') OR "byteSize" <= 5242880)
);
ALTER TABLE "ProviderProfile" ADD CONSTRAINT "ProviderProfile_insurance_coverage_nonnegative" CHECK ("insuranceCoverageCents" >= 0);
ALTER TABLE "HoaProfile" ADD CONSTRAINT "HoaProfile_insurance_coverage_nonnegative" CHECK ("minimumInsuranceCoverageCents" >= 0);
CREATE INDEX "MediaAsset_providerProfileId_purpose_status_idx" ON "MediaAsset"("providerProfileId","purpose","status");
