import type { AppRole } from "@/lib/validation/auth";

export type UserRole = AppRole;

const STORAGE_KEY = "bundleen.role";

/**
 * Navigation convenience only — NOT an authorization signal.
 *
 * This value lives in `localStorage`, so the user can set it to anything.
 * Nothing may read it to decide what a user is allowed to see: role checks go
 * through `requireRole()` on the server, which reads the signed session. It
 * exists so the multi-step onboarding form can remember a partial choice
 * across a reload before an account exists.
 */
export function saveRole(role: UserRole): void {
  if (typeof window === "undefined") {
    return;
  }

  localStorage.setItem(STORAGE_KEY, role);
}

export function getRole(): UserRole | null {
  if (typeof window === "undefined") {
    return null;
  }

  return (localStorage.getItem(STORAGE_KEY) as UserRole) ?? null;
}

export function clearRole(): void {
  if (typeof window === "undefined") {
    return;
  }

  localStorage.removeItem(STORAGE_KEY);
}
