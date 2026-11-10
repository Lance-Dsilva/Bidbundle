// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PoolBidComparison } from "@/components/hoa/PoolBidComparison";
import { PoolTemplateFields } from "@/components/hoa/PoolTemplateFields";
import { PoolParticipation } from "@/components/hoa/ResidentHoaWorkspace";
import { PoolQuoteForm } from "@/components/provider/ProviderMarketplaceFeed";
import type { BidSummary, HoaRequestSummary, ProviderFeedItem } from "@/lib/hoa-types";
import type { PoolQuote, PoolTemplate } from "@/lib/pool-bid-template";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
afterEach(cleanup);

const template: PoolTemplate = { version: 1, serviceMonths: 3, visitsPerMonth: 4, tiers: ["standard", "large"], hideProviderNamesUntilAward: true };
const counts = { standard: 2, large: 1 };
const quote: PoolQuote = { monthlyCents: { standard: 10000, large: 15000 }, chemicalsIncluded: true, equipmentRepairsExcluded: true, earliestStartDate: "2099-12-01T00:00:00.000Z", routeDay: "mon", cancellationNoticeDays: 14 };

function bid(overrides: Partial<BidSummary> = {}): BidSummary {
  return { id: "bid-a", requestId: "request-1", providerUserId: "provider-a", providerName: "Fixture Provider A", providerCompany: null, providerVerified: true, status: "submitted", amountCents: 105000, currency: "usd", pricingBasis: "total", perHomeCents: null, homeCount: 3, totalOccurrences: 12, proposedStartDate: quote.earliestStartDate, estimatedDurationLabel: null, scope: "Clean the pools.", exclusions: "Equipment repairs", cadenceLabel: null, validUntil: "2099-12-31T12:00:00.000Z", version: 1, submittedAt: "2026-11-10T00:00:00Z", poolQuote: quote, providerYearsInBusiness: null, providerRating: null, providerReviewCount: 0, revisions: [], ...overrides };
}
function item(myBid: BidSummary | null = null): ProviderFeedItem {
  return { requestId: "request-1", context: "hoa", communityName: "Synthetic fixture HOA", locality: null, region: null, title: "Pool cleaning", category: "pool_care", kind: "optional_group", description: "Synthetic request", recurrenceLabel: null, totalOccurrences: 12, homeCount: 3, approximateDistanceMi: null, budgetMinCents: null, budgetMaxCents: null, startDate: null, biddingClosesAt: "2099-12-31T00:00:00Z", myBid, poolTemplate: template, tierCounts: counts };
}
function request(): HoaRequestSummary {
  return { id: "request-1", communityId: "hoa-1", title: "Pool cleaning", category: "pool_care", description: "Tier definitions supplied by HOA", kind: "optional_group", recurrenceLabel: null, recurrenceIntervalDays: null, totalOccurrences: 12, status: "collecting_interest", opensAt: null, enrollmentClosesAt: null, biddingClosesAt: null, startDate: null, minHomes: null, maxHomes: null, participantsLockedAt: null, awardedAt: null, joinedCount: 3, declinedCount: 0, bidCount: 0, viewerResponse: null, createdAt: "2026-11-10T00:00:00Z", poolTemplate: template, tierCounts: counts, viewerPoolTier: null };
}

describe("pool provider quote form", () => {
  function fillForm() {
    fireEvent.change(screen.getByLabelText(/Standard pool — USD/), { target: { value: "100.25" } });
    fireEvent.change(screen.getByLabelText(/Large pool — USD/), { target: { value: "150.50" } });
    fireEvent.change(screen.getByLabelText("Chemicals included?"), { target: { value: "yes" } });
    fireEvent.change(screen.getByLabelText("Earliest start (UTC date)"), { target: { value: "2099-12-01" } });
    fireEvent.change(screen.getByLabelText(/Cancellation notice/), { target: { value: "14" } });
    fireEvent.change(screen.getByLabelText(/Bid valid until/), { target: { value: "2099-12-31T12:00" } });
    fireEvent.click(screen.getByLabelText("Equipment repairs are excluded"));
    fireEvent.change(screen.getByLabelText("Included work"), { target: { value: "Clean each pool at the requested frequency." } });
  }

  it("submits exact monthly tier cents and terms, while the server owns the whole-job amount", () => {
    const onSubmit = vi.fn(); render(<PoolQuoteForm item={item()} disabled={false} onSubmit={onSubmit} />);
    fillForm();
    expect(screen.getByRole("status")).toHaveTextContent("$1,053.00");
    expect(screen.queryByText(/per home per visit/)).not.toBeInTheDocument();
    fireEvent.submit(screen.getByRole("button", { name: "Submit pool bid" }).closest("form")!);
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ pricingBasis: "total", perHomeCents: null, poolQuote: { monthlyCents: { standard: 10025, large: 15050 }, chemicalsIncluded: true, equipmentRepairsExcluded: true, earliestStartDate: "2099-12-01T00:00:00.000Z", routeDay: "flexible", cancellationNoticeDays: 14 } });
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty("amountCents");
  });

  it("does not send fractional-cent or missing tier rates", () => {
    const onSubmit = vi.fn(); render(<PoolQuoteForm item={item()} disabled={false} onSubmit={onSubmit} />); fillForm();
    fireEvent.change(screen.getByLabelText(/Large pool — USD/), { target: { value: "150.501" } });
    fireEvent.submit(screen.getByRole("button", { name: "Submit pool bid" }).closest("form")!);
    expect(onSubmit).not.toHaveBeenCalled(); expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("sends the reviewed version on a revised pool bid", () => {
    const onSubmit = vi.fn(); render(<PoolQuoteForm item={item(bid({ version: 4 }))} disabled={false} onSubmit={onSubmit} />);
    fireEvent.submit(screen.getByRole("button", { name: "Update pool bid" }).closest("form")!);
    expect(onSubmit).toHaveBeenCalledOnce(); expect(onSubmit.mock.calls[0][0].expectedBidVersion).toBe(4);
  });
});

