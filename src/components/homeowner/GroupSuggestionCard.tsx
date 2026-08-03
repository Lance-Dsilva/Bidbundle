"use client";

import { useRouter } from "next/navigation";

import type { ServiceRequest } from "@/types";

interface GroupSuggestionCardProps {
  matchedRequest: ServiceRequest | null;
  category: string;
}

export function GroupSuggestionCard({
  matchedRequest,
  category,
}: GroupSuggestionCardProps) {
  const router = useRouter();

  if (matchedRequest) {
    return (
      <div className="mt-3 rounded-xl bg-card p-3.5">
        <span className="inline-flex items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-semibold text-accent">
          Nearby group found
        </span>
        <p className="mt-2 text-sm font-semibold text-foreground">{matchedRequest.title}</p>
        <p className="text-xs text-muted">3 neighbors · {matchedRequest.neighborhood}</p>
        <p className="mt-0.5 text-xs font-medium text-foreground">
          ${matchedRequest.budgetMin}–${matchedRequest.budgetMax}
        </p>
        <button
          className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary transition hover:text-blue-700"
          type="button"
          onClick={() => router.push("/app/homeowner/bidding-room")}
        >
          Join this group
          <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="m9 18 6-6-6-6" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-xl bg-card p-3.5">
      <span className="inline-flex rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
        Start a new group
      </span>
      <p className="mt-2 text-sm text-foreground">
        Be the first in Oakwood Heights to request {category} services.
      </p>
      <p className="mt-0.5 text-xs text-muted">Neighbors will be notified and can join.</p>
      <button
        className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary transition hover:text-blue-700"
        type="button"
        onClick={() => router.push("/app/homeowner/dashboard")}
      >
        Create group
        <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="m9 18 6-6-6-6" />
        </svg>
      </button>
    </div>
  );
}
