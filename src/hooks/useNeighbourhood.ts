"use client";

import { useCallback, useEffect, useState } from "react";

import { apiFetch, ApiError } from "@/lib/api";
import type { MissingAddressReport, NeighborhoodHub } from "@/lib/neighborhood-types";

/**
 * The homeowner's neighbourhood: their neighbours' requests, their own, and —
 * when this account is the assigned manager — the controls to run the group
 * lifecycle.
 *
 * Every mutation here refreshes from the server rather than patching local
 * state. The server owns the transition table, the participant lock, and the
 * award; guessing at the next state in the browser is how a UI ends up
 * disagreeing with the database.
 */

export type NeighbourhoodAction =
  | { kind: "respond"; requestId: string; response: "joined" | "declined" }
  | { kind: "transition"; requestId: string; action: "open_bidding" | "close_bidding" | "complete" | "cancel"; biddingClosesAt?: string }
  | { kind: "award"; requestId: string; bidId: string };

export function useNeighbourhood() {
  const [hub, setHub] = useState<NeighborhoodHub | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Set when an award is refused because homes cannot be routed to. */
  const [missingAddresses, setMissingAddresses] = useState<MissingAddressReport | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await apiFetch<{ hub: NeighborhoodHub | null }>(
        "/homeowner/neighbourhood",
      );
      setHub(payload.hub);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "We could not load your neighbourhood. Try again.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const act = useCallback(
    async (action: NeighbourhoodAction): Promise<boolean> => {
      setBusy(true);
      setError(null);
      setMissingAddresses(null);
      try {
        if (action.kind === "respond") {
          await apiFetch(`/homeowner/requests/${action.requestId}/participation`, {
            method: "POST",
            body: JSON.stringify({ response: action.response }),
          });
        } else if (action.kind === "transition") {
          await apiFetch(`/homeowner/requests/${action.requestId}/transition`, {
            method: "POST",
            body: JSON.stringify({
              action: action.action,
              ...(action.biddingClosesAt ? { biddingClosesAt: action.biddingClosesAt } : {}),
            }),
          });
        } else {
          await apiFetch(`/homeowner/requests/${action.requestId}/award`, {
            method: "POST",
            body: JSON.stringify({ bidId: action.bidId }),
          });
        }
        await refresh();
        return true;
      } catch (caught) {
        // A blocked award carries the homes to fix. Surfacing the count and
        // names is the difference between "try again" and a task the manager
        // can actually finish.
        const report = readMissingAddresses(caught);
        if (report) setMissingAddresses(report);
        setError(caught instanceof Error ? caught.message : "That did not work. Try again.");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  return { hub, loading, error, busy, missingAddresses, refresh, act, setError };
}

/** Pulls the structured missing-address report out of a `409`, if present. */
function readMissingAddresses(error: unknown): MissingAddressReport | null {
  if (!(error instanceof ApiError)) return null;
  const detail = error.body?.missingAddresses as MissingAddressReport | undefined;
  return detail && typeof detail.count === "number" && Array.isArray(detail.names)
    ? detail
    : null;
}
