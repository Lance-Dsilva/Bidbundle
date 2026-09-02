-- Job conversations need their own notification kind: a homeowner's reply to a
-- provider is not a bid, an award, or a schedule change, and folding it into
-- one of those would make the recipient's filters lie.
--
-- Kept in its own migration so the enum value is committed before the tables
-- in `20260901090000_service_conversations` start referencing it.

ALTER TYPE "NotificationKind" ADD VALUE IF NOT EXISTS 'message';
