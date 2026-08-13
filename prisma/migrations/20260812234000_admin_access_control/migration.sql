-- The public registration flow still exposes only homeowner/provider. Admin
-- access is a second, explicit allow-list controlled by the primary owner.

CREATE TYPE "AdminAccessLevel" AS ENUM ('owner', 'admin');
CREATE TYPE "AdminAccessStatus" AS ENUM ('pending', 'active', 'revoked');

ALTER TYPE "AdminAuditAction" ADD VALUE 'admin_access_granted';
ALTER TYPE "AdminAuditAction" ADD VALUE 'admin_access_revoked';
ALTER TYPE "AdminAuditTargetType" ADD VALUE 'admin_access';

CREATE TABLE "AdminAccessGrant" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "level" "AdminAccessLevel" NOT NULL DEFAULT 'admin',
    "status" "AdminAccessStatus" NOT NULL DEFAULT 'pending',
    "userId" TEXT,
    "previousRole" "UserRole",
    "clerkInvitationId" TEXT,
    "grantedByUserId" TEXT,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    "revokedByUserId" TEXT,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminAccessGrant_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AdminAccessGrant_email_normalized_check"
      CHECK ("email" = lower(btrim("email"))),
    CONSTRAINT "AdminAccessGrant_active_user_check"
      CHECK ("status" <> 'active' OR "userId" IS NOT NULL),
    CONSTRAINT "AdminAccessGrant_revoked_at_check"
      CHECK (
        ("status" = 'revoked' AND "revokedAt" IS NOT NULL)
        OR ("status" <> 'revoked' AND "revokedAt" IS NULL)
      )
);

CREATE UNIQUE INDEX "AdminAccessGrant_email_key" ON "AdminAccessGrant"("email");
CREATE UNIQUE INDEX "AdminAccessGrant_userId_key" ON "AdminAccessGrant"("userId");
CREATE UNIQUE INDEX "AdminAccessGrant_clerkInvitationId_key" ON "AdminAccessGrant"("clerkInvitationId");
CREATE INDEX "AdminAccessGrant_status_email_idx" ON "AdminAccessGrant"("status", "email");

ALTER TABLE "AdminAccessGrant"
  ADD CONSTRAINT "AdminAccessGrant_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AdminAccessGrant"
  ADD CONSTRAINT "AdminAccessGrant_grantedByUserId_fkey"
  FOREIGN KEY ("grantedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AdminAccessGrant"
  ADD CONSTRAINT "AdminAccessGrant_revokedByUserId_fkey"
  FOREIGN KEY ("revokedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Bootstrap the one immutable owner requested for this installation. If the
-- account has already completed Bundleen sign-up it is linked and activated;
-- otherwise the pending email row becomes active only after Clerk proves the
-- same verified address.
INSERT INTO "AdminAccessGrant" (
  "id",
  "email",
  "level",
  "status",
  "userId",
  "previousRole",
  "acceptedAt",
  "updatedAt"
)
SELECT
  'bundleen-primary-admin-owner',
  'lancedsilva2000@gmail.com',
  'owner'::"AdminAccessLevel",
  CASE WHEN u."id" IS NULL THEN 'pending'::"AdminAccessStatus" ELSE 'active'::"AdminAccessStatus" END,
  u."id",
  u."role",
  CASE WHEN u."id" IS NULL THEN NULL ELSE CURRENT_TIMESTAMP END,
  CURRENT_TIMESTAMP
FROM (VALUES ('lancedsilva2000@gmail.com')) AS seed(email)
LEFT JOIN "User" u ON lower(u."email") = seed.email;

UPDATE "User"
SET "role" = 'admin'::"UserRole", "updatedAt" = CURRENT_TIMESTAMP
WHERE lower("email") = 'lancedsilva2000@gmail.com';

-- The owner email and owner level are immutable. Linking a pending owner row
-- to the matching Clerk-backed User and activating it is deliberately allowed.
CREATE OR REPLACE FUNCTION "bundleen_protect_primary_admin_owner"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD."level" = 'owner' THEN
    RAISE EXCEPTION 'the primary admin owner cannot be deleted'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD."level" = 'owner' AND (
    NEW."level" <> 'owner'
    OR NEW."email" <> OLD."email"
    OR NEW."status" = 'revoked'
  ) THEN
    RAISE EXCEPTION 'the primary admin owner cannot be changed or revoked'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "AdminAccessGrant_protect_owner"
  BEFORE UPDATE OR DELETE ON "AdminAccessGrant"
  FOR EACH ROW
  EXECUTE FUNCTION "bundleen_protect_primary_admin_owner"();
