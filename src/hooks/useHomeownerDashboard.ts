"use client";

import { useCallback, useEffect, useState } from "react";

import { fetchMe, type AuthUser } from "@/lib/auth";
import { apiFetch } from "@/lib/api";

/**
 * Counters for the homeowner shell and dashboard.
 *
 * Reads `/api/homeowner/dashboard`, which aggregates only rows the signed-in
 * account owns. The old `getToken()` gate is gone: it returned a placeholder
 * string, so it never gated anything, and the session travels as Clerk's
 * HttpOnly same-origin cookie instead.
 */
export interface HomeownerDashboard {
  cold_start: boolean;
  active_requests: number;
  active_bids: number;
  total_saved_cents: number;
  unread_messages: number;
}

export function useHomeownerDashboard() {
  const [dashboard, setDashboard] = useState<HomeownerDashboard | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    Promise.all([apiFetch<HomeownerDashboard>("/homeowner/dashboard"), fetchMe()])
      .then(([dash, me]) => {
        setDashboard(dash);
        setUser(me);
        setError(null);
      })
      .catch((cause: unknown) =>
        setError(
          cause instanceof Error
            ? cause.message
            : "We could not load your dashboard. Please try again.",
        ),
      )
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();

    const onFocus = () => refresh();
    const onVisibility = () => {
      if (!document.hidden) refresh();
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  return { dashboard, user, loading, error, refresh };
}
