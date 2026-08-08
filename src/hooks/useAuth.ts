"use client";

import { useUser } from "@clerk/nextjs";
import { useEffect, useState } from "react";

import { fetchMe } from "@/lib/auth";
import type { AppRole } from "@/lib/validation/auth";

/**
 * Authentication state for Client Components, derived from the Clerk
 * session rather than from `localStorage`.
 *
 * This is display state only. It tells the UI what to render; it never
 * decides what the user may do. Every protected page re-checks the session on
 * the server, so editing this value in devtools changes nothing but pixels.
 */

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  role: AppRole;
}

export interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  isAuthenticated: boolean;
}

export function useAuth(): AuthState {
  const { isLoaded, isSignedIn } = useUser();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);

  useEffect(() => {
    let active = true;

    if (!isLoaded || !isSignedIn) {
      setUser(null);
      setLoadingProfile(false);
      return () => {
        active = false;
      };
    }

    setLoadingProfile(true);
    fetchMe()
      .then((profile) => {
        if (!active) return;
        setUser({
          id: profile.id,
          email: profile.email,
          name: profile.full_name || null,
          role: profile.role,
        });
      })
      .catch(() => {
        if (active) setUser(null);
      })
      .finally(() => {
        if (active) setLoadingProfile(false);
      });

    return () => {
      active = false;
    };
  }, [isLoaded, isSignedIn]);

  return {
    user,
    loading: !isLoaded || loadingProfile,
    isAuthenticated: Boolean(isSignedIn && user),
  };
}
