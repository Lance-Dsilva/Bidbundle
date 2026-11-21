ALTER TYPE "SupportTicketCategory" ADD VALUE 'service_quality';
CREATE TABLE "ServiceQualityClaim" (
  "id" TEXT PRIMARY KEY,
  "visitId" TEXT NOT NULL UNIQUE REFERENCES "ServiceVisit"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "ticketId" TEXT NOT NULL UNIQUE REFERENCES "SupportTicket"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "requesterUserId" TEXT NOT NULL,
  "providerUserId" TEXT NOT NULL,
  "reason" TEXT NOT NULL CHECK ("reason" IN ('incomplete', 'not_as_described', 'damage', 'other')),
  "resolution" TEXT NOT NULL DEFAULT 'reported' CHECK ("resolution" IN ('reported', 'redo_pending', 'refund_pending')),
  "resolutionNote" TEXT,
  "resolutionRequestedBy" TEXT,
  "resolutionRequestedAt" TIMESTAMP(3),
  "providerResponse" TEXT,
  "providerRespondedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (("resolution" = 'reported' AND "resolutionRequestedAt" IS NULL AND "resolutionRequestedBy" IS NULL) OR ("resolution" <> 'reported' AND "resolutionRequestedAt" IS NOT NULL AND "resolutionRequestedBy" IS NOT NULL)),
  CHECK (("providerResponse" IS NULL) = ("providerRespondedAt" IS NULL))
);
CREATE INDEX "ServiceQualityClaim_providerUserId_createdAt_idx" ON "ServiceQualityClaim"("providerUserId", "createdAt");
