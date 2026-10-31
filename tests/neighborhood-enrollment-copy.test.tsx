// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { NeighborhoodHub, NeighborhoodRequestView } from "@/lib/neighborhood-types";

const state = vi.hoisted(() => ({ hub: null as NeighborhoodHub | null, act: vi.fn() }));
vi.mock("@/hooks/useNeighbourhood", () => ({
  useNeighbourhood: () => ({ hub: state.hub, loading: false, error: null, busy: false, missingAddresses: null, act: state.act }),
}));
import { NeighbourhoodWorkspace } from "@/components/homeowner/NeighbourhoodWorkspace";

function show(overrides: Partial<NeighborhoodRequestView> = {}) {
  const request: NeighborhoodRequestView = {
    id: "request-1", communityId: "hood-1", communityName: "Oakwood", title: "Pressure washing", category: "cleaning", categoryLabel: "Cleaning",
    description: "Wash our homes", status: "collecting_interest", budgetMinCents: null, budgetMaxCents: null,
    minHomes: 2, maxHomes: null, totalOccurrences: 1, enrollmentClosesAt: "2026-10-27T12:00:00Z", biddingClosesAt: null,
    participantsLockedAt: null, awardedAt: null, startDate: null, joinedCount: 1, declinedCount: 0, bidCount: 0,
    viewerResponse: "joined", isOwner: true, createdByName: "Resident", createdAt: "2026-10-24T12:00:00Z",
    permissions: { canRespond: false, canManage: false, canViewBids: false, canEdit: false }, bids: null,
    participants: null, agreement: null, myVisits: [], occurrences: null, ...overrides,
  };
  state.hub = { communityId: "hood-1", communityName: "Oakwood", isManager: false, managerName: null, activeNeighbourCount: 3, addressReady: true, requests: [request] };
  return render(<NeighbourhoodWorkspace />);
}
afterEach(cleanup);

describe("enrollment deadline guidance", () => {
  it("explains automatic opening, the configured minimum, processing delay and expiration to a resident", () => {
    show();
    expect(screen.getByText(/bidding opens automatically if at least 2 homes have joined/)).toHaveTextContent(/few minutes.*fewer homes join, the request expires/);
    expect(screen.queryByRole("button", { name: /open bidding|close bidding|mark complete/i })).not.toBeInTheDocument();
    expect(state.act).not.toHaveBeenCalled();
  });

  it("uses singular language for one required home", () => {
    show({ minHomes: 1 });
    expect(screen.getByText(/at least 1 home has joined/)).toBeInTheDocument();
  });

  it.each(["open_for_bids", "bidding_closed", "cancelled", "failed"] as const)("does not promise future automatic opening in %s", (status) => {
    show({ status });
    expect(screen.queryByText(/bidding opens automatically/)).not.toBeInTheDocument();
  });

  it("does not promise automatic opening without an enrollment deadline", () => {
    show({ enrollmentClosesAt: null });
    expect(screen.queryByText(/bidding opens automatically/)).not.toBeInTheDocument();
  });
});
