-- Community placement and other automated workflows create audit events without
-- an authenticated administrator. Keep those system events distinct from
-- administrator actions by allowing a null actor, as defined in schema.prisma.
ALTER TABLE "AdminAuditLog"
  ALTER COLUMN "actorUserId" DROP NOT NULL;
