"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { apiFetch } from "@/lib/api";
import type { ProviderOverview } from "@/lib/server/provider-overview";

/**
 * The provider dashboard's headline metrics, from `/api/provider/overview`.
 *
 * Replaces `useProviderDashboard`, which called two endpoints that no handler
 * served — so every provider route printed a pair of 404s — and typed the
 * answer as snake-case rows with numeric ids this database has never had.
 *
 * The effect runs once per mount and aborts on unmount. A failure sets an
 * error and stops: nothing here retries, so a broken endpoint produces one
 * console entry rather than a loop.
 */
export function useProviderOverview() {
  const [overview, setOverview] = useState<ProviderOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Survives across refreshes so a manual retry cannot write into a component
  // that has since unmounted.
  const abortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);
    try {
      const payload = await apiFetch<{ overview: ProviderOverview }>("/provider/overview", {
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setOverview(payload.overview);
    } catch (caught) {
      if (controller.signal.aborted) return;
      setError(
        caught instanceof Error ? caught.message : "We could not load your dashboard.",
      );
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    return () => abortRef.current?.abort();
  }, [refresh]);

  return { overview, loading, error, refresh };
}
