"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getToken } from "@/lib/auth";

export interface ProviderDashboard {
  cold_start: boolean;
  active_bids: number;
  jobs_completed: number;
  revenue_30d_cents: number;
  revenue_total_cents: number;
  win_rate_pct: number | null;
  avg_rating: number | null;
  reviews_count: number;
  unread_messages: number;
}

export interface ProviderProfile {
  id: number;
  user_id: number;
  company_name: string | null;
  bio: string | null;
  trades: string;
  service_radius_mi: number;
  address: string | null;
  neighborhood: string | null;
  is_insured: boolean;
  is_licensed: boolean;
}

export function useProviderDashboard() {
  const [dashboard, setDashboard] = useState<ProviderDashboard | null>(null);
  const [profile, setProfile] = useState<ProviderProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setLoading(false);
      return;
    }
    Promise.all([
      apiFetch<ProviderDashboard>("/provider/dashboard", { token }),
      apiFetch<ProviderProfile>("/provider/me", { token }),
    ])
      .then(([dash, prof]) => {
        setDashboard(dash);
        setProfile(prof);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  return { dashboard, profile, loading, error };
}