describe("pool bid comparison", () => {
  it("shows the selected household's actual price instead of a blended average, and treats three bids as a target", () => {
    const award = vi.fn(); render(<PoolBidComparison template={template} bids={[bid()]} tierCounts={counts} viewerPoolTier="large" managerView canAward onAward={award} />);
    const ownRow = screen.getByRole("rowheader", { name: "Your home: monthly → full term" }).closest("tr")!;
    expect(ownRow).toHaveTextContent("$150.00 /month → $450.00 for 3 months");
    expect(screen.getByText(/1\/3 current verified bids/)).toHaveTextContent("not an award minimum");
    expect(screen.getByRole("button", { name: "Review & accept bid" })).toBeEnabled();
    expect(screen.getByRole("rowheader", { name: /Years in business/ }).closest("tr")).toHaveTextContent("Not provided");
    expect(screen.getByRole("region", { name: /scroll horizontally/ })).toHaveAttribute("tabindex", "0");
  });

  it("sorts by price, published rating or actual start date, and rejects expired awards in the UI", () => {
    const a = bid(); const b = bid({ id: "bid-b", providerUserId: "provider-b", providerName: "Fixture Provider B", amountCents: 120000, providerRating: 4.9, providerReviewCount: 3, proposedStartDate: "2099-11-01T00:00:00Z", validUntil: "2000-01-01T00:00:00Z" });
    render(<PoolBidComparison template={template} bids={[b, a]} canAward managerView onAward={vi.fn()} />);
    const headings = () => screen.getAllByRole("columnheader").map((node) => node.textContent);
    expect(headings()[1]).toContain("Fixture Provider A");
    fireEvent.change(screen.getByLabelText("Sort bids"), { target: { value: "rating" } }); expect(headings()[1]).toContain("Fixture Provider B");
    fireEvent.change(screen.getByLabelText("Sort bids"), { target: { value: "start" } }); expect(headings()[1]).toContain("Fixture Provider B");
    expect(screen.getAllByRole("button", { name: "Review & accept bid" })[0]).toBeDisabled();
  });

  it("renders server-masked labels without exposing raw notes or inventing rating/experience proof", () => {
    render(<PoolBidComparison template={template} bids={[bid({ providerName: "Bid A", providerCompany: null, scope: "IDENTIFYING RAW NOTES" })]} />);
    expect(screen.getByRole("columnheader", { name: /Bid A/ })).toBeInTheDocument();
    expect(screen.queryByText("IDENTIFYING RAW NOTES")).not.toBeInTheDocument();
    expect(screen.getByText("No published reviews")).toBeInTheDocument();
  });
});

describe("resident pool tier selection", () => {
  it("requires an explicit tier and submits only configured keys", () => {
    const respond = vi.fn(); render(<PoolParticipation request={request()} joinOpen busy={false} onRespond={respond} />);
    expect(screen.getByRole("button", { name: "Join with this tier" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Your pool tier"), { target: { value: "large" } });
    fireEvent.submit(screen.getByRole("button", { name: "Join with this tier" }).closest("form")!);
    expect(respond).toHaveBeenCalledWith("joined", "large");
    expect(screen.queryByRole("option", { name: "Pool + spa" })).not.toBeInTheDocument();
  });

  it("allows a joined resident to change tiers before locking, with no controls after locking", () => {
    const r = { ...request(), viewerPoolTier: "standard" as const, viewerResponse: "joined" as const };
    const respond = vi.fn(); const view = render(<PoolParticipation request={r} joinOpen busy={false} onRespond={respond} />);
    expect(screen.getByRole("button", { name: "Save pool tier" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Your pool tier"), { target: { value: "large" } }); fireEvent.submit(screen.getByRole("button", { name: "Save pool tier" }).closest("form")!);
    expect(respond).toHaveBeenCalledWith("joined", "large");
    view.rerender(<PoolParticipation request={{ ...r, participantsLockedAt: "2026-11-10T01:00:00Z" }} joinOpen={false} busy={false} onRespond={respond} />);
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument(); expect(screen.getByText(/Participation is locked/)).toHaveTextContent("Standard pool");
  });

  it("keeps the template opt-in and asks the creator for explicit months and visits", () => {
    const view = render(<PoolTemplateFields enabled={false} onEnabled={vi.fn()} />);
    expect(screen.queryByLabelText(/Service term/)).not.toBeInTheDocument();
    view.rerender(<PoolTemplateFields enabled onEnabled={vi.fn()} />);
    expect(screen.getByLabelText("Service term (calendar months)")).toBeRequired();
    expect(screen.getByLabelText("Required visits per month")).toHaveValue(null);
    expect(within(screen.getByRole("group", { name: /Applicable pool tiers/ })).getAllByRole("checkbox")).toHaveLength(3);
  });
});
