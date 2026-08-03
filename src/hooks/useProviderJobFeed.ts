"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getToken } from "@/lib/auth";

export interface JobFeedItem {
  id: number;
  title: string;
  category: string;
  neighborhood: string;
  group_id?: number | null;
  member_count?: number | null;
  is_group?: boolean;
  primary_request_id?: number | null;
  distance_mi: number | null;
  status: string;
  budget_min: number;
  budget_max: number;
  bid_count: number;
  created_at: string;
  closes_at: string | null;
}

export function useProviderJobFeed(category?: string, neighborhood?: string) {
  const [jobs, setJobs] = useState<JobFeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    const token = getToken();
    if (!token) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const searchParams = new URLSearchParams();
    if (category) searchParams.set("category", category);
    if (neighborhood) searchParams.set("neighborhood", neighborhood);
    const params = searchParams.toString() ? `?${searchParams.toString()}` : "";
    apiFetch<JobFeedItem[]>(`/provider/job-feed${params}`, { token })
      .then(setJobs)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [category, neighborhood]);

  useEffect(() => { refresh(); }, [refresh]);

  return { jobs, loading, error, refresh, setJobs };
}
