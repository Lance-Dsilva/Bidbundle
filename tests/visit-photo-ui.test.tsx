// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VisitPhotoPanel } from "@/components/hoa/VisitPhotoPanel";
import { CategoryVisitProofPolicyPanel } from "@/components/admin/CategoryVisitProofPolicyPanel";
import { ResidentVisitCard } from "@/components/hoa/ResidentHoaWorkspace";
import { RequestCompletionGallery } from "@/components/hoa/HoaManagerWorkspace";
import { NeighbourhoodWorkspace } from "@/components/homeowner/NeighbourhoodWorkspace";
import ProviderSchedulePage from "@/app/app/provider/schedule/page";
import type { AgreementSummary, OccurrenceSummary, ProviderHoaWorkspace, VisitPhotoRef, VisitSummary } from "@/lib/hoa-types";
import type { NeighborhoodHub, NeighborhoodRequestView } from "@/lib/neighborhood-types";

const state = vi.hoisted(() => ({ workspace: null as ProviderHoaWorkspace | null, hub: null as NeighborhoodHub | null, refresh: vi.fn(), setError: vi.fn(), api: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: state.refresh }) }));
vi.mock("@/hooks/useProviderMarketplace", () => ({ useProviderMarketplace: () => ({ workspace: state.workspace, loading: false, error: null, refresh: state.refresh }) }));
vi.mock("@/hooks/useNeighbourhood", () => ({ useNeighbourhood: () => ({ hub: state.hub, loading: false, busy: false, error: null, missingAddresses: null, act: vi.fn(), refresh: state.refresh, setError: state.setError, ownerError: null, ownerSuccess: null, clearOwnerFeedback: vi.fn(), addressRequiredRequestId: null, resumeJoin: vi.fn(), cancelAddress: vi.fn() }) }));
vi.mock("@/lib/api", () => ({ apiFetch: (...args: unknown[]) => state.api(...args) }));
const fetchMock = vi.fn();
const NativeFormData = globalThis.FormData;
function photo(overrides: Partial<VisitPhotoRef> = {}): VisitPhotoRef {
  return { id: "proof-1", purpose: "visit_after", src: "/api/visit-photos/proof-1", createdAt: "2026-11-10T12:00:00.000Z", marketingConsented: false, canConsent: true, ...overrides };
}
function visit(overrides: Partial<VisitSummary> = {}): VisitSummary {
  return { id: "visit-1", occurrenceId: "occurrence-1", targetKind: "unit", unitId: "unit-1", homeownerUserId: null, stopLabel: "Home 12", latitude: null, longitude: null, addressLine1: "12 Example Street", accessNotes: null, stopRank: 1, scheduledDate: "2026-11-10T00:00:00.000Z", windowStart: "09:00", windowEnd: "11:00", estimatedMinutes: 30, status: "completed", completionNote: null, completedAt: "2026-11-10T12:00:00.000Z", photos: [], requiresAfterPhoto: true, canReview: true, viewerReview: null, ...overrides };
}
function occurrence(visits: VisitSummary[]): OccurrenceSummary {
  return { id: "occurrence-1", agreementId: "agreement-1", sequence: 1, serviceDate: "2026-11-10T00:00:00.000Z", status: "planned", schedulePublishedAt: "2026-11-09T12:00:00Z", visits };
}
function agreement(): AgreementSummary {
  return { id: "agreement-1", requestId: "request-1", requestTitle: "Pool care", communityId: "community-1", communityName: "Example community", providerUserId: "provider-1", providerName: "Example Provider", providerCompany: null, amountCents: 10000, currency: "USD", pricingBasis: "total", perHomeCents: null, scope: "Pool care", cadenceLabel: null, lockedHomeCount: 1, startDate: null, endDate: null, status: "active", createdAt: "2026-11-01T00:00:00Z" };
}
function provider(visits: VisitSummary[]): ProviderHoaWorkspace {
  return { eligible: true, ineligibleReason: null, serviceAreas: [], categories: [], feed: [], bids: [], agreements: [agreement()], occurrencesByAgreement: { "agreement-1": [occurrence(visits)] } };
}
function neighborhood(ownVisit: VisitSummary): NeighborhoodHub {
  const request: NeighborhoodRequestView = { id: "request-1", communityId: "community-1", communityName: "Example community", title: "Pool care", category: "pool_care", categoryLabel: "Pool care", description: "Example request", status: "awarded", budgetMinCents: null, budgetMaxCents: null, minHomes: 1, maxHomes: null, enrollmentClosesAt: null, biddingClosesAt: null, participantsLockedAt: "2026-11-01T00:00:00Z", awardedAt: "2026-11-01T00:00:00Z", startDate: null, totalOccurrences: 1, joinedCount: 2, declinedCount: 0, bidCount: 1, viewerResponse: "joined", isOwner: false, createdByName: "Example Neighbor", createdAt: "2026-11-01T00:00:00Z", permissions: { canRespond: false, canManage: false, canViewBids: true, canEdit: false }, bids: [], participants: null, agreement: agreement(), myVisits: [ownVisit], occurrences: [occurrence([visit({ id: "other-home", stopLabel: "Other home", photos: [photo({ id: "other-proof", src: "/api/visit-photos/other-proof" })] })])] };
  return { communityId: "community-1", communityName: "Example community", isManager: false, managerName: "Example Manager", activeNeighbourCount: 2, addressReady: true, requests: [request] };
}

