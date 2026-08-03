"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api";
import { getToken } from "@/lib/auth";

export interface BidDraft {
  suggested_amount_cents: number;
  suggested_days: number;
  draft_text: string;
  headline: string;
  confidence: "high" | "medium" | "low";
  stub: boolean;
}

export function useBidDrafter() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function draftBid(requestId: number): Promise<BidDraft | null> {
    setLoading(true);
    setError(null);
    try {
      const token = getToken();
      return await apiFetch<BidDraft>("/ai/bid-drafter", {
        method: "POST",
        token: token ?? undefined,
        body: JSON.stringify({ request_id: requestId }),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to draft bid");
      return null;
    } finally {
      setLoading(false);
    }
  }

  return { draftBid, loading, error };
}
