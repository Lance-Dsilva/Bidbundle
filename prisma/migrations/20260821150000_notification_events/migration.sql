-- Notification categories used by account, security, and timed reminder mail.
ALTER TYPE "NotificationKind" ADD VALUE IF NOT EXISTS 'account';
ALTER TYPE "NotificationKind" ADD VALUE IF NOT EXISTS 'security';
ALTER TYPE "NotificationKind" ADD VALUE IF NOT EXISTS 'reminder';
