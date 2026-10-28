"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { apiFetch, ApiError } from "@/lib/api";
import type { MissingAddressReport, NeighborhoodHub, NeighborhoodRequestView } from "@/lib/neighborhood-types";
import type { EditOwnerRequestInput } from "@/lib/validation/homeowner-requests";

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
  | { kind: "edit"; requestId: string; input: EditOwnerRequestInput }
  | { kind: "cancel"; requestId: string }
  | { kind: "respond"; requestId: string; response: "joined" | "declined" }
  | { kind: "transition"; requestId: string; action: "open_bidding" | "close_bidding" | "complete" | "cancel"; biddingClosesAt?: string }
  | { kind: "award"; requestId: string; bidId: string; expectedBidVersion?: number };

export function useNeighbourhood() {
  const [hub, setHub] = useState<NeighborhoodHub | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [ownerError, setOwnerError] = useState<{ requestId: string; message: string; fields?: Record<string, string> } | null>(null);
  const [ownerSuccess, setOwnerSuccess] = useState<{ requestId: string; action: "edit" | "cancel" } | null>(null);
  /** Set when an award is refused because homes cannot be routed to. */
  const [missingAddresses, setMissingAddresses] = useState<MissingAddressReport | null>(null);

  const clearOwnerFeedback = useCallback(() => { setOwnerError(null); setOwnerSuccess(null); }, []);

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
      if (inFlight.current) return false;
      inFlight.current = true;
      setBusy(true);
      setOwnerError(null);
      setOwnerSuccess(null);
      setError(null);
      setMissingAddresses(null);
      try {
        if (action.kind === "edit" || action.kind === "cancel") {
          const payload = await apiFetch<{ request: NeighborhoodRequestView }>(
            `/homeowner/requests/${encodeURIComponent(action.requestId)}`,
            {
              method: "PATCH",
              body: JSON.stringify(action.kind === "edit" ? action.input : { action: "cancel" }),
            },
          );
          // The server returns the canonical card and permissions. Keep the
          // workspace mounted so failed saves retain the editor and its focus.
          setHub((current) => current ? {
            ...current,
            requests: current.requests.map((request) => request.id === action.requestId ? payload.request : request),
          } : current);
          setOwnerSuccess({ requestId: action.requestId, action: action.kind });
          return true;
        } else if (action.kind === "respond") {
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
            body: JSON.stringify({
              bidId: action.bidId,
              ...(action.expectedBidVersion !== undefined ? { expectedBidVersion: action.expectedBidVersion } : {}),
            }),
          });
        }
        await refresh();
        return true;
      } catch (caught) {
        // A blocked award carries the homes to fix. Surfacing the count and
        // names is the difference between "try again" and a task the manager
        // can actually finish.
        if (action.kind === "edit" || action.kind === "cancel") {
          setOwnerError({
            requestId: action.requestId,
            message: caught instanceof Error ? caught.message : "That change was not saved. Please try again.",
            ...(caught instanceof ApiError && caught.fields ? { fields: caught.fields } : {}),
          });
          return false;
        }
        const report = readMissingAddresses(caught);
        if (report) setMissingAddresses(report);
        setError(caught instanceof Error ? caught.message : "That did not work. Try again.");
        return false;
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [refresh],
  );

  return { hub, loading, error, busy, missingAddresses, refresh, act, setError, ownerError, ownerSuccess, clearOwnerFeedback };
}

/** Pulls the structured missing-address report out of a `409`, if present. */
function readMissingAddresses(error: unknown): MissingAddressReport | null {
  if (!(error instanceof ApiError)) return null;
  const detail = error.body?.missingAddresses as MissingAddressReport | undefined;
  return detail && typeof detail.count === "number" && Array.isArray(detail.names)
    ? detail
    : null;
}
