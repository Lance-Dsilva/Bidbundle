"use client";

import { useCallback, useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";
import type { ProviderHoaWorkspace } from "@/lib/hoa-types";

/**
 * The provider's whole marketplace state, from the one real endpoint.
 *
 * This replaces `useProviderJobFeed`, `useProviderBids`, and
 * `useProviderSchedule`, which each called a path that had no Route Handler
 * behind it and used numeric ids that this database has never had. There is
 * one request and one shape, so the feed, My Bids, and Schedule pages cannot
 * disagree about what a provider has going on.
 */
export type ProviderMarketplace = ProviderHoaWorkspace;

export function useProviderMarketplace() {
  const [workspace, setWorkspace] = useState<ProviderMarketplace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await apiFetch<{ workspace: ProviderMarketplace }>(
        "/provider/marketplace",
      );
      setWorkspace(payload.workspace);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "We could not load your marketplace. Try again.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { workspace, loading, error, refresh };
}
