"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { apiFetch } from "@/lib/api";
import type { ProviderReviewsPage } from "@/lib/server/provider-reviews";

/**
 * This provider's real reviews and rating summary, from `/api/provider/ratings`.
 *
 * Replaces `useProviderReviews`, which called an endpoint that did not exist
 * and averaged whatever the page happened to hold. The average and the
 * distribution now come from the database over *all* published reviews, so
 * they do not change as the reader pages through the list.
 */
export function useProviderRatings(pageSize?: number) {
  const [page, setPage] = useState<ProviderReviewsPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const query = useCallback(
    (offset: number, signal: AbortSignal) => {
      const params = new URLSearchParams({ offset: String(offset) });
      if (pageSize) params.set("limit", String(pageSize));
      return apiFetch<ProviderReviewsPage>(`/provider/ratings?${params}`, { signal });
    },
    [pageSize],
  );

  const refresh = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);
    try {
      const payload = await query(0, controller.signal);
      if (controller.signal.aborted) return;
      setPage(payload);
    } catch (caught) {
      if (controller.signal.aborted) return;
      setError(caught instanceof Error ? caught.message : "We could not load your reviews.");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    void refresh();
    return () => abortRef.current?.abort();
  }, [refresh]);

  /** Appends the next page. A no-op while one is already in flight. */
  const loadMore = useCallback(async () => {
    const controller = abortRef.current;
    if (!page?.page.hasMore || loadingMore || !controller) return;

    setLoadingMore(true);
    try {
      const next = await query(page.page.offset + page.reviews.length, controller.signal);
      if (controller.signal.aborted) return;
      setPage((current) =>
        current
          ? { ...next, reviews: [...current.reviews, ...next.reviews] }
          : next,
      );
    } catch (caught) {
      if (controller.signal.aborted) return;
      setError(caught instanceof Error ? caught.message : "We could not load more reviews.");
    } finally {
      if (!controller.signal.aborted) setLoadingMore(false);
    }
  }, [loadingMore, page, query]);

  return {
    reviews: page?.reviews ?? [],
    summary: page?.summary ?? null,
    hasMore: page?.page.hasMore ?? false,
    loading,
    loadingMore,
    error,
    refresh,
    loadMore,
  };
}
