// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HoaManagerWorkspace } from "@/components/hoa/HoaManagerWorkspace";
import type { HoaManagerDashboard, HoaRequestSummary } from "@/lib/hoa-types";

const state = vi.hoisted(() => ({ refresh: vi.fn(), fetch: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: state.refresh }) }));
const WEEK = 7 * 24 * 60 * 60 * 1000;
const NOW = new Date("2026-10-28T12:00:00.000Z");
function request(overrides: Partial<HoaRequestSummary> = {}): HoaRequestSummary {
  return {
    id: "optional-1", communityId: "hoa-1", title: "Optional cleaning", category: "cleaning", description: "Wash participating homes",
    kind: "optional_group", recurrenceLabel: null, recurrenceIntervalDays: null, totalOccurrences: 1,
    status: "collecting_interest", opensAt: null, enrollmentClosesAt: null, biddingClosesAt: null, startDate: null,
    minHomes: 1, maxHomes: null, participantsLockedAt: null, awardedAt: null, joinedCount: 2, declinedCount: 0,
    bidCount: 0, viewerResponse: null, createdAt: "2026-10-20T12:00:00Z", ...overrides,
  };
}
function dashboard(requests = [request()]): HoaManagerDashboard {
  return { communities: [{ id: "hoa-1", name: "Oakwood HOA", profile: null, activeMemberCount: 2, units: [], invitations: [], requests, bidsByRequest: {}, agreements: [], occurrencesByAgreement: {}, surveys: [] }] };
}
function payload(index = 0): Record<string, unknown> {
  return JSON.parse(state.fetch.mock.calls[index][1].body as string) as Record<string, unknown>;
}
function openButton() { return screen.getByRole("button", { name: /lock participants.*open bidding/i }); }
function ok() { return { ok: true, json: async () => ({}) }; }
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  state.refresh.mockReset(); state.fetch.mockReset().mockResolvedValue(ok());
  vi.stubGlobal("fetch", state.fetch);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("HOA manager bidding deadlines", () => {
  it("keeps a blank optional creation deadline null and explains that the seven days start on opening", async () => {
    render(<HoaManagerWorkspace dashboard={dashboard([])} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Request type" }), { target: { value: "optional_group" } });
    expect(screen.getByText(/leave blank for a 7-day bidding period starting when you open bidding/i)).toBeInTheDocument();
    const deadline = screen.getByLabelText(/bidding deadline/i);
    expect(deadline).not.toBeRequired();
    expect(deadline).toHaveValue("");
    fireEvent.change(screen.getByLabelText("Request title"), { target: { value: "Roof cleaning" } });
    fireEvent.change(screen.getByLabelText("Service category"), { target: { value: "cleaning" } });
    fireEvent.change(screen.getByLabelText("Enrollment deadline"), { target: { value: "2026-11-01T12:00" } });
    fireEvent.change(screen.getByLabelText("Scope shown to residents and providers"), { target: { value: "Clean participating roofs" } });
    const form = screen.getByLabelText("Request title").closest("form")!;
    vi.setSystemTime(new Date(+NOW + 86_400_000));
    fireEvent.submit(form);
    await waitFor(() => expect(state.fetch).toHaveBeenCalledOnce());
    expect(state.fetch.mock.calls[0][0]).toBe("/api/hoa/communities/hoa-1/requests");
    expect(payload()).toMatchObject({ kind: "optional_group", biddingClosesAt: null });
    await waitFor(() => expect(state.refresh).toHaveBeenCalledOnce());
  });

  it("shows default-period guidance only on optional collecting cards without a deadline", () => {
    const rows = [request(), request({ id: "dated", title: "Dated request", biddingClosesAt: "2026-11-10T10:30:00.000Z" }), request({ id: "open", title: "Open request", status: "open_for_bids" }), request({ id: "compulsory", title: "Compulsory request", kind: "compulsory_recurring" })];
    render(<HoaManagerWorkspace dashboard={dashboard(rows)} />);
    const guidance = /opening bidding sets the deadline to 7 days from that time/i;
    expect(within(screen.getByRole("heading", { name: "Optional cleaning" }).closest("article")!).getByText(guidance)).toBeInTheDocument();
    for (const name of ["Dated request", "Open request", "Compulsory request"]) {
      expect(within(screen.getByRole("heading", { name }).closest("article")!).queryByText(guidance)).not.toBeInTheDocument();
    }
  });

  it("does not add the optional-group deadline default to other kinds", async () => {
    render(<HoaManagerWorkspace dashboard={dashboard([request({ kind: "compulsory_recurring" })])} />);
    fireEvent.click(openButton());
    await waitFor(() => expect(state.fetch).toHaveBeenCalledOnce());
    expect(payload()).toEqual({ action: "open_bidding" });
  });

  it("supplies a seven-day ISO deadline measured when opening bidding, not when the page rendered", async () => {
    render(<HoaManagerWorkspace dashboard={dashboard()} />);
    vi.setSystemTime(new Date(+NOW + 3 * 86_400_000));
    fireEvent.click(openButton());
    await waitFor(() => expect(state.fetch).toHaveBeenCalledOnce());
    expect(state.fetch.mock.calls[0][0]).toBe("/api/hoa/requests/optional-1");
    expect(state.fetch.mock.calls[0][1]).toMatchObject({ method: "PATCH", credentials: "same-origin", headers: { "Content-Type": "application/json" } });
    expect(payload()).toEqual({ action: "open_bidding", biddingClosesAt: new Date(+NOW + 3 * 86_400_000 + WEEK).toISOString() });
    await waitFor(() => expect(state.refresh).toHaveBeenCalledOnce());
  });

  it.each(["2026-11-10T10:30:00.000Z", "2026-10-27T10:30:00.000Z"])("does not silently replace a configured deadline (%s)", async (deadline) => {
    render(<HoaManagerWorkspace dashboard={dashboard([request({ biddingClosesAt: deadline })])} />);
    fireEvent.click(openButton());
    await waitFor(() => expect(state.fetch).toHaveBeenCalledOnce());
    const body = payload();
    expect(body.action).toBe("open_bidding");
    if ("biddingClosesAt" in body) expect(body.biddingClosesAt).toBe(deadline);
  });

  it("disables duplicate opening while pending and refreshes after success", async () => {
    let resolve!: (value: ReturnType<typeof ok>) => void;
    state.fetch.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    render(<HoaManagerWorkspace dashboard={dashboard()} />);
    fireEvent.click(openButton());
    expect(openButton()).toBeDisabled();
    fireEvent.click(openButton());
    expect(state.fetch).toHaveBeenCalledOnce();
    expect(state.refresh).not.toHaveBeenCalled();
    resolve(ok());
    await waitFor(() => expect(state.refresh).toHaveBeenCalledOnce());
    expect(screen.getByRole("status")).toHaveTextContent(/bidding open/i);
  });

  it("shows an API failure and recomputes the deadline for a later retry", async () => {
    state.fetch.mockResolvedValueOnce({ ok: false, json: async () => ({ error: "Minimum homes not reached" }) });
    render(<HoaManagerWorkspace dashboard={dashboard()} />);
    fireEvent.click(openButton());
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Minimum homes not reached"));
    expect(openButton()).toBeEnabled();
    expect(state.refresh).not.toHaveBeenCalled();
    vi.setSystemTime(new Date(+NOW + 86_400_000));
    fireEvent.click(openButton());
    await waitFor(() => expect(state.refresh).toHaveBeenCalledOnce());
    expect(payload(1)).toEqual({ action: "open_bidding", biddingClosesAt: new Date(+NOW + 86_400_000 + WEEK).toISOString() });
  });

  it.each([
    ["draft", "Publish", "publish"], ["open_for_bids", "Close bidding", "close_bidding"],
    ["awarded", "Mark completed", "complete"], ["collecting_interest", "Cancel", "cancel"],
  ] as const)("keeps %s / %s payload unchanged", async (status, label, action) => {
    render(<HoaManagerWorkspace dashboard={dashboard([request({ status })])} />);
    fireEvent.click(screen.getByRole("button", { name: label }));
    await waitFor(() => expect(state.fetch).toHaveBeenCalledOnce());
    expect(payload()).toEqual({ action });
  });
});
