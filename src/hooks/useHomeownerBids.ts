"use client";

import { useEffect, useState } from "react";

import { getToken } from "@/lib/auth";
import { apiFetch } from "@/lib/api";

export interface HomeownerBid {
  id: number;
  request_id: number;
  request_title: string;
  provider_id: number;
  provider_name: string;
  amount: number;
  estimated_days: number;
  work_days: string[];
  status: string;
  created_at: string;
}

export function useHomeownerBids() {
  const [bids, setBids] = useState<HomeownerBid[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setLoading(false);
      return;
    }
    apiFetch<HomeownerBid[]>("/homeowner/bids", { token })
      .then(setBids)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed"))
      .finally(() => setLoading(false));
  }, []);

  const acceptBid = async (bidId: number) => {
    const token = getToken();
    if (!token) return;
    await apiFetch(`/bids/${bidId}/accept`, { method: "PUT", token });
    setBids((prev) => {
      const selectedBid = prev.find((bid) => bid.id === bidId);
      return prev.map((bid) =>
        bid.id === bidId
          ? { ...bid, status: "accepted" }
          : bid.request_id === selectedBid?.request_id
            ? { ...bid, status: "declined" }
            : bid
      );
    });
  };

  const declineBid = async (bidId: number) => {
    const token = getToken();
    if (!token) return;
    await apiFetch(`/bids/${bidId}/decline`, { method: "PUT", token });
    setBids((prev) => prev.map((bid) => (bid.id === bidId ? { ...bid, status: "declined" } : bid)));
  };

  return { bids, loading, error, acceptBid, declineBid };
}
