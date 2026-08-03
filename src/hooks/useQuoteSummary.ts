import { useState } from "react";
import { getToken } from "@/lib/auth";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export interface QuoteSummaryVsNeighBid {
  neighbid_best_bid: number;
  saving_if_use_neighbid: number;
  neighbid_has_warranty: boolean;
}

export interface QuoteSummaryResult {
  provider_name: string;
  quoted_amount: number;
  scope_summary: string;
  flags: string[];
  vs_neighbid: QuoteSummaryVsNeighBid | null;
  score: number;
  recommendation: string;
  stub: boolean;
}

export function useQuoteSummary() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function summariseQuote(
    file: File,
    requestId?: number
  ): Promise<QuoteSummaryResult | null> {
    setLoading(true);
    setError(null);
    try {
      const token = getToken();
      const form = new FormData();
      form.append("file", file);
      if (requestId !== undefined) form.append("request_id", String(requestId));

      const res = await fetch(`${BASE_URL}/ai/quote-summary`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { detail?: string }).detail ?? `HTTP ${res.status}`);
      }
      return res.json() as Promise<QuoteSummaryResult>;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to summarise quote");
      return null;
    } finally {
      setLoading(false);
    }
  }

  return { summariseQuote, loading, error };
}
