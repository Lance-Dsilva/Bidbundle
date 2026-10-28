// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NeighbourhoodWorkspace } from "@/components/homeowner/NeighbourhoodWorkspace";
import { ApiError } from "@/lib/api";
import type { NeighborhoodHub, NeighborhoodRequestView } from "@/lib/neighborhood-types";
const state = vi.hoisted(() => ({ api: vi.fn(), ready: false, joined: false, denyJoin: false }));
vi.mock("@/lib/api", async (original) => ({ ...await original<typeof import("@/lib/api")>(), apiFetch: state.api }));
vi.mock("@/lib/geoapify", () => ({ autocompleteAddress: async () => [], geocodeAddress: async () => ({ formatted: "1 Oak St, Austin", latitude: 30.4, longitude: -97.7, neighborhood: "Oakwood" }) }));
function request(): NeighborhoodRequestView {
  return { id: "original-request", communityId: "hood", communityName: "Oakwood", title: "Pressure washing", category: "cleaning", categoryLabel: "Cleaning", description: "Clean homes", status: "collecting_interest", budgetMinCents: null, budgetMaxCents: null, minHomes: 1, maxHomes: null, enrollmentClosesAt: "2030-01-01T00:00:00Z", biddingClosesAt: null, participantsLockedAt: null, awardedAt: null, startDate: null, joinedCount: state.joined ? 2 : 1, declinedCount: 0, bidCount: 0, viewerResponse: state.joined ? "joined" : null, isOwner: false, createdByName: "Neighbor", createdAt: "2026-10-01T00:00:00Z", permissions: { canRespond: true, canManage: false, canViewBids: false, canEdit: false }, bids: null, participants: null, agreement: null, myVisits: [], occurrences: null };
}
function hub(): NeighborhoodHub { return { communityId: "hood", communityName: "Oakwood", isManager: false, managerName: null, activeNeighbourCount: 2, addressReady: state.ready, requests: [request()] }; }
beforeEach(() => {
  state.ready = false; state.joined = false; state.denyJoin = false;
  state.api.mockReset().mockImplementation(async (path: string) => {
    if (path === "/homeowner/neighbourhood") return { hub: hub() };
    if (path === "/profile") { state.ready = true; return {}; }
    if (path.endsWith("/participation")) {
      if (!state.ready) throw new ApiError(409, "Add address", undefined, { code: "HOME_ADDRESS_REQUIRED", addressRequired: true });
      if (state.denyJoin) throw new ApiError(409, "Sign-ups have closed");
      state.joined = true; return { response: "joined" };
    }
    throw new Error(`Unexpected path ${path}`);
  });
});
afterEach(cleanup);

describe("neighborhood Join address completion flow", () => {
  it("saves the address before retrying exactly the selected Join and renders server-confirmed membership", async () => {
    render(<NeighbourhoodWorkspace />); fireEvent.click(await screen.findByRole("button", { name: "Join this request" }));
    expect(screen.getByLabelText("Home address")).toBeInTheDocument(); expect(state.api).toHaveBeenCalledOnce();
    fireEvent.change(screen.getByLabelText("Home address"), { target: { value: "1 Oak St" } });
    fireEvent.click(screen.getByRole("button", { name: "Save address & join" }));
    await screen.findByRole("button", { name: "You have joined" });
    expect(state.api.mock.calls.map((call) => call[0])).toEqual(["/homeowner/neighbourhood", "/profile", "/homeowner/requests/original-request/participation", "/homeowner/neighbourhood"]);
    expect(state.api.mock.calls[2][1]).toEqual({ method: "POST", body: JSON.stringify({ response: "joined" }) });
    expect(screen.queryByLabelText("Home address")).not.toBeInTheDocument();
  });

  it("keeps a post-save expired-request refusal visible without showing joined", async () => {
    state.denyJoin = true; render(<NeighbourhoodWorkspace />); fireEvent.click(await screen.findByRole("button", { name: "Join this request" }));
    fireEvent.change(screen.getByLabelText("Home address"), { target: { value: "1 Oak St" } });
    fireEvent.click(screen.getByRole("button", { name: "Save address & join" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/address was saved.*sign-ups have closed/i));
    expect(screen.queryByRole("button", { name: "You have joined" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Home address")).toBeInTheDocument();
    expect(state.joined).toBe(false);
  });
});