beforeEach(() => {
  vi.clearAllMocks(); state.workspace = null; state.hub = null;
  state.refresh.mockResolvedValue({ ok: true }); state.api.mockResolvedValue({});
  vi.stubGlobal("fetch", fetchMock); fetchMock.mockResolvedValue(Response.json({}));
  vi.stubGlobal("FormData", class extends NativeFormData {
    constructor(form?: HTMLFormElement) { super(form); const file = form?.querySelector<HTMLInputElement>('input[type="file"]')?.files?.[0]; if (file) this.set("file", file); }
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("private visit photo upload", () => {
  it("sends the exact visit, purpose and file once, then refreshes canonical completion eligibility", async () => {
    let finish!: (value: Response) => void;
    fetchMock.mockReturnValue(new Promise<Response>((resolve) => { finish = resolve; }));
    const updated = vi.fn().mockResolvedValue({ ok: true }); const busy = vi.fn();
    render(<VisitPhotoPanel visitId="visit-1" photos={[]} canUpload requiresAfterPhoto onUpdated={updated} onBusyChange={busy} />);
    const input = screen.getByLabelText("Take or choose an after photo");
    expect(input).toHaveAttribute("capture", "environment"); expect(input).toHaveAttribute("accept", "image/jpeg,image/png,image/webp");
    fireEvent.change(input, { target: { files: [new File(["synthetic fixture"], "after.png", { type: "image/png" })] } });
    fireEvent.submit(input.closest("form")!); fireEvent.submit(input.closest("form")!);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/provider/marketplace/visits/visit-1/photos"); expect(options.method).toBe("POST"); expect(options.credentials).toBe("same-origin");
    expect([...options.body.keys()].sort()).toEqual(["file", "purpose"]); expect(options.body.get("purpose")).toBe("visit_after");
    expect(input).toBeDisabled();
    await act(async () => { finish(Response.json({ photo: photo() }, { status: 201 })); });
    expect(await screen.findByText(/Photo saved privately/)).toBeInTheDocument(); expect(updated).toHaveBeenCalledOnce(); expect(busy.mock.calls).toEqual([[true], [false]]);
    expect(screen.getByRole("img")).toHaveAttribute("src", "/api/visit-photos/proof-1"); expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
  it("rejects oversize photos before sending a request", async () => {
    render(<VisitPhotoPanel visitId="visit-1" photos={[]} canUpload />);
    const input = screen.getByLabelText("Take or choose a before photo");
    fireEvent.change(input, { target: { files: [new File([new Uint8Array(4 * 1024 * 1024 + 1)], "before.png")] } });
    fireEvent.submit(input.closest("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("4 MiB"); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("preserves a confirmed upload when refresh fails and does not ask for a duplicate", async () => {
    fetchMock.mockResolvedValue(Response.json({ photo: photo() }));
    render(<VisitPhotoPanel visitId="visit-1" photos={[]} canUpload onUpdated={vi.fn().mockResolvedValue({ ok: false })} />);
    const input = screen.getByLabelText("Take or choose an after photo"); fireEvent.change(input, { target: { files: [new File(["x"], "after.png")] } }); fireEvent.submit(input.closest("form")!);
    expect(await screen.findByText(/Photo saved, but the visit could not be refreshed/)).toHaveTextContent("do not upload the same photo again"); expect(screen.getByRole("img")).toBeInTheDocument();
  });
  it("shows unavailable storage errors without inventing a saved photo", async () => {
    fetchMock.mockResolvedValue(Response.json({ error: "Private visit-photo storage is not configured." }, { status: 503 }));
    render(<VisitPhotoPanel visitId="visit-1" photos={[]} canUpload />);
    const input = screen.getByLabelText("Take or choose an after photo"); fireEvent.change(input, { target: { files: [new File(["x"], "after.png")] } }); fireEvent.submit(input.closest("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("not configured"); expect(screen.queryByRole("img")).not.toBeInTheDocument(); expect(input).toBeEnabled();
  });
});

describe("per-photo resident marketing permission", () => {
  it("waits for an exact-photo grant and allows its withdrawal without publishing", async () => {
    let finish!: (value: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>((resolve) => { finish = resolve; }));
    fetchMock.mockResolvedValueOnce(Response.json({ photo: photo({ marketingConsented: false }) }));
    render(<VisitPhotoPanel visitId="visit-1" photos={[photo()]} canConsent />);
    const consent = screen.getByRole("checkbox", { name: /Allow future marketing use/ });
    expect(consent).not.toBeChecked(); fireEvent.click(consent);
    expect(consent).not.toBeChecked(); expect(consent).toBeDisabled();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/hoa/visits/visit-1/photos/proof-1/consent"); expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ consent: true });
    await act(async () => { finish(Response.json({ photo: photo({ marketingConsented: true }) })); });
    expect(consent).toBeChecked(); expect(await screen.findByRole("status")).toHaveTextContent("remains private and has not been published");
    fireEvent.click(consent); await waitFor(() => expect(consent).not.toBeChecked());
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ consent: false }); expect(screen.getByRole("status")).toHaveTextContent("withdrawn");
  });
  it("does not expose consent authority to provider/manager or photos without explicit permission", () => {
    const { rerender } = render(<VisitPhotoPanel visitId="visit-1" photos={[photo()]} />);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    rerender(<VisitPhotoPanel visitId="visit-1" photos={[photo({ canConsent: undefined })]} canConsent />);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument(); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("keeps failed permission unchecked and excludes external public images", async () => {
    fetchMock.mockResolvedValue(Response.json({ error: "Permission denied" }, { status: 403 }));
    render(<VisitPhotoPanel visitId="visit-1" photos={[photo({ src: "https://example.invalid/public.png" })]} canConsent />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument(); fireEvent.click(screen.getByRole("checkbox"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Permission denied"); expect(screen.getByRole("checkbox")).not.toBeChecked();
  });
});

describe("resident reviews and manager completion evidence", () => {
  it("requires an explicit 1–5 rating and permits an empty comment", () => {
    const review = vi.fn(); render(<ResidentVisitCard visit={visit({ photos: [photo()] })} busy={null} onReview={review} />);
    fireEvent.click(screen.getByRole("button", { name: "Review this visit" })); const form = screen.getByRole("button", { name: "Submit review" }).closest("form")!;
    fireEvent.submit(form); expect(review).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Rating"), { target: { value: "4" } }); fireEvent.submit(form);
    expect(review).toHaveBeenCalledWith(4, ""); expect(screen.getByLabelText("Review comment (optional)")).not.toBeRequired();
  });
  it("shows a persisted own rating and does not offer a duplicate review", () => {
    render(<ResidentVisitCard visit={visit({ viewerReview: { rating: 5, comment: "", createdAt: "2026-11-10T14:00:00Z" } })} busy={null} onReview={vi.fn()} />);
    expect(screen.getByText("Your rating: 5/5")).toBeInTheDocument(); expect(screen.queryByRole("button", { name: "Review this visit" })).not.toBeInTheDocument();
  });
  it("does not offer a review without server-provided permission", () => {
    render(<ResidentVisitCard visit={visit({ canReview: false })} busy={null} onReview={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Review this visit" })).not.toBeInTheDocument();
  });
  it("shows only completed photo evidence and the supplied published request average", () => {
    render(<RequestCompletionGallery requestTitle="Pool care" occurrences={[occurrence([visit({ photos: [photo()] }), visit({ id: "not-done", status: "in_progress", photos: [photo({ id: "pending-photo", src: "/api/visit-photos/pending-photo" })] })])]} reviewAverage={4.5} reviewCount={2} />);
    expect(screen.getByText("4.5/5 from 2 published ratings")).toBeInTheDocument(); expect(screen.getAllByRole("img", { hidden: true })).toHaveLength(1);
    expect(screen.getByRole("img", { hidden: true })).toHaveAttribute("src", "/api/visit-photos/proof-1"); expect(screen.queryByRole("checkbox", { hidden: true })).not.toBeInTheDocument(); expect(screen.getByText(/does not grant permission to publish/)).toBeInTheDocument();
  });
  it("does not fabricate an average when no published reviews exist", () => {
    render(<RequestCompletionGallery requestTitle="Pool care" occurrences={[]} reviewAverage={null} reviewCount={0} />);
    expect(screen.getByText("No published ratings for this request yet.")).toBeInTheDocument();
  });
  it("uses only viewer-owned neighbourhood visits and submits to the real review endpoint", async () => {
    state.hub = neighborhood(visit({ photos: [photo()] })); render(<NeighbourhoodWorkspace />);
    expect(screen.getAllByRole("img")).toHaveLength(1); expect(screen.getByRole("img")).toHaveAttribute("src", "/api/visit-photos/proof-1");
    expect(screen.queryByText("Other home")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Review this visit" })); fireEvent.change(screen.getByLabelText("Rating"), { target: { value: "5" } }); fireEvent.submit(screen.getByRole("button", { name: "Submit review" }).closest("form")!);
    await waitFor(() => expect(state.refresh).toHaveBeenCalledOnce()); expect(fetchMock.mock.calls[0][0]).toBe("/api/hoa/visits/visit-1/review"); expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ rating: 5, comment: "" });
  });
});

describe("provider proof completion gate", () => {
  it("blocks completion until the canonical required after photo is present", () => {
    state.workspace = provider([visit({ status: "in_progress", photos: [] })]); const { rerender } = render(<ProviderSchedulePage />);
    expect(screen.getByRole("button", { name: "completed" })).toBeDisabled(); expect(screen.getByText(/At least one after photo is required/)).toBeInTheDocument();
    state.workspace = provider([visit({ status: "in_progress", photos: [photo()] })]); rerender(<ProviderSchedulePage />);
    expect(screen.getByRole("button", { name: "completed" })).toBeEnabled();
  });
  it("permits grandfathered completion, while unscheduled visits require publishing before uploads", () => {
    state.workspace = provider([visit({ status: "scheduled", requiresAfterPhoto: false })]); const { rerender } = render(<ProviderSchedulePage />);
    expect(screen.getByRole("button", { name: "completed" })).toBeEnabled();
    state.workspace = provider([visit({ status: "unscheduled", requiresAfterPhoto: true })]); rerender(<ProviderSchedulePage />);
    expect(screen.queryByRole("button", { name: /Upload after photo/ })).not.toBeInTheDocument(); expect(screen.getByText("Publish the day plan before uploading visit photos.")).toBeInTheDocument(); expect(state.api).not.toHaveBeenCalled();
  });
});

describe("global future-request photo policy", () => {
  it("loads actual category defaults and saves only the selected requirement once", async () => {
    const policies = { policies: [{ category: "pool_care", requiresAfterPhoto: true }, { category: "cleaning", requiresAfterPhoto: false }] };
    let finish!: (value: Response) => void; const pending = new Promise<Response>((resolve) => { finish = resolve; });
    fetchMock.mockImplementation(async (_url, options) => options?.method === "PATCH" ? pending : Response.json(policies));
    render(<CategoryVisitProofPolicyPanel />); const category = screen.getByLabelText("Service category"); await waitFor(() => expect(category).toBeEnabled());
    expect(screen.getByText(/Global category defaults for all communities/)).toHaveTextContent("existing requests and visits keep their saved requirements");
    expect(within(category).getAllByRole("option")).toHaveLength(2); fireEvent.change(category, { target: { value: "cleaning" } }); fireEvent.click(screen.getByRole("checkbox"));
    const form = category.closest("form")!; fireEvent.submit(form); fireEvent.submit(form);
    const patches = fetchMock.mock.calls.filter(([, options]) => options?.method === "PATCH"); expect(patches).toHaveLength(1); expect(patches[0][0]).toBe("/api/admin/visit-proof-policy"); expect(JSON.parse(patches[0][1].body)).toEqual({ category: "cleaning", requiresAfterPhoto: true });
    await act(async () => { finish(Response.json({})); }); expect(await screen.findByText(/Category requirement saved for future requests/)).toBeInTheDocument();
  });
  it("hides the policy editor when the actor is not authorized", async () => {
    fetchMock.mockResolvedValue(Response.json({ error: "Forbidden" }, { status: 403 })); const { container } = render(<CategoryVisitProofPolicyPanel />);
    await waitFor(() => expect(container).toBeEmptyDOMElement()); expect(fetchMock.mock.calls.filter(([, options]) => options?.method === "PATCH")).toHaveLength(0);
  });
});
