"use client";

import type { AppRole } from "@/lib/validation/auth";

/**
 * Compatibility helpers for screens that predate Clerk. No token is stored or
 * returned here: Clerk's HttpOnly session cookie is attached to same-origin
 * requests by the browser and verified by the Clerk middleware.
 */

export interface AuthUser {
  id: string;
  email: string;
  full_name: string;
  phone?: string | null;
  role: AppRole;
  neighborhood: string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  neighbourhood_id?: number | null;
  is_verified: boolean;
}

/**
 * @deprecated Not a credential. Legacy callers only use this as a truthy
 * marker before making a same-origin request. Remove it as those hooks move to
 * direct Clerk-aware API calls.
 */
export function getToken(): string {
  return "clerk-session-cookie";
}

/** @deprecated Clerk owns session storage; there is no local token to clear. */
export function clearAuth(): void {
  // Intentionally empty.
}

/** Reads the current Bundleen profile resolved from the verified Clerk user. */
export async function fetchMe(_legacyToken?: string): Promise<AuthUser> {
  const response = await fetch("/api/auth/me", {
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!response.ok) throw new Error("Not authenticated");
  return response.json() as Promise<AuthUser>;
}
