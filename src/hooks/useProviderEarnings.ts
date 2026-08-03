"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getToken } from "@/lib/auth";

export interface EarningsData {
  total_cents: number;
  pending_cents: number;
  this_month_cents: number;
  jobs_total: number;
  jobs_this_month: number;
  avg_job_value_cents: number;
}

export function useProviderEarnings() {
  const [earnings, setEarnings] = useState<EarningsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = getToken();
    if (!token) { setLoading(false); return; }
    apiFetch<EarningsData>("/provider/earnings", { token })
      .then(setEarnings)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  const fmt = (cents: number) =>
    `$${Math.round(cents / 100).toLocaleString()}`;

  return { earnings, loading, error, fmt };
}
