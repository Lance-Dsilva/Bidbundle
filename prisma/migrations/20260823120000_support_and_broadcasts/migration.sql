-- Customer support ticketing, admin-reviewed ticket AI, and audited global
-- operational broadcasts.

-- ── Audit vocabulary ───────────────────────────────────────────────────────
ALTER TYPE "AdminAuditAction" ADD VALUE IF NOT EXISTS 'support_ticket_assigned';
ALTER TYPE "AdminAuditAction" ADD VALUE IF NOT EXISTS 'support_ticket_status_changed';
ALTER TYPE "AdminAuditAction" ADD VALUE IF NOT EXISTS 'support_ticket_priority_changed';
ALTER TYPE "AdminAuditAction" ADD VALUE IF NOT EXISTS 'support_ticket_replied';
ALTER TYPE "AdminAuditAction" ADD VALUE IF NOT EXISTS 'support_ticket_ai_draft_approved';
ALTER TYPE "AdminAuditAction" ADD VALUE IF NOT EXISTS 'broadcast_created';
ALTER TYPE "AdminAuditAction" ADD VALUE IF NOT EXISTS 'broadcast_updated';
ALTER TYPE "AdminAuditAction" ADD VALUE IF NOT EXISTS 'broadcast_test_sent';
ALTER TYPE "AdminAuditAction" ADD VALUE IF NOT EXISTS 'broadcast_sent';
ALTER TYPE "AdminAuditAction" ADD VALUE IF NOT EXISTS 'broadcast_discarded';
ALTER TYPE "AdminAuditAction" ADD VALUE IF NOT EXISTS 'admin_permissions_changed';

ALTER TYPE "AdminAuditTargetType" ADD VALUE IF NOT EXISTS 'support_ticket';
ALTER TYPE "AdminAuditTargetType" ADD VALUE IF NOT EXISTS 'broadcast';

