"use client";

import { useCallback, useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";

/**
 * "My Requests" — the requests the signed-in homeowner owns.
 *
 * Backed by `/api/homeowner/requests`, which scopes every row to the session.
 * There is no token here: Clerk's HttpOnly cookie travels with the same-origin
 * request, so the old `getToken()` gate — which only ever returned a truthy
 * placeholder — is gone rather than being carried forward as decoration.
 */

export interface HomeownerRequest {
  id: string;
  title: string;
  description: string;
  category: string;
  categoryLabel: string;
  /** Server-owned lifecycle status, e.g. `collecting_interest`. */
  status: string;
  /** Which workflow the request belongs to. */
  context: "neighborhood" | "hoa";
  communityId: string;
  communityName: string;
  /** Whole US cents. */
  budgetMinCents: number | null;
  budgetMaxCents: number | null;
  bidCount: number;
  bestBidCents: number | null;
  enrollmentClosesAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type RequestEligibility =
  | { canCreate: true; communityId: string; communityName: string }
  | {
      canCreate: false;
      reason: string;
      message: string;
      actionLabel: string;
      actionPath: string;
    };

type RequestsResponse = {
  requests: HomeownerRequest[];
  eligibility: RequestEligibility;
};

/** Statuses in which a request is still doing something for the homeowner. */
export const ACTIVE_REQUEST_STATUSES = [
  "collecting_interest",
  "open_for_bids",
  "bidding_closed",
  "awarded",
  "scheduled",
  "in_progress",
];

export function useHomeownerRequests() {
  const [requests, setRequests] = useState<HomeownerRequest[]>([]);
  const [eligibility, setEligibility] = useState<RequestEligibility | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const payload = await apiFetch<RequestsResponse>("/homeowner/requests");
      setRequests(payload.requests);
      setEligibility(payload.eligibility);
      setError(null);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "We could not load your requests. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { requests, eligibility, loading, error, refresh };
}
