// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { HomeownerRequestView } from "@/lib/server/homeowner-requests";
import HomeownerRequestsPage from "@/app/app/homeowner/requests/page";

const originalFetch = global.fetch;
const eligibility = { canCreate: true, communityId: "community-1", communityName: "Oakwood Heights" };
const blocked = { canCreate: false, reason: "hoa_resident", message: "Your HOA manager arranges your services.", actionLabel: "Open your community", actionPath: "/app/homeowner/community" };
const recent: HomeownerRequestView = {
  id: "request-recent", title: "Clean the gutters", category: "gutter", categoryLabel: "Gutters",
  description: "Clear leaves from the back gutters.", budgetMinCents: 12345, budgetMaxCents: 30050,
  status: "collecting_interest", context: "neighborhood", communityId: "community-1", communityName: "Oakwood Heights",
  bidCount: 2, bestBidCents: 87654321, enrollmentClosesAt: null,
  createdAt: "2026-10-28T12:00:00.000Z", updatedAt: "2026-10-28T12:00:00.000Z",
};
const older: HomeownerRequestView = { ...recent, id: "request-older", title: "Paint the fence", category: "painting", categoryLabel: "Painting", bidCount: 0, budgetMinCents: null, budgetMaxCents: null, createdAt: "2026-10-27T12:00:00.000Z" };
const response = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });
const scroll = vi.fn();

function mockList(requests: HomeownerRequestView[] = [recent, older], allowed = eligibility) {
  const fetchMock = vi.fn().mockResolvedValue(response({ requests, eligibility: allowed }));
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

beforeEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState({}, "", "/app/homeowner/requests");
  Element.prototype.scrollIntoView = scroll;
  scroll.mockClear();
});
afterEach(() => { cleanup(); global.fetch = originalFetch; });

