import { useState } from "react";

/**
 * Same-origin, like the rest of the client. The endpoint itself belongs to
 * section 7 (AI Features) and does not exist yet.
 */
const BASE_PATH = "/api";

export interface QuoteSummaryVsBundleen {
  bundleen_best_bid: number;
  saving_if_use_bundleen: number;
  bundleen_has_warranty: boolean;
}

export interface QuoteSummaryResult {
  provider_name: string;
  quoted_amount: number;
  scope_summary: string;
  flags: string[];
  vs_bundleen: QuoteSummaryVsBundleen | null;
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
      const form = new FormData();
      form.append("file", file);
      if (requestId !== undefined) form.append("request_id", String(requestId));

      // No Authorization header: the HttpOnly session cookie is sent
      // automatically. `Content-Type` is left unset so the browser adds the
      // multipart boundary itself.
      const res = await fetch(`${BASE_PATH}/ai/quote-summary`, {
        method: "POST",
        body: form,
        credentials: "same-origin",
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
