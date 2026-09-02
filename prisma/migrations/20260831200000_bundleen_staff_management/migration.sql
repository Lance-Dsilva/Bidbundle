ALTER TYPE "AdminAuditAction" ADD VALUE IF NOT EXISTS 'hoa_unit_removed';

ALTER TABLE "AdminAccessGrant"
  ADD COLUMN IF NOT EXISTS "isStaffAccount" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "AdminAccessGrant_isStaffAccount_status_idx"
  ON "AdminAccessGrant"("isStaffAccount", "status");
