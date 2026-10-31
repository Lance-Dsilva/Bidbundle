// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HoaManagerWorkspace } from "@/components/hoa/HoaManagerWorkspace";
import type { HoaManagerDashboard, HoaRequestSummary } from "@/lib/hoa-types";
import { hoaRequestCreateSchema } from "@/lib/validation/hoa";
const state = vi.hoisted(() => ({ fetch: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: state.refresh }) }));
function dashboard(): HoaManagerDashboard { return { communities: [{ id: "hoa-1", name: "Owned HOA", profile: null, activeMemberCount: 2, units: [], invitations: [], requests: [], bidsByRequest: {}, agreements: [], occurrencesByAgreement: {}, surveys: [] }] }; }
function ok() { return { ok: true, json: async () => ({}) }; }
beforeEach(() => { state.fetch.mockReset().mockResolvedValue(ok()); state.refresh.mockReset(); vi.stubGlobal("fetch", state.fetch); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function form() { return screen.getByLabelText("Request title").closest("form")!; }
function change(label: string | RegExp, value: string) { fireEvent.change(screen.getByLabelText(label), { target: { value } }); }
function payload(index = 0) { return JSON.parse(state.fetch.mock.calls[index][1].body as string) as Record<string, unknown>; }
function fillBase() { change("Request title", "Grounds care"); const category = screen.getByRole("combobox", { name: "Service category" }); fireEvent.change(category, { target: { value: (within(category).getByRole("option", { name: "Landscaping" }) as HTMLOptionElement).value } }); change("Scope shown to residents and providers", "Mow and edge every included lawn."); }
function fill() { fillBase(); change("Bidding deadline", "2027-02-01T12:00"); }
function frequency(name: string) { fireEvent.change(screen.getByRole("combobox", { name: /frequency/i }), { target: { value: (screen.getByRole("option", { name }) as HTMLOptionElement).value } }); }
function kind(value: "compulsory_recurring" | "optional_group") { change("Request type", value); }
async function submit(count = 1) { fireEvent.submit(form()); await waitFor(() => expect(state.fetch).toHaveBeenCalledTimes(count)); }
describe("plain HOA request creation", () => {
  it("offers plain request choices and a single truthful frequency control", () => {
    render(<HoaManagerWorkspace dashboard={dashboard()} />);
    expect(screen.getByRole("option", { name: "Every home gets this service" })).toHaveValue("compulsory_recurring");
    expect(screen.getByRole("option", { name: "Residents choose to join" })).toHaveValue("optional_group");
    const frequency = screen.getByRole("combobox", { name: /frequency/i });
    expect(within(frequency).getAllByRole("option").map((option) => option.textContent)).toEqual(["Weekly", "Every 2 weeks", "Monthly (every 30 days)"]);
    expect(frequency).toHaveDisplayValue("Weekly");
    expect(screen.queryByLabelText("Recurrence description")).not.toBeInTheDocument(); expect(screen.queryByLabelText("Days between visits")).not.toBeInTheDocument();
    expect(screen.getByText(/Monthly.*(?:30.day|30 days).*different dates each month/i)).toBeInTheDocument();
  });
  it.each([["Weekly", 7], ["Every 2 weeks", 14], ["Monthly (every 30 days)", 30]] as const)("serializes visible %s into one coherent label/interval accepted by the existing API", async (label, days) => {
    render(<HoaManagerWorkspace dashboard={dashboard()} />); fill(); frequency(label); change("How many visits", "12"); change("First service date", "2027-02-05");
    await submit();
    expect(state.fetch.mock.calls[0][0]).toBe("/api/hoa/communities/hoa-1/requests");
    expect(state.fetch.mock.calls[0][1]).toMatchObject({ method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" } });
    expect(payload()).toEqual({ title: "Grounds care", category: "landscaping", description: "Mow and edge every included lawn.", kind: "compulsory_recurring", recurrenceLabel: label, recurrenceIntervalDays: days, totalOccurrences: 12, startDate: new Date("2027-02-05").toISOString(), enrollmentClosesAt: null, biddingClosesAt: new Date("2027-02-01T12:00").toISOString(), minHomes: null, publish: true });
    expect(hoaRequestCreateSchema.safeParse(payload()).success).toBe(true);
  });
  it("updates cadence before submission rather than retaining the previous interval", async () => {
    render(<HoaManagerWorkspace dashboard={dashboard()} />); fill(); change("How many visits", "3"); frequency("Monthly (every 30 days)"); frequency("Every 2 weeks");
    await submit(); expect(payload()).toMatchObject({ recurrenceLabel: "Every 2 weeks", recurrenceIntervalDays: 14 });
  });
  it.each(["", "4"])("sends null optional recurrence with visit input %j and preserves a blank bidding deadline", async (visits) => {
    render(<HoaManagerWorkspace dashboard={dashboard()} />); frequency("Monthly (every 30 days)"); kind("optional_group"); fillBase(); change("Enrollment deadline", "2027-01-25T12:00"); change("Minimum homes", "3"); change("How many visits", visits);
    expect(screen.queryByRole("combobox", { name: /frequency/i })).not.toBeInTheDocument(); expect(screen.getByLabelText(/Bidding deadline/)).not.toBeRequired();
    await submit(); expect(payload()).toMatchObject({ kind: "optional_group", recurrenceLabel: null, recurrenceIntervalDays: null, totalOccurrences: visits ? 4 : 1, enrollmentClosesAt: new Date("2027-01-25T12:00").toISOString(), biddingClosesAt: null, minHomes: 3 });
    expect(hoaRequestCreateSchema.safeParse(payload()).success).toBe(true);
  });
  it("restores the visible cadence and visit count after switching kinds, without leaking optional fields", async () => {
    render(<HoaManagerWorkspace dashboard={dashboard()} />); frequency("Monthly (every 30 days)"); change("How many visits", "8"); kind("optional_group"); change("Enrollment deadline", "2027-01-25T12:00"); change("Minimum homes", "5");
    kind("compulsory_recurring"); expect(screen.getByRole("combobox", { name: /frequency/i })).toHaveDisplayValue("Monthly (every 30 days)"); expect(screen.getByLabelText("How many visits")).toHaveValue(8);
    fill(); await submit(); expect(payload()).toMatchObject({ kind: "compulsory_recurring", recurrenceLabel: "Monthly (every 30 days)", recurrenceIntervalDays: 30, totalOccurrences: 8, enrollmentClosesAt: null, minHomes: null });
  });
  it.each([1, 104])("retains valid visit-count boundary %s", async (count) => {
    render(<HoaManagerWorkspace dashboard={dashboard()} />); fill(); change("How many visits", String(count)); await submit();
    expect(payload().totalOccurrences).toBe(count); expect(hoaRequestCreateSchema.safeParse(payload()).success).toBe(true);
  });
  it.each(["", "0", "105", "1.5", "-1"])("refuses invalid required visit count %j without a write", (count) => {
    render(<HoaManagerWorkspace dashboard={dashboard()} />); fill(); change("How many visits", count);
    const visits = screen.getByLabelText("How many visits"); expect(visits).toHaveAttribute("min", "1"); expect(visits).toHaveAttribute("max", "104"); expect(visits).toHaveAttribute("step", "1");
    expect((visits as HTMLInputElement).checkValidity()).toBe(false); fireEvent.submit(form()); expect(state.fetch).not.toHaveBeenCalled(); expect(state.refresh).not.toHaveBeenCalled();
  });
  it.each(["Request title", "Service category", "Scope shown to residents and providers", "Bidding deadline"])("refuses missing %s before writing", (label) => {
    render(<HoaManagerWorkspace dashboard={dashboard()} />); fill(); change("How many visits", "2"); change(label, ""); fireEvent.submit(form()); expect(state.fetch).not.toHaveBeenCalled();
  });
  it.each(["Request title", "Scope shown to residents and providers"])("rejects whitespace-only %s through the unchanged API validation", (label) => {
    render(<HoaManagerWorkspace dashboard={dashboard()} />); fill(); change("How many visits", "2"); change(label, "   ");
    // Native required validation allows whitespace; the existing schema must
    // still reject it before the component sends a request.
    expect(form().checkValidity()).toBe(true); fireEvent.submit(form()); expect(state.fetch).not.toHaveBeenCalled();
  });
  it.each(["", "   ", "gardening", "unsupported service"])("refuses an empty or unsupported service selection %j through native validity without writing", (value) => {
    render(<HoaManagerWorkspace dashboard={dashboard()} />); fill(); change("How many visits", "2");
    const category = screen.getByRole("combobox", { name: "Service category" });
    expect(category).toBeRequired(); fireEvent.change(category, { target: { value } });
    // A native select cannot retain a value outside its canonical options.
    expect((category as HTMLSelectElement).value).toBe(""); expect(form().checkValidity()).toBe(false);
    fireEvent.submit(form()); expect(state.fetch).not.toHaveBeenCalled(); expect(state.refresh).not.toHaveBeenCalled();
  });
  it("retains the publish toggle and an explicit optional bidding deadline", async () => {
    render(<HoaManagerWorkspace dashboard={dashboard()} />); kind("optional_group"); fillBase(); change("Enrollment deadline", "2027-01-25T12:00"); change(/Bidding deadline/, "2027-02-02T15:30");
    fireEvent.click(screen.getByRole("checkbox", { name: "Publish immediately" })); await submit();
    expect(payload()).toMatchObject({ kind: "optional_group", publish: false, biddingClosesAt: new Date("2027-02-02T15:30").toISOString(), recurrenceLabel: null, recurrenceIntervalDays: null, totalOccurrences: 1 });
    expect(hoaRequestCreateSchema.safeParse(payload()).success).toBe(true);
  });
  it("preserves a historical custom recurrence label while offering presets only for new requests", () => {
    const saved: HoaRequestSummary = { id: "historical", communityId: "hoa-1", title: "Historical grounds care", category: "gardening", description: "Existing scope", kind: "compulsory_recurring", recurrenceLabel: "Third Tuesday plus annual make-up", recurrenceIntervalDays: 21, totalOccurrences: 9, status: "completed", opensAt: null, enrollmentClosesAt: null, biddingClosesAt: null, startDate: null, minHomes: null, maxHomes: null, participantsLockedAt: null, awardedAt: null, joinedCount: 2, declinedCount: 0, bidCount: 0, viewerResponse: null, createdAt: "2026-10-01T00:00:00Z" };
    const data = dashboard(); data.communities[0].requests = [saved]; render(<HoaManagerWorkspace dashboard={data} />);
    const card = screen.getByRole("heading", { name: "Historical grounds care" }).closest("article")!;
    expect(within(card).getByText(/Third Tuesday plus annual make-up/)).toBeInTheDocument(); expect(screen.getByRole("combobox", { name: /frequency/i })).toHaveDisplayValue("Weekly"); expect(state.fetch).not.toHaveBeenCalled();
  });
  it("retains entered values after failure and retries the same request", async () => {
    state.fetch.mockResolvedValueOnce({ ok: false, json: async () => ({ error: "Choose a later bidding deadline." }) });
    render(<HoaManagerWorkspace dashboard={dashboard()} />); fill(); frequency("Every 2 weeks"); change("How many visits", "6"); await submit();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Choose a later bidding deadline."));
    expect(screen.getByLabelText("Request title")).toHaveValue("Grounds care"); expect(screen.getByRole("combobox", { name: /frequency/i })).toHaveDisplayValue("Every 2 weeks"); expect(screen.getByLabelText("How many visits")).toHaveValue(6); expect(state.refresh).not.toHaveBeenCalled();
    const failed = payload(); await submit(2); expect(payload(1)).toEqual(failed); await waitFor(() => expect(state.refresh).toHaveBeenCalledOnce());
  });
  it("protects a pending creation from duplicate submits and preserves its captured payload", async () => {
    let resolve!: (value: ReturnType<typeof ok>) => void; state.fetch.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    render(<HoaManagerWorkspace dashboard={dashboard()} />); fill(); frequency("Monthly (every 30 days)"); change("How many visits", "9");
    act(() => { fireEvent.submit(form()); fireEvent.submit(form()); });
    expect(state.fetch).toHaveBeenCalledOnce(); expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled(); expect(screen.getByRole("combobox", { name: "Request type" })).toBeDisabled(); expect(screen.getByRole("combobox", { name: /frequency/i })).toBeDisabled(); expect(screen.getByLabelText("How many visits")).toBeDisabled();
    expect(payload()).toMatchObject({ recurrenceIntervalDays: 30, totalOccurrences: 9 }); expect(state.refresh).not.toHaveBeenCalled();
    await act(async () => resolve(ok())); expect(state.refresh).toHaveBeenCalledOnce();
  });
  it("resets successful optional creation to visible defaults that produce the next coherent payload", async () => {
    render(<HoaManagerWorkspace dashboard={dashboard()} />); frequency("Monthly (every 30 days)"); change("How many visits", "10"); kind("optional_group"); fillBase(); change("Enrollment deadline", "2027-01-25T12:00");
    await submit(); await waitFor(() => expect(state.refresh).toHaveBeenCalledOnce());
    expect(screen.getByRole("combobox", { name: "Request type" })).toHaveValue("compulsory_recurring"); expect(screen.getByRole("combobox", { name: /frequency/i })).toHaveDisplayValue("Weekly"); expect(screen.getByLabelText("How many visits")).toHaveValue(null); expect(screen.getByLabelText("Request title")).toHaveValue("");
    fill(); change("How many visits", "2"); await submit(2);
    expect(payload(1)).toMatchObject({ kind: "compulsory_recurring", recurrenceLabel: "Weekly", recurrenceIntervalDays: 7, totalOccurrences: 2, enrollmentClosesAt: null, minHomes: null }); expect(hoaRequestCreateSchema.safeParse(payload(1)).success).toBe(true);
  });
});
