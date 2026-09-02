-- Job conversations between a provider and the customer whose request they
-- quoted.
--
-- The provider console shipped a messaging screen against endpoints that were
-- never built, so there was nothing behind it. This adds the smallest real
-- model that screen needs: a thread bound to one `HoaServiceRequest` and one
-- provider, and its messages.
--
-- The participant pair is derived on the server from the request's creator and
-- the provider's bid/award. Nothing here lets a caller name the other party,
-- which is the property the API relies on for isolation.

-- ── ServiceConversation ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "ServiceConversation" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "providerUserId" TEXT NOT NULL,
  "customerUserId" TEXT NOT NULL,
  "lastMessageAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ServiceConversation_pkey" PRIMARY KEY ("id")
);

-- A provider and a customer are two different accounts. A row where they are
-- the same is a bug in whatever wrote it, not a self-note feature.
ALTER TABLE "ServiceConversation" DROP CONSTRAINT IF EXISTS "ServiceConversation_distinct_parties";
ALTER TABLE "ServiceConversation" ADD CONSTRAINT "ServiceConversation_distinct_parties" CHECK (
  "providerUserId" <> "customerUserId"
);

-- One thread per request per provider: concurrent first messages from the two
-- sides converge on the same row instead of forking the conversation.
CREATE UNIQUE INDEX IF NOT EXISTS "ServiceConversation_requestId_providerUserId_key"
  ON "ServiceConversation"("requestId", "providerUserId");
CREATE INDEX IF NOT EXISTS "ServiceConversation_providerUserId_lastMessageAt_idx"
  ON "ServiceConversation"("providerUserId", "lastMessageAt");
CREATE INDEX IF NOT EXISTS "ServiceConversation_customerUserId_lastMessageAt_idx"
  ON "ServiceConversation"("customerUserId", "lastMessageAt");

-- ── ConversationMessage ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "ConversationMessage" (
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "senderUserId" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConversationMessage_pkey" PRIMARY KEY ("id")
);

-- An empty message carries no meaning and would still bump the thread to the
-- top of both inboxes. The API validator bounds the upper end.
ALTER TABLE "ConversationMessage" DROP CONSTRAINT IF EXISTS "ConversationMessage_body_present";
ALTER TABLE "ConversationMessage" ADD CONSTRAINT "ConversationMessage_body_present" CHECK (
  length(btrim("body")) > 0
);

CREATE INDEX IF NOT EXISTS "ConversationMessage_conversationId_createdAt_idx"
  ON "ConversationMessage"("conversationId", "createdAt");
CREATE INDEX IF NOT EXISTS "ConversationMessage_conversationId_senderUserId_readAt_idx"
  ON "ConversationMessage"("conversationId", "senderUserId", "readAt");

-- ── Foreign keys ──────────────────────────────────────────────────────────
-- Written with a guard so a re-run on a partially applied database is safe.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ServiceConversation_requestId_fkey') THEN
    ALTER TABLE "ServiceConversation" ADD CONSTRAINT "ServiceConversation_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "HoaServiceRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ServiceConversation_providerUserId_fkey') THEN
    ALTER TABLE "ServiceConversation" ADD CONSTRAINT "ServiceConversation_providerUserId_fkey" FOREIGN KEY ("providerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ServiceConversation_customerUserId_fkey') THEN
    ALTER TABLE "ServiceConversation" ADD CONSTRAINT "ServiceConversation_customerUserId_fkey" FOREIGN KEY ("customerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ConversationMessage_conversationId_fkey') THEN
    ALTER TABLE "ConversationMessage" ADD CONSTRAINT "ConversationMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ServiceConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ConversationMessage_senderUserId_fkey') THEN
    ALTER TABLE "ConversationMessage" ADD CONSTRAINT "ConversationMessage_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;
