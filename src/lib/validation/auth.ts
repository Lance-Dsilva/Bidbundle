/**
 * Role and identity primitives.
 *
 * Deliberately dependency-free so `@/lib/validation/profile` — which owns every
 * profile-shaped schema, including onboarding — can build on it without an
 * import cycle.
 */

/** Public sign-up may only create these roles. `admin` is deliberately absent. */
export const PUBLIC_ROLES = ["homeowner", "provider"] as const;

/** Every role the application recognises, including ones only staff can hold. */
export const ALL_ROLES = ["homeowner", "provider", "admin"] as const;

export type PublicRole = (typeof PUBLIC_ROLES)[number];
export type AppRole = (typeof ALL_ROLES)[number];

export const MAX_NAME_LENGTH = 120;
export const MAX_PHONE_LENGTH = 32;

/** Maximum accepted JSON body for the auth routes, in bytes. */
export const MAX_AUTH_BODY_BYTES = 4 * 1024;

/**
 * Canonical email form used for storage, lookup, and rate-limit identifiers.
 *
 * Only case and surrounding whitespace are normalised. Provider-specific
 * tricks such as stripping Gmail dots or `+tags` are *not* applied: they would
 * make two addresses the user considers distinct collide, and they behave
 * differently across providers.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Narrowing helper for values arriving from JWTs, forms, and URL segments. */
export function isAppRole(value: unknown): value is AppRole {
  return typeof value === "string" && (ALL_ROLES as readonly string[]).includes(value);
}

/** Dashboard landing page for each role, used after sign-in and on redirects. */
export const DASHBOARD_BY_ROLE: Record<AppRole, string> = {
  homeowner: "/app/homeowner/dashboard",
  provider: "/app/provider/dashboard",
  admin: "/app/admin/dashboard",
};
