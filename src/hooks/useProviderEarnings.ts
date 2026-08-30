"use client";

import { useCallback, useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";
import type { ProviderEarnings } from "@/lib/server/marketplace-reads";

/**
 * Real earnings for the signed-in provider.
 *
 * The figures come from awarded agreements, so they change only when work is
 * actually won or completed. The previous version of this hook called
 * `/provider/earnings`, which no handler served.
 */
export function useProviderEarnings() {
  const [earnings, setEarnings] = useState<ProviderEarnings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await apiFetch<{ earnings: ProviderEarnings }>(
        "/provider/marketplace/earnings",
      );
      setEarnings(payload.earnings);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "We could not load your earnings.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Whole dollars. Cents are the stored unit; nobody wants them on a tile. */
  const fmt = (cents: number) => `$${Math.round(cents / 100).toLocaleString()}`;

  return { earnings, loading, error, refresh, fmt };
}
