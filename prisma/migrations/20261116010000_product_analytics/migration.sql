CREATE TABLE "ProductAnalyticsConsent" (
  "userId" TEXT PRIMARY KEY REFERENCES "User"("id") ON DELETE CASCADE,
  "allowed" BOOLEAN NOT NULL DEFAULT FALSE,
  "version" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "ProductAnalyticsEvent" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "ProductAnalyticsConsent"("userId") ON DELETE CASCADE,
  "event" TEXT NOT NULL,
  "properties" JSONB NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deliveredAt" TIMESTAMP(3),
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "attempts" INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX "ProductAnalyticsEvent_deliveredAt_nextAttemptAt_idx" ON "ProductAnalyticsEvent"("deliveredAt", "nextAttemptAt");
