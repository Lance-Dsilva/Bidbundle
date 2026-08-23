-- Bundleen AI assistant:
--   * one assistant conversation per user, storing only the user's own text
--     and the assistant's final answer text (never raw tool call/result JSON);
--   * a content-free usage log for latency/model/tool-name observability.

CREATE TYPE "AiMessageRole" AS ENUM ('user', 'assistant');

CREATE TABLE "AiConversation" (
  "id"            TEXT NOT NULL,
  "userId"        TEXT NOT NULL,
  "contextKey"    TEXT NOT NULL DEFAULT 'general',
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiConversation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AiConversation_userId_contextKey_key" ON "AiConversation"("userId", "contextKey");
ALTER TABLE "AiConversation"
  ADD CONSTRAINT "AiConversation_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AiMessage" (
  "id"             TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "role"           "AiMessageRole" NOT NULL,
  "content"        TEXT NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiMessage_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AiMessage_conversationId_createdAt_idx" ON "AiMessage"("conversationId", "createdAt");
ALTER TABLE "AiMessage"
  ADD CONSTRAINT "AiMessage_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "AiConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AiUsageLog" (
  "id"               TEXT NOT NULL,
  "userId"           TEXT,
  "role"             "UserRole" NOT NULL,
  "model"            TEXT NOT NULL,
  "latencyMs"        INTEGER NOT NULL,
  "toolNames"        TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "success"          BOOLEAN NOT NULL,
  "errorType"        TEXT,
  "promptTokens"     INTEGER,
  "completionTokens" INTEGER,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiUsageLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AiUsageLog_createdAt_idx" ON "AiUsageLog"("createdAt");
CREATE INDEX "AiUsageLog_userId_createdAt_idx" ON "AiUsageLog"("userId", "createdAt");
ALTER TABLE "AiUsageLog"
  ADD CONSTRAINT "AiUsageLog_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
