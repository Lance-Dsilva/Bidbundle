CREATE TABLE "StripeTestEvent" (
  "id" TEXT PRIMARY KEY,
  "eventType" TEXT NOT NULL,
  "objectId" TEXT NOT NULL,
  "accountId" TEXT,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3)
);

CREATE INDEX "StripeTestEvent_processedAt_receivedAt_idx"
  ON "StripeTestEvent"("processedAt", "receivedAt");
