"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getToken } from "@/lib/auth";

export interface ProviderBid {
  id: number;
  request_id: number;
  request_title: string;
  request_category: string;
  request_neighborhood: string;
  request_status: string;
  amount: number;
  estimated_days: number;
  work_days: string[];
  status: string;
  created_at: string;
}

export function useProviderBids(status?: string) {
  const [bids, setBids] = useState<ProviderBid[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    const token = getToken();
    if (!token) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const params = status ? `?status=${encodeURIComponent(status)}` : "";
    apiFetch<ProviderBid[]>(`/provider/bids${params}`, { token })
      .then(setBids)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [status]);

  useEffect(() => { refresh(); }, [refresh]);

  return { bids, loading, error, refresh, setBids };
}
