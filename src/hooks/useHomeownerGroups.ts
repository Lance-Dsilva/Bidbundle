"use client";

import { useCallback, useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";
import { getToken } from "@/lib/auth";

export interface HomeownerGroup {
  group_id: number;
  category: string;
  neighborhood: string;
  status: string;
  member_count: number;
  approved_count: number;
  my_approval_status: string;
  my_request_id: number;
  grouping_closes_at: string;
  hours_remaining: number;
  created_at: string;
}

export function useHomeownerGroups() {
  const [groups, setGroups] = useState<HomeownerGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    const token = getToken();
    if (!token) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    apiFetch<HomeownerGroup[]>("/homeowner/groups", { token })
      .then(setGroups)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const approveGroup = useCallback(async (groupId: number) => {
    const token = getToken();
    if (!token) return;
    await apiFetch(`/homeowner/groups/${groupId}/approve`, { method: "POST", token });
    refresh();
  }, [refresh]);

  const cancelGroup = useCallback(async (groupId: number) => {
    const token = getToken();
    if (!token) return;
    await apiFetch(`/homeowner/groups/${groupId}/cancel`, { method: "POST", token });
    refresh();
  }, [refresh]);

  return { groups, loading, error, approveGroup, cancelGroup, refresh };
}
