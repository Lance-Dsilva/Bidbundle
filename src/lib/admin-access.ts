import { normalizeEmail } from "@/lib/validation/auth";

/**
 * The one bootstrap owner for this installation.
 *
 * Vercel should set `BUNDLEEN_ADMIN_OWNER_EMAIL` to the same value. The
 * fallback prevents a missing deployment variable from locking the owner out;
 * this is an identifier, not a secret or an authentication credential.
 */
export const PRIMARY_ADMIN_EMAIL = normalizeEmail(
  process.env.BUNDLEEN_ADMIN_OWNER_EMAIL || "lancedsilva2000@gmail.com",
);

export type AdminAccessLevel = "owner" | "admin";
export type AdminAccessStatus = "pending" | "active" | "revoked";

export type AdminAccessSummary = {
  id: string;
  email: string;
  level: AdminAccessLevel;
  status: AdminAccessStatus;
  fullName: string | null;
  grantedByName: string | null;
  grantedAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
};

export function isPrimaryAdminEmail(email: string): boolean {
  return normalizeEmail(email) === PRIMARY_ADMIN_EMAIL;
}

