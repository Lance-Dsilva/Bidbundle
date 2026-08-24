/**
 * Named admin capabilities that portal access alone does not grant.
 *
 * Deliberately additive and closed. `AdminAccessGrant.level` answers "may this
 * person open the internal portal at all"; this list answers "may this person
 * do the small number of things whose blast radius reaches every customer".
 * Holding `admin` grants none of them.
 *
 * Client-safe: the UI renders these labels, and the server re-checks the same
 * strings from the database on every request.
 */

export const ADMIN_PERMISSIONS = [
  /** Compose, preview, and test-send a broadcast. No global delivery. */
  "communications:draft",
  /** Send a broadcast to real customers. The high-risk one. */
  "communications:send_global",
] as const;

export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

export const ADMIN_PERMISSION_LABELS: Record<AdminPermission, string> = {
  "communications:draft": "Draft operational broadcasts",
  "communications:send_global": "Send global operational emails",
};

export const ADMIN_PERMISSION_DESCRIPTIONS: Record<AdminPermission, string> = {
  "communications:draft":
    "Write and preview platform-wide messages, and send a test to themselves. Cannot deliver to customers.",
  "communications:send_global":
    "Deliver an approved broadcast to every matching active account. Grant sparingly.",
};

export function isAdminPermission(value: unknown): value is AdminPermission {
  return (
    typeof value === "string" && (ADMIN_PERMISSIONS as readonly string[]).includes(value)
  );
}

/**
 * Whether an access grant carries a capability.
 *
 * The owner implicitly holds every permission — they are the account that
 * grants them, so requiring the owner to grant themselves would be a
 * bootstrapping problem with no security benefit. Every other level must have
 * the exact string stored.
 */
export function hasAdminPermission(
  access: { level: "owner" | "admin" | null; permissions?: readonly string[] | null },
  permission: AdminPermission,
): boolean {
  if (access.level === "owner") return true;
  if (access.level !== "admin") return false;
  return (access.permissions ?? []).includes(permission);
}

/** Drops anything not in the closed list, so an unknown string grants nothing. */
export function normalizeAdminPermissions(values: readonly unknown[]): AdminPermission[] {
  const unique = new Set<AdminPermission>();
  for (const value of values) if (isAdminPermission(value)) unique.add(value);
  return [...unique];
}
