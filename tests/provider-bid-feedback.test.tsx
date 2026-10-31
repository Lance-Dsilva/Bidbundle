// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useProviderMarketplace } from "@/hooks/useProviderMarketplace";
import { ProviderMarketplaceFeed } from "@/components/provider/ProviderMarketplaceFeed";
import type { BidSummary, ProviderFeedItem, ProviderHoaWorkspace } from "@/lib/hoa-types";
import { MAX_BID_AMOUNT_CENTS } from "@/lib/validation/hoa";
const state = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/api", () => ({ apiFetch: state.api }));
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function bid(requestId = "request-1"): BidSummary { return { id: `bid-${requestId}`, requestId, providerUserId: "provider", providerName: "Provider", providerCompany: null, providerVerified: true, status: "submitted", amountCents: 10001, currency: "usd", pricingBasis: "total", perHomeCents: null, homeCount: 3, totalOccurrences: 4, proposedStartDate: null, estimatedDurationLabel: null, scope: "Whole job scope", exclusions: null, cadenceLabel: null, validUntil: null, version: 1, submittedAt: "2026-10-28T00:00:00Z" }; }
function workspace(existing = false): ProviderHoaWorkspace {
  const feed: ProviderFeedItem[] = [1, 2].map((number) => ({ requestId: `request-${number}`, context: "neighborhood", communityName: "Oakwood", locality: null, region: null, title: `Cleaning ${number}`, category: "cleaning", kind: "optional_group", description: `Scope ${number}`, recurrenceLabel: null, totalOccurrences: 4, homeCount: 3, approximateDistanceMi: null, budgetMinCents: null, budgetMaxCents: null, startDate: null, biddingClosesAt: "2030-01-01T00:00:00Z", myBid: existing && number === 1 ? bid() : null }));
  return { eligible: true, ineligibleReason: null, serviceAreas: [], categories: ["cleaning"], feed, bids: existing ? [bid()] : [], agreements: [], occurrencesByAgreement: {} };
}
async function load(existing = false) { state.api.mockResolvedValueOnce({ workspace: workspace(existing) }); render(<ProviderMarketplaceFeed />); await screen.findByRole("heading", { name: "Cleaning 1" }); }
function card(number = 1) { return screen.getByRole("heading", { name: `Cleaning ${number}` }).closest("article")!; }
function open(number = 1, revise = false) { fireEvent.click(within(card(number)).getByRole("button", { name: revise ? "Revise bid" : "Submit bid" })); }
function fill(number = 1, amount = "100.01") { const scope = within(card(number)); fireEvent.change(scope.getByLabelText(/whole-job total/i), { target: { value: amount } }); fireEvent.change(scope.getByLabelText("What is included"), { target: { value: `Draft for card ${number}` } }); }
function submit(number = 1) { fireEvent.submit(within(card(number)).getByLabelText(/whole-job total/i).closest("form")!); }
function writes() { return state.api.mock.calls.filter((call) => ["PUT", "DELETE"].includes(call[1]?.method)); }
beforeEach(() => state.api.mockReset());
afterEach(cleanup);

