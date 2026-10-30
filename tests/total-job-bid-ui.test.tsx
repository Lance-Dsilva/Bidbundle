// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BidPrice, LegacyBidNotice } from "@/components/ui/BidPrice";
import { ProviderMarketplaceFeed } from "@/components/provider/ProviderMarketplaceFeed";
import type { BidSummary, ProviderFeedItem, ProviderHoaWorkspace } from "@/lib/hoa-types";
const state = vi.hoisted(() => ({ workspace: null as ProviderHoaWorkspace | null, api: vi.fn(), refresh: vi.fn() }));
vi.mock("@/hooks/useProviderMarketplace", () => ({ useProviderMarketplace: () => ({ workspace: state.workspace, loading: false, error: null, refresh: state.refresh }) }));
vi.mock("@/lib/api", () => ({ apiFetch: state.api }));
function bid(overrides: Partial<BidSummary> = {}): BidSummary {
  return { id: "bid-1", requestId: "request-1", providerUserId: "provider", providerName: "Provider", providerCompany: null, providerVerified: true, status: "submitted", amountCents: 10001, currency: "usd", pricingBasis: "total", perHomeCents: null, homeCount: 3, totalOccurrences: 4, proposedStartDate: null, estimatedDurationLabel: null, scope: "Whole job scope", exclusions: null, cadenceLabel: null, validUntil: null, version: 1, submittedAt: "2026-10-28T00:00:00Z", ...overrides };
}
function showFeed(existing: BidSummary | null = null) {
  const item: ProviderFeedItem = { requestId: "request-1", context: "neighborhood", communityName: "Oakwood", locality: null, region: null, title: "Cleaning", category: "cleaning", kind: "optional_group", description: "Wash homes", recurrenceLabel: null, totalOccurrences: 4, homeCount: 3, approximateDistanceMi: null, budgetMinCents: null, budgetMaxCents: null, startDate: null, biddingClosesAt: "2030-01-01T00:00:00Z", myBid: existing };
  state.workspace = { eligible: true, ineligibleReason: null, serviceAreas: [], categories: ["cleaning"], feed: [item], bids: existing ? [existing] : [], agreements: [], occurrencesByAgreement: {} };
  render(<ProviderMarketplaceFeed />);
}
beforeEach(() => { state.api.mockReset().mockResolvedValue({}); state.refresh.mockReset().mockResolvedValue(undefined); });
afterEach(cleanup);

describe("whole-job price presentation", () => {
  it("labels total and rounded approximate home/visit helpers without losing cents", () => {
    render(<BidPrice bid={bid()} />);
    expect(screen.getByText(/whole-job total/)).toHaveTextContent("$100.01");
    expect(screen.getByText(/per home for the full job/)).toHaveTextContent("≈ $33.34");
    expect(screen.getByText(/per home per visit/)).toHaveTextContent("≈ $8.33");
    expect(screen.getByText(/3 homes × 4 visits each/)).toHaveTextContent(/approximate/);
  });
  it.each(["per_home", "per_visit"] as const)("keeps legacy %s amount and units without invented total helpers", (pricingBasis) => {
    render(<BidPrice bid={bid({ pricingBasis })} />);
    expect(screen.getByText(/original quote/)).toHaveTextContent("$100.01");
    expect(screen.getByText(/not comparable to whole-job totals/)).toBeInTheDocument();
    expect(screen.queryByText(/per home for the full job/)).not.toBeInTheDocument();
    expect(screen.queryByText(/≈/)).not.toBeInTheDocument();
  });
  it("hides unknowable averages rather than assuming one home or one visit", () => {
    render(<BidPrice bid={bid({ homeCount: undefined, totalOccurrences: undefined })} />);
    expect(screen.getByText(/whole-job total/)).toHaveTextContent("$100.01"); expect(screen.queryByText(/≈/)).not.toBeInTheDocument();
  });
  it("retains zero-total helpers", () => {
    render(<BidPrice bid={bid({ amountCents: 0 })} />);
    expect(screen.getByText(/whole-job total/)).toHaveTextContent("$0.00"); expect(screen.getByText(/per home per visit/)).toHaveTextContent("≈ $0.00");
  });
  it("describes a new request for closed legacy bidding instead of silently reopening", () => {
    render(<LegacyBidNotice requestStatus="bidding_closed" />);
    expect(screen.getByText(/manager must open a new request/)).toHaveTextContent(/cannot be newly awarded/);
  });
});

describe("provider whole-job quote form", () => {
  it("submits the entered integer whole-job cents and never the rounded averages", async () => {
    showFeed(); fireEvent.click(screen.getByRole("button", { name: "Submit bid" }));
    expect(screen.queryByRole("combobox", { name: /pricing|basis/i })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/whole-job total/i), { target: { value: "100.01" } });
    fireEvent.change(screen.getByLabelText("What is included"), { target: { value: "All homes and visits" } });
    expect(screen.getByText(/per home per visit/)).toHaveTextContent("≈ $8.33");
    fireEvent.click(screen.getByRole("button", { name: "Send bid" }));
    await waitFor(() => expect(state.refresh).toHaveBeenCalledOnce());
    expect(state.api.mock.calls[0][0]).toBe("/provider/marketplace/requests/request-1/bid");
    expect(JSON.parse(state.api.mock.calls[0][1].body)).toMatchObject({ amountCents: 10001, pricingBasis: "total", perHomeCents: null });
  });
  it("requires a fresh blank total when revising a legacy unit quote", () => {
    showFeed(bid({ pricingBasis: "per_home", amountCents: 999 })); fireEvent.click(screen.getByRole("button", { name: "Revise bid" }));
    expect(screen.getByLabelText(/whole-job total/i)).toHaveValue(null);
    expect(screen.getByText(/provider must resubmit a whole-job total before bidding closes/)).toBeInTheDocument();
  });
  it("preserves errors and allows retry while preventing duplicate pending submissions", async () => {
    let reject!: (error: Error) => void; state.api.mockReturnValueOnce(new Promise((_, no) => { reject = no; }));
    showFeed(); fireEvent.click(screen.getByRole("button", { name: "Submit bid" }));
    fireEvent.change(screen.getByLabelText(/whole-job total/i), { target: { value: "200" } });
    fireEvent.change(screen.getByLabelText("What is included"), { target: { value: "Whole scope" } });
    fireEvent.click(screen.getByRole("button", { name: "Send bid" }));
    expect(screen.getByRole("button", { name: "Sending…" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Sending…" }));
    expect(state.api).toHaveBeenCalledOnce();
    reject(new Error("Bidding closed")); expect(await screen.findByRole("alert")).toHaveTextContent("Bidding closed");
    expect(state.refresh).not.toHaveBeenCalled(); expect(screen.getByRole("button", { name: "Send bid" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Send bid" }));
    await waitFor(() => expect(state.refresh).toHaveBeenCalledOnce());
    expect(state.api).toHaveBeenCalledTimes(2);
  });
});
