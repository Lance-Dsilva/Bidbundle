// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { HoaManagerWorkspace } from "@/components/hoa/HoaManagerWorkspace";
import { NeighbourhoodWorkspace } from "@/components/homeowner/NeighbourhoodWorkspace";
import HomeownerBidsPage from "@/app/app/homeowner/bids/page";
import ProviderSchedulePage from "@/app/app/provider/schedule/page";
import type { AgreementSummary, BidSummary, HoaManagerDashboard, HoaRequestSummary, ProviderHoaWorkspace, VisitSummary } from "@/lib/hoa-types";
import type { NeighborhoodHub, NeighborhoodRequestView } from "@/lib/neighborhood-types";
import type { HomeownerBidView } from "@/lib/server/marketplace-reads";
const state = vi.hoisted(() => ({ api: vi.fn(), mutation: vi.fn(), router: { refresh: vi.fn(), push: vi.fn() }, hub: null as NeighborhoodHub | null, bids: [] as HomeownerBidView[], provider: null as ProviderHoaWorkspace | null }));
vi.mock("@/lib/api", () => ({ apiFetch: state.api, ApiError: class extends Error {} }));
vi.mock("next/navigation", () => ({ useRouter: () => state.router }));
// JSDOM has no native modal implementation. Emulate only opening/closing, not
// inert backgrounds, native Escape dispatch, focus trapping or viewport layout.
beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); } });
});
function bid(overrides: Partial<BidSummary> = {}): BidSummary { return { id: "bid-eur", requestId: "request-1", providerUserId: "provider", providerName: "Example Provider", providerCompany: "Euro Clean", providerVerified: true, status: "submitted", amountCents: 12345, currency: "eur", pricingBasis: "total", perHomeCents: null, homeCount: 3, totalOccurrences: 2, proposedStartDate: null, estimatedDurationLabel: null, scope: "Complete cleaning", exclusions: null, cadenceLabel: null, validUntil: null, version: 1, submittedAt: "2026-10-28T00:00:00Z", ...overrides }; }
function request(overrides: Partial<HoaRequestSummary> = {}): HoaRequestSummary { return { id: "request-1", communityId: "hood", title: "Pressure washing", category: "cleaning", description: "Wash our homes", kind: "optional_group", recurrenceLabel: null, recurrenceIntervalDays: null, totalOccurrences: 2, status: "collecting_interest", opensAt: null, enrollmentClosesAt: null, biddingClosesAt: null, startDate: null, minHomes: 1, maxHomes: null, participantsLockedAt: null, awardedAt: null, joinedCount: 3, declinedCount: 0, bidCount: 1, viewerResponse: null, createdAt: "2026-10-01T00:00:00Z", ...overrides }; }
function dashboard(job = request(), quote = bid()): HoaManagerDashboard { return { communities: [{ id: "hood", name: "Oakwood HOA", profile: null, activeMemberCount: 3, units: [], invitations: [], requests: [job], bidsByRequest: { [job.id]: [quote] }, agreements: [], occurrencesByAgreement: {}, surveys: [] }] }; }
function hub(status: HoaRequestSummary["status"] = "collecting_interest"): NeighborhoodHub {
  const job: NeighborhoodRequestView = { id: "request-1", communityId: "hood", communityName: "Oakwood", title: "Pressure washing", category: "cleaning", categoryLabel: "Cleaning", totalOccurrences: 2, description: "Wash our homes", status, budgetMinCents: null, budgetMaxCents: null, minHomes: 1, maxHomes: null, enrollmentClosesAt: null, biddingClosesAt: null, participantsLockedAt: null, awardedAt: null, startDate: null, joinedCount: 3, declinedCount: 0, bidCount: 1, viewerResponse: "joined", isOwner: true, createdByName: "Resident", createdAt: "2026-10-01T00:00:00Z", permissions: { canRespond: false, canManage: true, canViewBids: true, canEdit: true }, bids: [bid()], participants: null, agreement: null, myVisits: [], occurrences: null };
  return { communityId: "hood", communityName: "Oakwood", isManager: true, managerName: "Manager", activeNeighbourCount: 3, addressReady: true, requests: [job] };
}
function provider(): ProviderHoaWorkspace {
  const agreement: AgreementSummary = { id: "agreement", requestId: "request-1", requestTitle: "Pressure washing", communityId: "hood", communityName: "Oakwood", providerUserId: "provider", providerName: "Example Provider", providerCompany: "Euro Clean", amountCents: 12345, currency: "eur", pricingBasis: "total", perHomeCents: null, scope: "All homes", cadenceLabel: null, lockedHomeCount: 3, startDate: null, endDate: null, status: "active", createdAt: "2026-10-01T00:00:00Z" };
  const visit: VisitSummary = { id: "visit-1", occurrenceId: "occurrence", targetKind: "homeowner", unitId: null, homeownerUserId: "resident", stopLabel: "Home A", latitude: null, longitude: null, addressLine1: "1 Oak St", accessNotes: null, stopRank: 1, scheduledDate: null, windowStart: null, windowEnd: null, estimatedMinutes: null, status: "scheduled", completionNote: null, completedAt: null };
  return { eligible: true, ineligibleReason: null, serviceAreas: [], categories: [], feed: [], bids: [], agreements: [agreement], occurrencesByAgreement: { agreement: [{ id: "occurrence", agreementId: "agreement", sequence: 1, serviceDate: "2026-11-01T12:00:00Z", status: "planned", schedulePublishedAt: null, visits: [visit] }] } };
}
beforeEach(() => {
  state.mutation.mockReset().mockResolvedValue({}); state.router.refresh.mockReset(); state.router.push.mockReset(); state.hub = hub(); state.provider = provider();
  state.bids = [{ ...bid(), requestTitle: "Pressure washing", requestStatus: "bidding_closed", requestCategory: "cleaning", communityName: "Oakwood", canAward: true }];
  state.api.mockReset().mockImplementation(async (path: string, options?: RequestInit) => {
    if (options?.method) return state.mutation(path, options);
    if (path === "/homeowner/neighbourhood") return { hub: state.hub };
    if (path === "/homeowner/bids") return { bids: state.bids };
    if (path === "/provider/marketplace") return { workspace: state.provider };
    throw new Error(`Unexpected read ${path}`);
  });
  vi.stubGlobal("fetch", vi.fn(async (path: string, options?: RequestInit) => { await state.mutation(path, options); return { ok: true, json: async () => ({}) }; }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function modal() { return screen.getByRole("dialog"); }
function dismiss() { fireEvent.click(within(modal()).getByRole("button", { name: /^Cancel$/i })); }

describe("marketplace action confirmation", () => {
  it("does not cancel an HOA request until the manager explicitly confirms", async () => {
    render(<HoaManagerWorkspace dashboard={dashboard()} />);
    const opener = screen.getByRole("button", { name: /^Cancel$/ }); opener.focus(); fireEvent.click(opener);
    expect(state.mutation).not.toHaveBeenCalled();
    const dialog = modal(); expect(dialog).toHaveTextContent("Pressure washing");
    expect(within(dialog).getByRole("button", { name: /^Cancel$/i })).toHaveFocus();
    dismiss(); await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(state.mutation).not.toHaveBeenCalled(); expect(opener).toHaveFocus();
  });
});

it.each(["cancel", "complete"] as const)("requires an explicit HOA %s confirmation and preserves its payload", async (action) => {
  render(<HoaManagerWorkspace dashboard={dashboard(request({ status: action === "complete" ? "in_progress" : "collecting_interest" }))} />);
  fireEvent.click(screen.getByRole("button", { name: action === "complete" ? "Mark completed" : /^Cancel$/ }));
  expect(state.mutation).not.toHaveBeenCalled(); expect(modal()).toHaveTextContent("Pressure washing");
  fireEvent.click(within(modal()).getByRole("button", { name: action === "complete" ? "Mark complete" : "Cancel request" }));
  await waitFor(() => expect(state.mutation).toHaveBeenCalledOnce());
  expect(state.mutation.mock.calls[0][0]).toBe("/api/hoa/requests/request-1");
  expect(JSON.parse(state.mutation.mock.calls[0][1].body)).toEqual({ action });
});

it("treats the native Escape cancel event as dismissal and returns focus without writing", async () => {
  render(<HoaManagerWorkspace dashboard={dashboard()} />);
  const opener = screen.getByRole("button", { name: /^Cancel$/ }); opener.focus(); const focus = vi.spyOn(opener, "focus"); fireEvent.click(opener);
  const event = new Event("cancel", { cancelable: true }); fireEvent(modal(), event);
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(event.defaultPrevented).toBe(true); expect(state.mutation).not.toHaveBeenCalled(); expect(opener).toHaveFocus(); expect(focus).toHaveBeenCalledWith({ preventScroll: true });
});

it.each(["hoa", "neighborhood", "my-bids"])("confirms the exact provider, original currency, total and version through %s award", async (entry) => {
  if (entry === "hoa") render(<HoaManagerWorkspace dashboard={dashboard(request({ status: "bidding_closed" }))} />);
  else if (entry === "neighborhood") { state.hub = hub("bidding_closed"); render(<NeighbourhoodWorkspace />); fireEvent.click(await screen.findByRole("button", { name: /Compare 1 quote/ })); }
  else render(<HomeownerBidsPage />);
  fireEvent.click(await screen.findByRole("button", { name: entry === "hoa" ? "Accept bid" : "Award this provider" }));
  expect(state.mutation).not.toHaveBeenCalled();
  expect(modal()).toHaveTextContent("Pressure washing"); expect(modal()).toHaveTextContent("Euro Clean"); expect(modal()).toHaveTextContent("€123.45"); expect(modal()).toHaveTextContent(/whole-job total/); expect(modal()).toHaveTextContent(/3 homes × 2 visits each/);
  fireEvent.click(within(modal()).getByRole("button", { name: "Award provider" }));
  await waitFor(() => expect(state.mutation).toHaveBeenCalledOnce());
  expect(state.mutation.mock.calls[0][0]).toBe(entry === "hoa" ? "/api/hoa/requests/request-1/award" : "/homeowner/requests/request-1/award");
  expect(JSON.parse(state.mutation.mock.calls[0][1].body)).toEqual({ bidId: "bid-eur", expectedBidVersion: 1 });
});

it.each(["cancel", "complete"] as const)("confirms neighborhood %s without extending authority", async (action) => {
  state.hub = hub(action === "complete" ? "in_progress" : "collecting_interest"); render(<NeighbourhoodWorkspace />);
  fireEvent.click(await screen.findByRole("button", { name: action === "complete" ? "Mark complete" : "Cancel request" }));
  expect(state.mutation).not.toHaveBeenCalled(); expect(modal()).toHaveTextContent("Pressure washing");
  fireEvent.click(within(modal()).getByRole("button", { name: action === "complete" ? "Mark complete" : "Cancel request" }));
  await waitFor(() => expect(state.mutation).toHaveBeenCalledOnce());
  expect(state.mutation.mock.calls[0][0]).toBe("/homeowner/requests/request-1/transition"); expect(JSON.parse(state.mutation.mock.calls[0][1].body)).toEqual({ action });
});

it.each(["skipped", "blocked", "completed"] as const)("requires confirmation for provider %s with the correct visit context", async (status) => {
  render(<ProviderSchedulePage />); fireEvent.click(await screen.findByRole("button", { name: status }));
  expect(state.mutation).not.toHaveBeenCalled(); expect(modal()).toHaveTextContent("Pressure washing"); expect(modal()).toHaveTextContent("Home A"); expect(modal()).toHaveTextContent(/service day/i);
  fireEvent.click(within(modal()).getByRole("button", { name: status === "completed" ? "Mark complete" : `Mark ${status}` }));
  await waitFor(() => expect(state.mutation).toHaveBeenCalledOnce());
  expect(state.mutation.mock.calls[0][0]).toBe("/provider/marketplace/visits/visit-1/status");
  expect(JSON.parse(state.mutation.mock.calls[0][1].body)).toEqual({ status, completionNote: status === "completed" ? null : "Reported from the provider schedule." });
});

it("prevents confirming a request whose state changed while the dialog was open", async () => {
  const { rerender } = render(<HoaManagerWorkspace dashboard={dashboard()} />);
  fireEvent.click(screen.getByRole("button", { name: /^Cancel$/ }));
  rerender(<HoaManagerWorkspace dashboard={dashboard(request({ status: "cancelled" }))} />);
  expect(within(modal()).getByRole("alert")).toHaveTextContent(/details have changed/);
  const confirm = within(modal()).getByRole("button", { name: "Cancel request" }); expect(confirm).toBeDisabled(); fireEvent.click(confirm); expect(state.mutation).not.toHaveBeenCalled();
});

it.each(["version", "price"])("invalidates a quote confirmation when its %s changes", (change) => {
  const job = request({ status: "bidding_closed" }); const { rerender } = render(<HoaManagerWorkspace dashboard={dashboard(job)} />);
  fireEvent.click(screen.getByRole("button", { name: "Accept bid" }));
  rerender(<HoaManagerWorkspace dashboard={dashboard(job, bid(change === "version" ? { version: 2 } : { amountCents: 99999 }))} />);
  expect(within(modal()).getByRole("button", { name: "Award provider" })).toBeDisabled(); expect(modal()).toHaveTextContent("€123.45"); expect(state.mutation).not.toHaveBeenCalled();
});

it("deduplicates pending confirmations, blocks dismissal while saving, and keeps failed context without replaying it", async () => {
  render(<HoaManagerWorkspace dashboard={dashboard(request({ status: "bidding_closed" }))} />);
  fireEvent.click(screen.getByRole("button", { name: "Accept bid" }));
  let reject!: (error: Error) => void; state.mutation.mockReturnValueOnce(new Promise((_, no) => { reject = no; }));
  const confirm = within(modal()).getByRole("button", { name: "Award provider" });
  act(() => { fireEvent.click(confirm); fireEvent.click(confirm); });
  expect(state.mutation).toHaveBeenCalledOnce(); expect(within(modal()).getByRole("button", { name: /^Cancel$/ })).toBeDisabled();
  fireEvent(modal(), new Event("cancel", { cancelable: true })); fireEvent.click(modal()); expect(modal()).toBeInTheDocument();
  await act(async () => { reject(new Error("Quote changed on the server")); });
  expect(within(modal()).getByRole("alert")).toHaveTextContent("Quote changed on the server"); expect(modal()).toHaveTextContent("Euro Clean"); expect(modal()).toHaveTextContent("€123.45");
  dismiss(); fireEvent.click(screen.getByRole("button", { name: /^Cancel$/ })); expect(within(modal()).queryByRole("alert")).not.toBeInTheDocument();
  fireEvent.click(within(modal()).getByRole("button", { name: "Cancel request" }));
  await waitFor(() => expect(state.mutation).toHaveBeenCalledTimes(2));
  expect(JSON.parse(state.mutation.mock.calls[1][1].body)).toEqual({ action: "cancel" });
});

it.each(["hoa", "neighborhood", "my-bids"])("keeps legacy unit quotes unawardable through the %s confirmation entry point", async (entry) => {
  if (entry === "hoa") render(<HoaManagerWorkspace dashboard={dashboard(request({ status: "bidding_closed" }), bid({ pricingBasis: "per_home" }))} />);
  else if (entry === "neighborhood") { state.hub = hub("bidding_closed"); state.hub.requests[0].bids = [bid({ pricingBasis: "per_visit" })]; render(<NeighbourhoodWorkspace />); fireEvent.click(await screen.findByRole("button", { name: /Compare 1 quote/ })); }
  else { state.bids[0].pricingBasis = "per_visit"; render(<HomeownerBidsPage />); }
  const button = await screen.findByRole("button", { name: entry === "hoa" ? "Accept bid" : "Award this provider" });
  expect(button).toBeDisabled(); fireEvent.click(button); expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); expect(state.mutation).not.toHaveBeenCalled();
});

it("does not invent home or visit counts for a historical quote without metadata", () => {
  render(<HoaManagerWorkspace dashboard={dashboard(request({ status: "bidding_closed" }), bid({ homeCount: undefined, totalOccurrences: undefined }))} />);
  fireEvent.click(screen.getByRole("button", { name: "Accept bid" })); expect(modal()).toHaveTextContent("€123.45");
  expect(within(modal()).queryByText(/≈/)).not.toBeInTheDocument(); expect(within(modal()).queryByText(/homes × .*visits/)).not.toBeInTheDocument();
});

it("explicitly wraps both Tab boundaries and contains focus when saving disables all modal buttons", async () => {
  render(<HoaManagerWorkspace dashboard={dashboard()} />); fireEvent.click(screen.getByRole("button", { name: /^Cancel$/ }));
  const dialog = modal(); const safe = within(dialog).getByRole("button", { name: /^Cancel$/ }); const confirm = within(dialog).getByRole("button", { name: "Cancel request" });
  confirm.focus(); const forward = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }); fireEvent(confirm, forward);
  expect(forward.defaultPrevented).toBe(true); expect(safe).toHaveFocus();
  const backward = new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true }); fireEvent(safe, backward);
  expect(backward.defaultPrevented).toBe(true); expect(confirm).toHaveFocus();
  let resolve!: (value: object) => void; state.mutation.mockReturnValueOnce(new Promise((done) => { resolve = done; })); fireEvent.click(confirm);
  const pendingTab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }); fireEvent(dialog, pendingTab);
  expect(pendingTab.defaultPrevented).toBe(true); expect(dialog).toHaveFocus(); expect(state.mutation).toHaveBeenCalledOnce();
  await act(async () => { resolve({}); });
});
