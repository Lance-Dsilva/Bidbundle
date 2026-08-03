"use client";

import { useRouter } from "next/navigation";

import { ServiceRequestCard } from "@/components/homeowner/ServiceRequestCard";
import { Button } from "@/components/ui/Button";
import type { ServiceRequest } from "@/types";

interface RequestFeedProps {
  requests: ServiceRequest[];
}

export function RequestFeed({ requests }: RequestFeedProps) {
  const router = useRouter();

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">Neighborhood bids</h2>
        <span className="flex items-center gap-1 rounded-full bg-accent/15 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-accent">
          <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
          Live
        </span>
      </div>

      <div className="space-y-3">
        {requests.map((request) => (
          <ServiceRequestCard key={request.id} request={request} />
        ))}
      </div>

      <div className="mt-3 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-3">
        <svg className="h-4 w-4 shrink-0 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="m5 12 5 5L19 8" />
        </svg>
        <p className="text-sm font-medium text-emerald-800">
          You saved $310 · 14 neighbors in bids
        </p>
      </div>

      <Button
        variant="primary"
        className="mt-4 w-full"
        onClick={() => router.push("/app/homeowner/request")}
      >
        + New request
      </Button>
    </section>
  );
}
