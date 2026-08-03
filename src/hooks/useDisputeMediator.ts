import { useState } from "react";
import { apiFetch } from "@/lib/api";
import { getToken } from "@/lib/auth";

export interface DisputeResolutionOption {
  type: string;
  description: string;
  amount_cents?: number | null;
}

export interface DisputeResult {
  summary: string;
  homeowner_position: string;
  provider_position: string;
  resolution_options: DisputeResolutionOption[];
  recommendation: string;
  confidence: "high" | "medium" | "low";
  stub: boolean;
}

export function useDisputeMediator() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submitDispute(bidId: number, complaint: string): Promise<DisputeResult | null> {
    setLoading(true);
    setError(null);
    try {
      const token = getToken();
      return await apiFetch<DisputeResult>(`/ai/dispute/${bidId}`, {
        method: "POST",
        token: token ?? undefined,
        body: JSON.stringify({ complaint }),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit dispute");
      return null;
    } finally {
      setLoading(false);
    }
  }

  return { submitDispute, loading, error };
}