describe("own recent service requests", () => {
  it("loads only the canonical session-scoped list and renders summaries with a separate create link", async () => {
    const fetchMock = mockList();
    render(<HomeownerRequestsPage />);
    const first = await screen.findByRole("article", { name: recent.title });
    const second = screen.getByRole("article", { name: older.title });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/homeowner/requests", expect.objectContaining({ credentials: "same-origin", cache: "no-store" }));
    expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: /My requests/i })).toBeInTheDocument();
    expect(screen.getByText(/recent service requests/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /New request/i })).toHaveAttribute("href", "/app/homeowner/request");
    expect(screen.queryByLabelText("Title")).not.toBeInTheDocument();
    expect(first).toHaveTextContent("Gutters · Oakwood Heights");
    expect(within(first).getByText(recent.description)).toBeInTheDocument();
    expect(first).toHaveTextContent("Collecting neighbours");
    expect(within(first).getByText("Bids").nextElementSibling).toHaveTextContent("2");
    expect(first).toHaveTextContent("$123.45");
    expect(first).toHaveTextContent("$300.50");
    expect(first.textContent).not.toMatch(/87654321|876,543|best bid|lowest bid/i);
    expect(second).toHaveTextContent(/budget not provided/i);
    expect(second).not.toHaveTextContent("$0");
    expect(within(second).getByText("Bids").nextElementSibling).toHaveTextContent("0");
  });

  it("offers an empty state and New request without inventing cards", async () => {
    mockList([]);
    render(<HomeownerRequestsPage />);
    expect(await screen.findByText(/No requests yet/i)).toBeInTheDocument();
    expect(screen.queryAllByRole("article")).toHaveLength(0);
    expect(screen.getByRole("link", { name: /New request/i })).toHaveAttribute("href", "/app/homeowner/request");
  });

  it("keeps a loading status while the list is pending", async () => {
    let resolve!: (value: unknown) => void;
    global.fetch = vi.fn(() => new Promise((done) => { resolve = done; })) as unknown as typeof fetch;
    render(<HomeownerRequestsPage />);
    expect(screen.getByRole("status")).toHaveTextContent(/loading your requests/i);
    expect(screen.queryAllByRole("article")).toHaveLength(0);
    await act(async () => resolve(response({ requests: [recent], eligibility })));
    expect(await screen.findByRole("article", { name: recent.title })).toBeInTheDocument();
  });

  it.each(["http", "network", "invalid-json"])("shows a readable %s error and retries the same scoped endpoint", async (failure) => {
    const fetchMock = vi.fn().mockImplementationOnce(async () => {
      if (failure === "network") throw new Error("offline");
      if (failure === "invalid-json") return { ok: true, status: 200, json: async () => { throw new Error("bad JSON"); } };
      return response({ error: "internal diagnostic" }, 500);
    }).mockResolvedValue(response({ requests: [recent], eligibility }));
    global.fetch = fetchMock as unknown as typeof fetch;
    render(<HomeownerRequestsPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not load your requests/i);
    expect(screen.queryAllByRole("article")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("article", { name: recent.title })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const call of fetchMock.mock.calls) expect(call[0]).toBe("/api/homeowner/requests");
  });

  it("retains own history while showing server eligibility guidance instead of a create action", async () => {
    global.fetch = vi.fn().mockResolvedValue(response({ requests: [recent], eligibility: blocked })) as unknown as typeof fetch;
    render(<HomeownerRequestsPage />);
    expect(await screen.findByRole("article", { name: recent.title })).toBeInTheDocument();
    expect(screen.getByText(blocked.message)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: blocked.actionLabel })).toHaveAttribute("href", blocked.actionPath);
    expect(screen.queryByRole("link", { name: /New request/i })).not.toBeInTheDocument();
  });

  it.each([[null, 1050, /up to \$10\.50/i], [25075, null, /from \$250\.75/i]] as const)("formats a partial budget (%s, %s) without an invented zero", async (min, max, label) => {
    mockList([{ ...recent, budgetMinCents: min, budgetMaxCents: max }]);
    render(<HomeownerRequestsPage />);
    const card = await screen.findByRole("article", { name: recent.title });
    expect(card).toHaveTextContent(label);
    expect(card).not.toHaveTextContent("$0");
  });

  it("focuses exactly the requested owned card only after an asynchronous list load", async () => {
    window.history.replaceState({}, "", "/app/homeowner/requests#request-request-older");
    let resolve!: (value: unknown) => void;
    const fetchMock = vi.fn(() => new Promise((done) => { resolve = done; }));
    global.fetch = fetchMock as unknown as typeof fetch;
    render(<HomeownerRequestsPage />);
    expect(document.activeElement).toBe(document.body);
    await act(async () => resolve(response({ requests: [recent, older], eligibility })));
    const target = await screen.findByRole("article", { name: older.title });
    await waitFor(() => expect(target).toHaveFocus());
    expect(target).toHaveAttribute("id", "request-request-older");
    expect(screen.getByRole("article", { name: recent.title })).not.toHaveFocus();
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("names and focuses an owned card with an opaque whitespace and slash ID after loading", async () => {
    const opaque = { ...older, id: "new / target" };
    window.history.replaceState({}, "", "/app/homeowner/requests#request-new%20%2F%20target");
    let resolve!: (value: unknown) => void;
    const fetchMock = vi.fn(() => new Promise((done) => { resolve = done; }));
    global.fetch = fetchMock as unknown as typeof fetch;
    render(<HomeownerRequestsPage />);
    expect(document.activeElement).toBe(document.body);
    expect(scroll).not.toHaveBeenCalled();
    await act(async () => resolve(response({ requests: [recent, opaque], eligibility })));
    const target = await screen.findByRole("article", { name: opaque.title });
    const heading = within(target).getByRole("heading", { name: opaque.title });
    expect(target).toHaveAttribute("id", "request-new%20%2F%20target");
    expect(heading).toHaveAttribute("id", "request-title-new%20%2F%20target");
    expect(target).toHaveAttribute("aria-labelledby", heading.id);
    expect(document.getElementById(target.getAttribute("aria-labelledby")!)).toBe(heading);
    await waitFor(() => expect(target).toHaveFocus());
    expect(screen.getByRole("article", { name: recent.title })).not.toHaveFocus();
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/homeowner/requests", expect.objectContaining({ credentials: "same-origin", cache: "no-store" }));
  });

  it.each(["", "#request-unknown", "#request-%E0%A4%A", "#other-element", "#request-%23%5Bowner%3Dother%5D"])("does not steal focus or fetch arbitrary targets for hash %s", async (hash) => {
    window.history.replaceState({}, "", `/app/homeowner/requests${hash}`);
    const fetchMock = mockList();
    render(<HomeownerRequestsPage />);
    await screen.findByRole("article", { name: recent.title });
    expect(document.activeElement).toBe(document.body);
    expect(scroll).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/homeowner/requests");
  });

  it("handles a subsequent valid hash change without refetching or widening ownership", async () => {
    const fetchMock = mockList();
    render(<HomeownerRequestsPage />);
    const card = await screen.findByRole("article", { name: recent.title });
    act(() => {
      window.history.replaceState({}, "", "/app/homeowner/requests#request-request-recent");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    await waitFor(() => expect(card).toHaveFocus());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
