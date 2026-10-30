import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ authorize: vi.fn(), guard: vi.fn(), mutate: vi.fn(), read: vi.fn() }));
vi.mock("@/lib/server/auth", () => ({ authorizeRequest: state.authorize }));
vi.mock("@/lib/server/auth-guard", async (original) => ({ ...await original<typeof import("@/lib/server/auth-guard")>(), guardHoaMutation: state.guard }));
vi.mock("@/lib/server/neighborhood-market", () => ({ mutateOwnedNeighborhoodRequest: state.mutate, getNeighborhoodRequest: state.read }));
import { PATCH } from "@/app/api/homeowner/requests/[requestId]/route";
import { MAX_HOA_BODY_BYTES } from "@/lib/validation/hoa";
import { HoaWorkflowError } from "@/lib/server/hoa";
const input = { action: "edit", title: "  Wash\r\nour driveways  ", category: "cleaning", description: "  Whole driveway\u0001. ", budgetMinCents: 10000, budgetMaxCents: 25000 };
const normalized = { ...input, title: "Wash\nour driveways", description: "Whole driveway." };
const context = { params: Promise.resolve({ requestId: "request-from-path" }) };
function req(value: unknown, headers: Record<string, string> = {}) { return new Request("https://bundleen.test/api/homeowner/requests/request-from-path", { method: "PATCH", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(value) }); }
beforeEach(() => {
  state.authorize.mockReset().mockResolvedValue({ ok: true, user: { id: "verified-owner", role: "homeowner" } }); state.guard.mockReset().mockResolvedValue(null);
  state.mutate.mockReset().mockResolvedValue(undefined); state.read.mockReset().mockResolvedValue({ id: "request-from-path", title: "Persisted title" });
});
describe("owner request PATCH boundary", () => {
  it("normalizes parsed edit fields, derives actor/path, then returns canonical scoped request", async () => {
    const response = await PATCH(req(input), context); expect(response.status).toBe(200);
    expect(state.mutate).toHaveBeenCalledWith("verified-owner", "request-from-path", normalized);
    expect(state.read).toHaveBeenCalledWith("verified-owner", "request-from-path"); expect(await response.json()).toEqual({ request: { id: "request-from-path", title: "Persisted title" } });
  });
  it("accepts only action cancel for cancellation", async () => {
    expect((await PATCH(req({ action: "cancel" }), context)).status).toBe(200);
    expect(state.mutate).toHaveBeenCalledWith("verified-owner", "request-from-path", { action: "cancel" });
  });
  it.each([401, 403])("preserves %s authentication/authority failure before reading/mutating", async (status) => {
    state.authorize.mockResolvedValue({ ok: false, response: new Response("refused", { status }) });
    expect((await PATCH(req(input), context)).status).toBe(status); expect(state.guard).not.toHaveBeenCalled(); expect(state.mutate).not.toHaveBeenCalled(); expect(state.read).not.toHaveBeenCalled();
  });
  it.each([{ kind: "rate-limited", retryAfterSeconds: 31, status: 429 }, { kind: "unavailable", status: 503 }])("retains mutation fail-closed limiter %s", async ({ status, ...failure }) => {
    state.guard.mockResolvedValue(failure); const response = await PATCH(req(input), context); expect(response.status).toBe(status); expect(state.mutate).not.toHaveBeenCalled();
    if (status === 429) expect(response.headers.get("Retry-After")).toBe("31");
  });
  it.each([
    { ...input, ownerId: "other" }, { ...input, communityId: "other" }, { ...input, status: "open_for_bids" },
    { action: "cancel", title: "mutate too" }, { action: "open_bidding" }, { ...input, budgetMinCents: -1 },
    { ...input, budgetMaxCents: 1000 }, { ...input, budgetMaxCents: 100.5 }, { ...input, category: "not-supported" },
    { ...input, title: " " }, { ...input, description: " " }, { ...input, budgetMinCents: null },
  ])("rejects strict shape and invalid field values: %j", async (value) => {
    expect((await PATCH(req(value), context)).status).toBe(400); expect(state.mutate).not.toHaveBeenCalled(); expect(state.read).not.toHaveBeenCalled();
  });
  it("accepts a historical absent budget pair without defaulting to zero", async () => {
    expect((await PATCH(req({ ...input, budgetMinCents: null, budgetMaxCents: null }), context)).status).toBe(200);
    expect(state.mutate.mock.calls[0][2]).toMatchObject({ budgetMinCents: null, budgetMaxCents: null });
  });
  it.each([
    { body: "{", contentType: "application/json", status: 400 },
    { body: "{}", contentType: "text/plain", status: 415 },
    { body: JSON.stringify({ extra: "x".repeat(MAX_HOA_BODY_BYTES + 1) }), contentType: "application/json", status: 413 },
  ])("preserves JSON content/type/body limits: $status", async ({ body, contentType, status }) => {
    const request = new Request("https://bundleen.test/api/homeowner/requests/request-from-path", { method: "PATCH", headers: { "Content-Type": contentType }, body });
    expect((await PATCH(request, context)).status).toBe(status); expect(state.mutate).not.toHaveBeenCalled();
  });
  it("returns domain conflict without reporting a stale canonical success", async () => {
    state.mutate.mockRejectedValue(new HoaWorkflowError("Bidding already opened.", 409));
    const response = await PATCH(req(input), context); expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: "Bidding already opened." }); expect(state.read).not.toHaveBeenCalled();
  });
});
