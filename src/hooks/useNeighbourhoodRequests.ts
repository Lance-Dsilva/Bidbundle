import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getToken } from "@/lib/auth";

export interface NeighbourhoodRequest {
  id: number;
  title: string;
  category: string;
  neighborhood: string;
  status: string;
  group_status?: string | null;
  budget_min: number;
  budget_max: number;
  bid_count: number;
  owner_name: string;
  is_mine: boolean;
}

export function useNeighbourhoodRequests() {
  const [requests, setRequests] = useState<NeighbourhoodRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(() => {
    const token = getToken();
    if (!token) { setLoading(false); return; }
    setLoading(true);
    apiFetch<NeighbourhoodRequest[]>("/neighbourhood/requests", { token })
      .then(setRequests)
      .catch(() => setRequests([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();

    const onFocus = () => refresh();
    const onVisibility = () => { if (!document.hidden) refresh(); };
    const interval = window.setInterval(refresh, 15000);

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  return { requests, loading, refresh };
}
