"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api";
import { getToken } from "@/lib/auth";

export interface DemandPrediction {
  category: string;
  predicted_requests: number;
  confidence: "high" | "medium" | "low";
  reasoning: string;
  provider_shortage: boolean;
  shortage_note: string;
}

export interface DemandForecastResult {
  neighborhood: string;
  forecast_period: string;
  predictions: DemandPrediction[];
  top_opportunity: string;
  stub: boolean;
}

export function useDemandForecast() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function getForecast(
    neighborhood = "Oakwood Heights"
  ): Promise<DemandForecastResult | null> {
    setLoading(true);
    setError(null);
    try {
      const token = getToken();
      const params = new URLSearchParams({ neighborhood });
      return await apiFetch<DemandForecastResult>(`/ai/demand-forecast?${params.toString()}`, {
        token: token ?? undefined,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load forecast");
      return null;
    } finally {
      setLoading(false);
    }
  }

  return { getForecast, loading, error };
}
