-- Bundleen staff may start an auditable support conversation from a provider
-- CRM record. The support tables already model the thread; this value makes
-- the initiating admin action explicit in the immutable audit trail.

ALTER TYPE "AdminAuditAction" ADD VALUE IF NOT EXISTS 'support_ticket_created';
