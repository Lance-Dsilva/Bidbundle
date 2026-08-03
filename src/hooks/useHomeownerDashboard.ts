"use client";

import { useCallback, useEffect, useState } from "react";

import { fetchMe, getToken, type AuthUser } from "@/lib/auth";
import { apiFetch } from "@/lib/api";

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
    const token = getToken();
    if (!token) {
      setLoading(false);
      return;
    }
    Promise.all([
      apiFetch<HomeownerDashboard>("/homeowner/dashboard", { token }),
      fetchMe(token),
    ])
      .then(([dash, me]) => {
        setDashboard(dash);
        setUser(me);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();

    const onFocus = () => refresh();
    const onVisibility = () => { if (!document.hidden) refresh(); };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  return { dashboard, user, loading, error, refresh };
}
