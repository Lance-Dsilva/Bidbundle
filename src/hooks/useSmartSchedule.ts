"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api";
import { getToken } from "@/lib/auth";
import { useProviderSchedule } from "@/hooks/useProviderSchedule";

export interface SmartScheduleItem {
  title: string;
  suggested_start: string;
  duration_minutes: number;
  address?: string | null;
  neighborhood: string;
  request_id?: number | null;
  reason: string;
}

export interface SmartScheduleResult {
  date: string;
  items: SmartScheduleItem[];
  total_hours: number;
  estimated_revenue_cents: number;
  conflicts: string[];
  stub: boolean;
}

export function useSmartSchedule() {
  const { addItem } = useProviderSchedule();
  const [proposals, setProposals] = useState<SmartScheduleResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate(date: string): Promise<SmartScheduleResult | null> {
    setLoading(true);
    setError(null);
    try {
      const token = getToken();
      const result = await apiFetch<SmartScheduleResult>("/ai/smart-schedule", {
        method: "POST",
        token: token ?? undefined,
        body: JSON.stringify({ date }),
      });
      setProposals(result);
      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to optimise schedule");
      setProposals(null);
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function accept(item: SmartScheduleItem): Promise<void> {
    if (!proposals) return;

    try {
      setError(null);
      const [hours, minutes] = item.suggested_start.split(":").map(Number);
      const scheduledAt = new Date(`${proposals.date}T00:00:00`);
      scheduledAt.setHours(hours ?? 0, minutes ?? 0, 0, 0);

      await addItem({
        title: item.title,
        address: item.address ?? item.neighborhood,
        request_id: item.request_id ?? undefined,
        scheduled_at: scheduledAt.toISOString(),
        duration_minutes: item.duration_minutes,
        status: "scheduled",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add schedule item");
      throw err;
    }
  }

  return { proposals, loading, error, generate, accept };
}
