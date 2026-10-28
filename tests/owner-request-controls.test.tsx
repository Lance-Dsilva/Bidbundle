// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { NeighbourhoodWorkspace } from "@/components/homeowner/NeighbourhoodWorkspace";
import type { NeighborhoodHub, NeighborhoodRequestView } from "@/lib/neighborhood-types";
const state = vi.hoisted(() => ({ api: vi.fn(), mutation: vi.fn(), hub: null as NeighborhoodHub | null }));
vi.mock("@/lib/api", async (original) => ({ ...await original<typeof import("@/lib/api")>(), apiFetch: state.api }));
beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); } });
});
function job(overrides: Partial<NeighborhoodRequestView> = {}): NeighborhoodRequestView {
  return { id: "request-owner", communityId: "hood", communityName: "Oakwood", title: "Clean our driveways", category: "cleaning", categoryLabel: "Cleaning", totalOccurrences: 1, description: "Driveway and patio cleaning", status: "collecting_interest", budgetMinCents: 10000, budgetMaxCents: 25000, minHomes: 1, maxHomes: null, enrollmentClosesAt: null, biddingClosesAt: null, participantsLockedAt: null, awardedAt: null, startDate: null, joinedCount: 3, declinedCount: 0, bidCount: 0, viewerResponse: "joined", isOwner: true, createdByName: "Owner", createdAt: "2026-10-01T00:00:00Z", permissions: { canRespond: false, canManage: false, canViewBids: true, canEdit: true }, bids: [], participants: null, agreement: null, myVisits: [], occurrences: null, ...overrides };
}
function hub(request = job()): NeighborhoodHub { return { communityId: "hood", communityName: "Oakwood", isManager: request.permissions.canManage, managerName: "Manager", activeNeighbourCount: 3, addressReady: true, requests: [request] }; }
function editButton() { return screen.getByRole("button", { name: "Edit request" }); }
function save() { return screen.getByRole("button", { name: "Save changes" }); }
function editPayload() { return { action: "edit", title: "Clean our driveways", category: "cleaning", description: "Driveway and patio cleaning", budgetMinCents: 10000, budgetMaxCents: 25000 }; }
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
beforeEach(() => {
  state.hub = hub(); state.mutation.mockReset().mockImplementation(async (_path: string, options: RequestInit) => { const input = JSON.parse(String(options.body)); return { request: job(input.action === "cancel" ? { status: "cancelled", permissions: { ...job().permissions, canEdit: false } } : { ...input, title: "Canonical saved title" }) }; });
  state.api.mockReset().mockImplementation(async (path: string, options?: RequestInit) => options?.method ? state.mutation(path, options) : { hub: state.hub });
});
afterEach(cleanup);
async function openEditor() { render(<NeighbourhoodWorkspace />); fireEvent.click(await screen.findByRole("button", { name: "Edit request" })); }
describe("creator request editing and cancellation", () => {
  it("offers owner controls and prefills persisted fields in dollars", async () => {
    await openEditor();
    expect(screen.getByLabelText("Title", { exact: true })).toHaveValue("Clean our driveways");
    expect(screen.getByLabelText("Service category", { exact: true })).toHaveValue("cleaning");
    expect(screen.getByLabelText("Description", { exact: true })).toHaveValue("Driveway and patio cleaning");
    expect(screen.getByLabelText("Minimum budget ($)", { exact: true })).toHaveValue("100.00");
    expect(screen.getByLabelText("Maximum budget ($)", { exact: true })).toHaveValue("250.00");
  });
  it.each([
    { isOwner: false },
    { permissions: { ...job().permissions, canEdit: false } },
    { status: "open_for_bids" as const },
    { participantsLockedAt: "2026-10-28T12:00:00Z" },
  ])("does not offer owner controls when server view disallows editing: %j", async (changes) => {
    state.hub = hub(job(changes)); render(<NeighbourhoodWorkspace />);
    await screen.findByText("Oakwood");
    expect(screen.queryByRole("button", { name: "Edit request" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel request" })).not.toBeInTheDocument();
  });
  it("sends only allowed scope fields using PATCH and displays canonical returned data without a loading reset", async () => {
    await openEditor(); fireEvent.change(screen.getByLabelText("Title", { exact: true }), { target: { value: "Updated request" } }); fireEvent.click(save());
    await waitFor(() => expect(state.mutation).toHaveBeenCalledOnce());
    expect(state.mutation.mock.calls[0][0]).toBe("/homeowner/requests/request-owner");
    expect(state.mutation.mock.calls[0][1].method).toBe("PATCH");
    expect(JSON.parse(state.mutation.mock.calls[0][1].body)).toEqual({ ...editPayload(), title: "Updated request" });
    await screen.findByText("Canonical saved title");
    expect(screen.queryByText("Loading your neighbourhood…")).not.toBeInTheDocument();
    expect(state.api.mock.calls.filter(([, options]) => !options?.method)).toHaveLength(1);
  });
  it("preserves nullable historical budget pair rather than coercing missing values to zero", async () => {
    state.hub = hub(job({ budgetMinCents: null, budgetMaxCents: null })); await openEditor();
    expect(screen.getByLabelText("Minimum budget ($)", { exact: true })).toHaveValue("");
    expect(screen.getByLabelText("Maximum budget ($)", { exact: true })).toHaveValue("");
    fireEvent.click(save()); await waitFor(() => expect(state.mutation).toHaveBeenCalledOnce());
    expect(JSON.parse(state.mutation.mock.calls[0][1].body)).toMatchObject({ budgetMinCents: null, budgetMaxCents: null });
  });
  it.each([
    ["Title", ""], ["Minimum budget ($)", "-1"], ["Maximum budget ($)", "99"], ["Minimum budget ($)", ""],
  ])("rejects invalid %s without a network mutation", async (label, value) => {
    await openEditor(); fireEvent.change(screen.getByLabelText(label, { exact: true }), { target: { value } }); fireEvent.click(save());
    await waitFor(() => expect(screen.getAllByRole("alert").length).toBeGreaterThan(0)); expect(state.mutation).not.toHaveBeenCalled();
  });
  it("retains edited values and permits retry after a network failure", async () => {
    state.mutation.mockRejectedValueOnce(new Error("Scope update failed")); await openEditor();
    fireEvent.change(screen.getByLabelText("Title", { exact: true }), { target: { value: "Keep my draft" } }); fireEvent.click(save());
    await screen.findByText("Scope update failed"); expect(screen.getByLabelText("Title", { exact: true })).toHaveValue("Keep my draft"); expect(save()).toBeEnabled();
    fireEvent.click(save()); await screen.findByText("Canonical saved title"); expect(state.mutation).toHaveBeenCalledTimes(2);
  });
  it("deduplicates pending saves and prevents a second owner mutation while saving", async () => {
    const pending = deferred<{ request: NeighborhoodRequestView }>(); state.mutation.mockReturnValueOnce(pending.promise); await openEditor();
    const button = save(); fireEvent.click(button); fireEvent.click(button);
    expect(state.mutation).toHaveBeenCalledOnce(); expect(button).toBeDisabled();
    await act(async () => pending.resolve({ request: job({ title: "Saved once" }) })); await screen.findByText("Saved once");
  });
  it("discards local edits without a mutation", async () => {
    await openEditor(); fireEvent.change(screen.getByLabelText("Title", { exact: true }), { target: { value: "Discard me" } });
    fireEvent.click(screen.getByRole("button", { name: "Discard edits" })); expect(state.mutation).not.toHaveBeenCalled();
    fireEvent.click(editButton()); expect(screen.getByLabelText("Title", { exact: true })).toHaveValue("Clean our driveways");
  });
  it("cancel dismissal writes nothing, restores focus, and successful confirmation sends only action cancel", async () => {
    render(<NeighbourhoodWorkspace />); const opener = await screen.findByRole("button", { name: "Cancel request" }); opener.focus(); fireEvent.click(opener);
    let dialog = screen.getByRole("dialog"); expect(dialog).toHaveTextContent("Clean our driveways"); expect(dialog).toHaveTextContent("3"); expect(state.mutation).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" })); expect(state.mutation).not.toHaveBeenCalled(); expect(opener).toHaveFocus();
    fireEvent.click(opener); dialog = screen.getByRole("dialog"); fireEvent.click(within(dialog).getByRole("button", { name: "Cancel request" }));
    await waitFor(() => expect(state.mutation).toHaveBeenCalledOnce()); expect(state.mutation.mock.calls[0][0]).toBe("/homeowner/requests/request-owner");
    expect(state.mutation.mock.calls[0][1].method).toBe("PATCH"); expect(JSON.parse(state.mutation.mock.calls[0][1].body)).toEqual({ action: "cancel" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument()); expect(screen.queryByRole("button", { name: "Edit request" })).not.toBeInTheDocument();
  });
  it("refuses a stale cancellation when ownership permission changes while confirmation is open", async () => {
    const view = render(<NeighbourhoodWorkspace />); fireEvent.click(await screen.findByRole("button", { name: "Cancel request" }));
    state.hub!.requests[0] = job({ permissions: { ...job().permissions, canEdit: false } }); view.rerender(<NeighbourhoodWorkspace />);
    const dialog = screen.getByRole("dialog"); expect(within(dialog).getByRole("button", { name: "Cancel request" })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel request" })); expect(state.mutation).not.toHaveBeenCalled();
  });
  it("keeps cancellation context on failure, latches pending duplicate clicks and permits explicit retry", async () => {
    const pending = deferred<{ request: NeighborhoodRequestView }>(); state.mutation.mockReturnValueOnce(pending.promise);
    render(<NeighbourhoodWorkspace />); fireEvent.click(await screen.findByRole("button", { name: "Cancel request" }));
    let dialog = screen.getByRole("dialog"); const confirm = within(dialog).getByRole("button", { name: "Cancel request" }); fireEvent.click(confirm); fireEvent.click(confirm);
    expect(state.mutation).toHaveBeenCalledOnce(); expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();
    await act(async () => pending.reject(new Error("Cancellation failed"))); dialog = screen.getByRole("dialog"); expect(dialog).toHaveTextContent("Clean our driveways"); expect(dialog).toHaveTextContent("Cancellation failed");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel request" })); await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument()); expect(state.mutation).toHaveBeenCalledTimes(2);
  });

  it("attaches server field errors to the retained edit form", async () => {
    state.mutation.mockRejectedValueOnce(new ApiError(400, "Please check the highlighted fields.", { budgetMaxCents: "Budget changed on the server." }));
    await openEditor(); fireEvent.click(save()); await screen.findByText("Budget changed on the server.");
    const field = screen.getByRole("textbox", { name: /^Maximum budget \(\$\)/ }); expect(field).toHaveAttribute("aria-invalid", "true");
    expect(document.getElementById(field.getAttribute("aria-describedby") ?? "")).toHaveTextContent("Budget changed on the server.");
    expect(field).toHaveValue("250.00"); expect(save()).toBeEnabled();
  });

});
