import { useState } from "react";
import { apiFetch } from "@/lib/api";
import { getToken } from "@/lib/auth";

export interface RequestWriterResult {
  title: string;
  category: string;
  description: string;
  budget_min: number;
  budget_max: number;
  estimated_group_likelihood: "high" | "medium" | "low";
  group_reason: string;
  stub: boolean;
}

export function useRequestWriter() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function writeRequest(description: string): Promise<RequestWriterResult | null> {
    setLoading(true);
    setError(null);
    try {
      const token = getToken();
      const result = await apiFetch<RequestWriterResult>("/ai/request-writer", {
        method: "POST",
        token: token ?? undefined,
        body: JSON.stringify({ description }),
      });
      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate request");
      return null;
    } finally {
      setLoading(false);
    }
  }

  return { writeRequest, loading, error };
}
