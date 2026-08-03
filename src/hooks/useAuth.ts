"use client";

import { useEffect, useState } from "react";
import { type AuthUser, fetchMe, getToken } from "@/lib/auth";

export interface AuthState {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  isAuthenticated: boolean;
}

export function useAuth(): AuthState {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const stored = getToken();
    if (!stored) {
      setLoading(false);
      return;
    }
    setToken(stored);
    fetchMe(stored)
      .then(setUser)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return { user, token, loading, isAuthenticated: !!user };
}