describe("provider bid feedback with the real marketplace hook", () => {
  it("preserves initial loading and initial-read failure", async () => {
    const initial = deferred<unknown>(); state.api.mockReturnValueOnce(initial.promise); render(<ProviderMarketplaceFeed />);
    expect(screen.getByText("Loading available work…")).toBeInTheDocument();
    await act(async () => { initial.reject(new Error("Marketplace unavailable")); });
    expect(screen.getByRole("alert")).toHaveTextContent("Marketplace unavailable"); expect(screen.queryByRole("heading", { name: "Cleaning 1" })).not.toBeInTheDocument();
  });

  it("keeps cards, draft fields and focus mounted while a confirmed write refreshes in the background", async () => {
    await load(); open(); fill(); const draft = within(card()).getByLabelText("What is included"); const form = draft.closest("form")!; draft.focus();
    const focus = vi.spyOn(draft, "focus");
    const put = deferred<unknown>(); const read = deferred<unknown>(); state.api.mockReturnValueOnce(put.promise).mockReturnValueOnce(read.promise);
    submit(); expect(writes()).toHaveLength(1); expect(form).toBeInTheDocument();
    await act(async () => { put.resolve({ bid: bid() }); });
    expect(screen.queryByText("Loading available work…")).not.toBeInTheDocument();
    expect(form).toBeInTheDocument(); expect(within(card()).getByLabelText("What is included")).toBe(draft); expect(draft).toHaveValue("Draft for card 1"); expect(draft).toHaveFocus();
    expect(within(card()).getByText(/bid (sent|saved|submitted)/i)).toBeInTheDocument();
    await act(async () => { read.resolve({ workspace: workspace(true) }); });
    expect(form).toBeInTheDocument(); expect(draft).toHaveValue("Draft for card 1");
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it.each(["", "-1", "1.234", String((MAX_BID_AMOUNT_CENTS + 1) / 100)])("shows an inline amount error and makes no PUT for invalid amount %j", async (amount) => {
    await load(); open(); fill(1, amount); submit();
    const local = within(card()); expect(await local.findByRole("alert")).toHaveTextContent(/amount|total|price|enter/i);
    expect(local.getByLabelText(/whole-job total/i)).toHaveAttribute("aria-invalid", "true"); expect(writes()).toEqual([]);
  });

  it("keeps failed writes local to their card and retains the draft for retry", async () => {
    await load(); open(); fill(); const draft = within(card()).getByLabelText("What is included");
    state.api.mockRejectedValueOnce(new Error("Quote rejected by server")); submit();
    expect(await within(card()).findByRole("alert")).toHaveTextContent("Quote rejected by server");
    expect(within(card(2)).queryByRole("alert")).not.toBeInTheDocument(); expect(draft).toHaveValue("Draft for card 1"); expect(within(card()).getByLabelText(/whole-job total/i)).toHaveValue(100.01);
    state.api.mockResolvedValueOnce({ bid: bid() }).mockResolvedValueOnce({ workspace: workspace(true) }); submit();
    await within(card()).findByText(/bid (sent|saved|submitted)/i); expect(writes()).toHaveLength(2);
  });

  it("allows only one pending write across two open forms", async () => {
    await load(); open(); fill(); open(2); fill(2);
    const put = deferred<unknown>(); state.api.mockReturnValueOnce(put.promise); submit(); submit(2);
    expect(writes()).toHaveLength(1); expect(within(card(2)).getByRole("button", { name: /sending|send bid/i })).toBeDisabled();
    await act(async () => { put.reject(new Error("First request failed")); });
    expect(await within(card()).findByRole("alert")).toHaveTextContent("First request failed");
    expect(within(card(2)).getByLabelText("What is included")).toHaveValue("Draft for card 2");
  });

  it("reports a confirmed bid separately from failed refresh and retries only the read", async () => {
    await load(); open(); fill();
    state.api.mockResolvedValueOnce({ bid: bid() }).mockRejectedValueOnce(new Error("Refresh offline")); submit();
    await within(card()).findByText(/bid (sent|saved|submitted)/i);
    const retry = await screen.findByRole("button", { name: /refresh details|retry.*refresh|refresh.*retry/i });
    expect(within(card()).queryByText(/bid (failed|was not saved|not saved)/i)).not.toBeInTheDocument(); expect(writes()).toHaveLength(1);
    const read = deferred<unknown>(); state.api.mockReturnValueOnce(read.promise); fireEvent.click(retry); fireEvent.click(retry);
    expect(state.api.mock.calls.filter((call) => call[0] === "/provider/marketplace")).toHaveLength(3);
    expect(writes()).toHaveLength(1); expect(state.api.mock.calls.at(-1)?.[0]).toBe("/provider/marketplace");
    await act(async () => { read.resolve({ workspace: workspace(true) }); });
    await waitFor(() => expect(screen.queryByRole("button", { name: /refresh details|retry.*refresh|refresh.*retry/i })).not.toBeInTheDocument()); expect(writes()).toHaveLength(1);
  });

  it("keeps withdrawal confirmation local even when its refresh fails", async () => {
    await load(true); state.api.mockResolvedValueOnce({ ok: true }).mockRejectedValueOnce(new Error("Refresh unavailable"));
    fireEvent.click(within(card()).getByRole("button", { name: "Withdraw" }));
    await within(card()).findByText(/bid withdrawn/i); expect(within(card(2)).queryByText(/bid withdrawn/i)).not.toBeInTheDocument();
    expect(writes()).toHaveLength(1); expect(writes()[0][1].method).toBe("DELETE");
    expect(await screen.findByRole("button", { name: /refresh details|retry.*refresh|refresh.*retry/i })).toBeInTheDocument();
  });
});

it("keeps another card's server error when a different bid succeeds", async () => {
  await load(); open(); fill(); state.api.mockRejectedValueOnce(new Error("Card one rejected")); submit();
  await within(card()).findByRole("alert"); open(2); fill(2);
  const updated = workspace(); updated.feed[1].myBid = bid("request-2");
  state.api.mockResolvedValueOnce({ bid: bid("request-2") }).mockResolvedValueOnce({ workspace: updated }); submit(2);
  await within(card(2)).findByText(/bid (sent|saved|submitted)/i);
  expect(within(card()).getByRole("alert")).toHaveTextContent("Card one rejected");
  expect(within(card(2)).queryByRole("alert")).not.toBeInTheDocument();
});

it("returns background-read failure explicitly without resetting loaded hook state", async () => {
  state.api.mockResolvedValueOnce({ workspace: workspace() });
  const { result } = renderHook(() => useProviderMarketplace());
  await waitFor(() => expect(result.current.loading).toBe(false));
  const loaded = result.current.workspace;
  const read = deferred<{ workspace: ProviderHoaWorkspace }>(); state.api.mockReturnValueOnce(read.promise);
  let refresh!: ReturnType<typeof result.current.refresh>;
  act(() => { refresh = result.current.refresh({ background: true }); });
  expect(result.current.loading).toBe(false); expect(result.current.workspace).toBe(loaded);
  await act(async () => { read.reject(new Error("Background offline")); await expect(refresh).resolves.toEqual({ ok: false, error: "Background offline" }); });
  expect(result.current.loading).toBe(false); expect(result.current.workspace).toBe(loaded); expect(result.current.error).toBeNull();
});

it("preserves valid zero-total bids through the inline validation gate", async () => {
  await load(); open(); fill(1, "0");
  const zero = { ...bid(), amountCents: 0 }; const updated = workspace(true); updated.feed[0].myBid = zero;
  state.api.mockResolvedValueOnce({ bid: zero }).mockResolvedValueOnce({ workspace: updated }); submit();
  await within(card()).findByText(/bid (sent|saved|submitted)/i);
  expect(JSON.parse(writes()[0][1].body)).toMatchObject({ amountCents: 0, pricingBasis: "total", perHomeCents: null });
});

it("keeps a write confirmation visible when the refreshed feed legitimately removes its request", async () => {
  await load(); open(); fill();
  const updated = workspace(); updated.feed = updated.feed.filter((item) => item.requestId !== "request-1");
  state.api.mockResolvedValueOnce({ bid: bid() }).mockResolvedValueOnce({ workspace: updated }); submit();
  const confirmation = await screen.findByText(/Cleaning 1: Bid (sent|saved|submitted)/i);
  expect(confirmation.closest("[role='status']")).toHaveTextContent(/no longer in the available feed/);
  expect(screen.queryByRole("heading", { name: "Cleaning 1" })).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Cleaning 2" })).toBeInTheDocument();
});

it("retains an edited total when the provider closes and reopens the bid form", async () => {
  await load(); open(); fill(1, "123.45");
  fireEvent.click(within(card()).getByRole("button", { name: "Submit bid" }));
  expect(within(card()).queryByLabelText(/whole-job total/i)).not.toBeInTheDocument();
  open(); expect(within(card()).getByLabelText(/whole-job total/i)).toHaveValue(123.45); expect(writes()).toEqual([]);
});
