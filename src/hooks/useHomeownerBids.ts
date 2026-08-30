"use client";

import { useCallback, useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";
import type { HomeownerBidView } from "@/lib/server/marketplace-reads";

/**
 * Quotes on the requests this homeowner opened or joined.
 *
 * Read-only. Accepting a bid is a lifecycle transition owned by the
 * neighbourhood manager and goes through `useNeighbourhood`, which posts to
 * the award endpoint and re-reads the server's answer — the previous version
 * of this hook called `/bids/{id}/accept` and `/bids/{id}/decline`, neither of
 * which existed, and then patched local state as if they had succeeded.
 */
export function useHomeownerBids() {
  const [bids, setBids] = useState<HomeownerBidView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await apiFetch<{ bids: HomeownerBidView[] }>("/homeowner/bids");
      setBids(payload.bids);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "We could not load your quotes.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { bids, loading, error, refresh };
}