-- ── Admin permissions ──────────────────────────────────────────────────────
-- Additive and empty by default: an ordinary admin grant must never imply the
-- power to email every customer.
ALTER TABLE "AdminAccessGrant"
  ADD COLUMN IF NOT EXISTS "permissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- ── Enums ──────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "SupportTicketStatus" AS ENUM ('new','open','pending_customer','pending_internal','resolved','closed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "SupportTicketPriority" AS ENUM ('low','normal','high','urgent');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "SupportTicketCategory" AS ENUM ('account','billing','service_request','bidding','scheduling','provider_issue','community','technical','other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "SupportTicketMessageKind" AS ENUM ('customer_reply','admin_reply','internal_note');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "SupportTicketEventType" AS ENUM ('created','status_changed','priority_changed','assigned','unassigned','customer_replied','admin_replied','internal_note_added','reopened','ai_draft_generated','ai_draft_approved','ai_draft_discarded','ai_explanation_generated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "SupportTicketAiDraftKind" AS ENUM ('reply','explanation');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "SupportTicketAiDraftStatus" AS ENUM ('generated','discarded','approved');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "BroadcastSeverity" AS ENUM ('announcement','maintenance','degraded','outage','security');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "BroadcastStatus" AS ENUM ('draft','queued','processing','completed','failed','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "BroadcastRecipientStatus" AS ENUM ('pending','sent','failed','suppressed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Support tickets ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "SupportTicket" (
  "id"                    TEXT PRIMARY KEY,
  "ticketNumber"          TEXT NOT NULL,
  "requesterUserId"       TEXT NOT NULL,
  "requesterRole"         "UserRole" NOT NULL,
  "communityId"           TEXT,
  "subject"               TEXT NOT NULL,
  "category"              "SupportTicketCategory" NOT NULL,
  "status"                "SupportTicketStatus" NOT NULL DEFAULT 'new',
  "priority"              "SupportTicketPriority" NOT NULL DEFAULT 'normal',
  "relatedRequestId"      TEXT,
  "relatedBidId"          TEXT,
  "relatedVisitId"        TEXT,
  "assignedAdminUserId"   TEXT,
  "firstAdminReplyAt"     TIMESTAMP(3),
  "lastCustomerMessageAt" TIMESTAMP(3),
  "lastAdminMessageAt"    TIMESTAMP(3),
  "lastActivityAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt"            TIMESTAMP(3),
  "closedAt"              TIMESTAMP(3),
  "reopenedFromTicketId"  TEXT,
  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SupportTicket_requesterUserId_fkey"
    FOREIGN KEY ("requesterUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SupportTicket_communityId_fkey"
    FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "SupportTicket_assignedAdminUserId_fkey"
    FOREIGN KEY ("assignedAdminUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  -- A subject is the only thing an admin sees in the queue; an empty one makes
  -- a ticket unfindable, and the length ceiling matches the Zod schema.
  CONSTRAINT "support_ticket_subject_check"
    CHECK (length(btrim("subject")) BETWEEN 1 AND 160),
  -- Resolution timestamps must agree with the status they describe.
  CONSTRAINT "support_ticket_resolution_check" CHECK (
    ("status" <> 'resolved' OR "resolvedAt" IS NOT NULL)
    AND ("status" <> 'closed' OR "closedAt" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS "SupportTicket_ticketNumber_key" ON "SupportTicket"("ticketNumber");
CREATE INDEX IF NOT EXISTS "SupportTicket_status_priority_lastActivityAt_idx" ON "SupportTicket"("status","priority","lastActivityAt");
CREATE INDEX IF NOT EXISTS "SupportTicket_requesterUserId_createdAt_idx" ON "SupportTicket"("requesterUserId","createdAt");
CREATE INDEX IF NOT EXISTS "SupportTicket_assignedAdminUserId_status_idx" ON "SupportTicket"("assignedAdminUserId","status");
CREATE INDEX IF NOT EXISTS "SupportTicket_communityId_createdAt_idx" ON "SupportTicket"("communityId","createdAt");
CREATE INDEX IF NOT EXISTS "SupportTicket_category_status_idx" ON "SupportTicket"("category","status");

-- Human-friendly, gap-tolerant, immutable ticket numbers (BDL-000001). A
-- sequence rather than count(*)+1: concurrent inserts must never collide.
CREATE SEQUENCE IF NOT EXISTS "support_ticket_number_seq" START 1000;

-- The number identifies the ticket to the customer forever. Rewriting it would
-- invalidate every email and screenshot that quotes it.
CREATE OR REPLACE FUNCTION support_ticket_number_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW."ticketNumber" IS DISTINCT FROM OLD."ticketNumber" THEN
    RAISE EXCEPTION 'SupportTicket.ticketNumber is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS support_ticket_number_immutable ON "SupportTicket";
CREATE TRIGGER support_ticket_number_immutable
  BEFORE UPDATE ON "SupportTicket"
  FOR EACH ROW EXECUTE FUNCTION support_ticket_number_immutable();

CREATE TABLE IF NOT EXISTS "SupportTicketMessage" (
  "id"            TEXT PRIMARY KEY,
  "ticketId"      TEXT NOT NULL,
  "authorUserId"  TEXT,
  "kind"          "SupportTicketMessageKind" NOT NULL,
  "body"          TEXT NOT NULL,
  "fromAiDraftId" TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupportTicketMessage_ticketId_fkey"
    FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SupportTicketMessage_authorUserId_fkey"
    FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "support_ticket_message_body_check"
    CHECK (length(btrim("body")) BETWEEN 1 AND 10000)
);
CREATE INDEX IF NOT EXISTS "SupportTicketMessage_ticketId_createdAt_idx" ON "SupportTicketMessage"("ticketId","createdAt");

CREATE TABLE IF NOT EXISTS "SupportTicketEvent" (
  "id"          TEXT PRIMARY KEY,
  "ticketId"    TEXT NOT NULL,
  "actorUserId" TEXT,
  "type"        "SupportTicketEventType" NOT NULL,
  "fromValue"   TEXT,
  "toValue"     TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupportTicketEvent_ticketId_fkey"
    FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SupportTicketEvent_actorUserId_fkey"
    FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "SupportTicketEvent_ticketId_createdAt_idx" ON "SupportTicketEvent"("ticketId","createdAt");

CREATE TABLE IF NOT EXISTS "SupportTicketAiDraft" (
  "id"                     TEXT PRIMARY KEY,
  "ticketId"               TEXT NOT NULL,
  "kind"                   "SupportTicketAiDraftKind" NOT NULL,
  "status"                 "SupportTicketAiDraftStatus" NOT NULL DEFAULT 'generated',
  "generatedByAdminUserId" TEXT NOT NULL,
  "content"                TEXT NOT NULL,
  "model"                  TEXT NOT NULL,
  "toolNames"              TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "approvedByAdminUserId"  TEXT,
  "approvedAt"             TIMESTAMP(3),
  "sentText"               TEXT,
  "sentMessageId"          TEXT,
  "createdAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"              TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SupportTicketAiDraft_ticketId_fkey"
    FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SupportTicketAiDraft_generatedByAdminUserId_fkey"
    FOREIGN KEY ("generatedByAdminUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SupportTicketAiDraft_approvedByAdminUserId_fkey"
    FOREIGN KEY ("approvedByAdminUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  -- "Approved" must always name the human who approved it and the exact text
  -- that was sent. An approval without either is unreviewable.
  CONSTRAINT "support_ai_draft_approval_check" CHECK (
    "status" <> 'approved'
    OR ("approvedByAdminUserId" IS NOT NULL AND "approvedAt" IS NOT NULL AND "sentText" IS NOT NULL)
  ),
  -- An internal explanation is never sent to a customer, so it can never be
  -- in the approved-and-sent state at all.
  CONSTRAINT "support_ai_explanation_never_sent_check" CHECK (
    "kind" <> 'explanation' OR ("status" <> 'approved' AND "sentMessageId" IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS "SupportTicketAiDraft_ticketId_kind_createdAt_idx" ON "SupportTicketAiDraft"("ticketId","kind","createdAt");

-- ── Broadcasts ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "Broadcast" (
  "id"                       TEXT PRIMARY KEY,
  "subject"                  TEXT NOT NULL,
  "body"                     TEXT NOT NULL,
  "severity"                 "BroadcastSeverity" NOT NULL DEFAULT 'announcement',
  "status"                   "BroadcastStatus" NOT NULL DEFAULT 'draft',
  "inAppTitle"               TEXT,
  "inAppBody"                TEXT,
  "linkPath"                 TEXT,
  "audienceSegments"         TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "overridesEmailPreference" BOOLEAN NOT NULL DEFAULT false,
  "createdByUserId"          TEXT NOT NULL,
  "approvedByUserId"         TEXT,
  "approvedAt"               TIMESTAMP(3),
  "recipientCount"           INTEGER NOT NULL DEFAULT 0,
  "queuedAt"                 TIMESTAMP(3),
  "completedAt"              TIMESTAMP(3),
  "createdAt"                TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Broadcast_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Broadcast_approvedByUserId_fkey"
    FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "broadcast_content_check" CHECK (
    length(btrim("subject")) BETWEEN 1 AND 160
    AND length(btrim("body")) BETWEEN 1 AND 5000
  ),
  -- Only a clearly classified urgent operational or security message may reach
  -- accounts that turned general announcement email off. An ordinary
  -- announcement cannot set the override at all.
  CONSTRAINT "broadcast_override_severity_check" CHECK (
    "overridesEmailPreference" = false
    OR "severity" IN ('maintenance','degraded','outage','security')
  ),
  -- Anything past draft was approved by a named human at a known time.
  CONSTRAINT "broadcast_approval_check" CHECK (
    "status" IN ('draft','cancelled')
    OR ("approvedByUserId" IS NOT NULL AND "approvedAt" IS NOT NULL AND "queuedAt" IS NOT NULL)
  ),
  -- Only the app's own paths; never an off-site destination in a mass email.
  CONSTRAINT "broadcast_link_path_check" CHECK (
    "linkPath" IS NULL OR ("linkPath" LIKE '/%' AND "linkPath" NOT LIKE '//%')
  )
);
CREATE INDEX IF NOT EXISTS "Broadcast_status_createdAt_idx" ON "Broadcast"("status","createdAt");
CREATE INDEX IF NOT EXISTS "Broadcast_severity_createdAt_idx" ON "Broadcast"("severity","createdAt");

CREATE TABLE IF NOT EXISTS "BroadcastRecipient" (
  "id"               TEXT PRIMARY KEY,
  "broadcastId"      TEXT NOT NULL,
  "userId"           TEXT NOT NULL,
  "email"            TEXT NOT NULL,
  "status"           "BroadcastRecipientStatus" NOT NULL DEFAULT 'pending',
  "suppressedReason" TEXT,
  "sentAt"           TIMESTAMP(3),
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BroadcastRecipient_broadcastId_fkey"
    FOREIGN KEY ("broadcastId") REFERENCES "Broadcast"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "BroadcastRecipient_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- These two uniques are the idempotency guarantee: a retried send inserts with
-- skipDuplicates and therefore cannot produce a second email to anyone, by
-- account or by address.
CREATE UNIQUE INDEX IF NOT EXISTS "BroadcastRecipient_broadcastId_userId_key" ON "BroadcastRecipient"("broadcastId","userId");
CREATE UNIQUE INDEX IF NOT EXISTS "BroadcastRecipient_broadcastId_email_key" ON "BroadcastRecipient"("broadcastId","email");
CREATE INDEX IF NOT EXISTS "BroadcastRecipient_broadcastId_status_idx" ON "BroadcastRecipient"("broadcastId","status");
