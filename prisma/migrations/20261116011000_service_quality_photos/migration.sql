CREATE TABLE "ServiceQualityPhoto" (
 "id" TEXT PRIMARY KEY,
 "claimId" TEXT NOT NULL REFERENCES "ServiceQualityClaim"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "uploaderUserId" TEXT NOT NULL,
 "storagePath" TEXT NOT NULL UNIQUE,
 "contentType" TEXT NOT NULL CHECK ("contentType" IN ('image/jpeg','image/png','image/webp')),
 "byteSize" INTEGER NOT NULL CHECK ("byteSize" BETWEEN 1 AND 4194304),
 "checksum" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "ServiceQualityPhoto_claimId_createdAt_idx" ON "ServiceQualityPhoto"("claimId","createdAt");
