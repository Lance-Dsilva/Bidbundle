"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getToken } from "@/lib/auth";

export interface ScheduleItem {
  id: number;
  provider_id: number;
  request_id: number | null;
  title: string;
  address: string | null;
  scheduled_at: string;
  duration_minutes: number;
  status: string;
  created_at: string;
}

export function useProviderSchedule() {
  const [items, setItems] = useState<ScheduleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    const token = getToken();
    if (!token) { setLoading(false); return; }
    apiFetch<ScheduleItem[]>("/provider/schedule", { token })
      .then(setItems)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  };

  useEffect(() => { refresh(); }, []);

  const addItem = async (payload: {
    title: string;
    address?: string;
    request_id?: number;
    scheduled_at: string;
    duration_minutes?: number;
    status?: string;
  }) => {
    const token = getToken();
    if (!token) return;
    const item = await apiFetch<ScheduleItem>("/provider/schedule", {
      method: "POST",
      body: JSON.stringify(payload),
      token,
    });
    setItems((prev) => [...prev, item].sort((a, b) =>
      new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime()
    ));
    return item;
  };

  const updateStatus = async (id: number, status: string) => {
    const token = getToken();
    if (!token) return;
    await apiFetch<ScheduleItem>(`/provider/schedule/${id}?status=${encodeURIComponent(status)}`, {
      method: "PATCH",
      token,
    });
    setItems((prev) => prev.map((i) => i.id === id ? { ...i, status } : i));
  };

  return { items, loading, error, addItem, updateStatus, refresh };
}
