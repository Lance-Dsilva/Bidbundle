"use client";

import { useCallback, useEffect, useState } from "react";

import type { ViewerContext } from "@/lib/community-types";

/**
 * The signed-in user's live role context.
 *
 * Reads `/api/me/context`, which resolves the label from `CommunityStaffAssignment`
 * and `CommunityMembership` rows on every request. Deliberately *not* backed by
 * local storage or Clerk metadata: both are writable outside the server's
 * control, so a label read from either would be a claim rather than a fact.
 *
 * Revalidates when the tab regains focus, which is what makes a role a Bundleen
 * admin granted a moment ago appear without the user signing in again.
 */
export function useViewerContext(): {
  context: ViewerContext | null;
  loading: boolean;
  refresh: () => void;
} {
  const [context, setContext] = useState<ViewerContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);

  const refresh = useCallback(() => setReloadToken((token) => token + 1), []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function load() {
      try {
        const response = await fetch("/api/me/context", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) {
          // 401/409 simply mean there is nobody to describe yet. The shell
          // falls back to its own defaults rather than showing a stale label.
          if (!cancelled) setContext(null);
          return;
        }
        const payload = (await response.json()) as ViewerContext;
        if (!cancelled) setContext(payload);
      } catch {
        if (!cancelled) setContext(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [reloadToken]);

  useEffect(() => {
    function onFocus() {
      if (document.visibilityState === "visible") refresh();
    }
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  return { context, loading, refresh };
}
