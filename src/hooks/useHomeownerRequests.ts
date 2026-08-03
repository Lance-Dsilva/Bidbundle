"use client";

import { useEffect, useState } from "react";

import { getToken } from "@/lib/auth";
import { apiFetch } from "@/lib/api";

export interface HomeownerRequest {
  id: number;
  title: string;
  description: string;
  category: string;
  neighborhood: string;
  status: string;
  budget_min: number;
  budget_max: number;
  bid_count: number;
  best_bid_cents: number | null;
  closes_at: string | null;
  created_at: string;
}

export function useHomeownerRequests(status?: string) {
  const [requests, setRequests] = useState<HomeownerRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    const token = getToken();
    if (!token) {
      setLoading(false);
      return;
    }
    const params = status ? `?status=${encodeURIComponent(status)}` : "";
    apiFetch<HomeownerRequest[]>(`/homeowner/requests${params}`, { token })
      .then(setRequests)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    refresh();
  }, [status]);

  const createRequest = async (payload: {
    title: string;
    description: string;
    category: string;
    neighborhood: string;
    budget_min: number;
    budget_max: number;
    status?: string;
  }) => {
    const token = getToken();
    if (!token) return null;
    const req = await apiFetch<HomeownerRequest>("/requests", {
      method: "POST",
      body: JSON.stringify({ ...payload, status: payload.status ?? "draft" }),
      token,
    });
    setRequests((prev) => [req, ...prev]);
    return req;
  };

  return { requests, loading, error, refresh, createRequest };
}
