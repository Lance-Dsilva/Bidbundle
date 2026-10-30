import { beforeEach, describe, expect, it, vi } from "vitest";
import { HomeAddressRequiredError } from "@/lib/server/home-address";
const state = vi.hoisted(() => ({ authorize: vi.fn(), guard: vi.fn(), respond: vi.fn() }));
vi.mock("@/lib/server/db", () => ({ db: {} }));
vi.mock("@/lib/server/auth", () => ({ authorizeRequest: state.authorize }));
vi.mock("@/lib/server/auth-guard", () => ({ guardHoaMutation: state.guard, guardFailureResponse: () => new Response("limited", { status: 429 }) }));
vi.mock("@/lib/server/neighborhood-market", () => ({ respondToNeighborhoodRequest: state.respond }));
vi.mock("@/lib/server/hoa-market", () => ({ MissingParticipantAddressError: class extends Error {} }));
import { POST } from "@/app/api/homeowner/requests/[requestId]/participation/route";
function request(body: unknown = { response: "joined" }) { return new Request("https://bundleen.test/api/homeowner/requests/request-1/participation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
const context = { params: Promise.resolve({ requestId: "request-1" }) };
beforeEach(() => {
  state.authorize.mockReset().mockResolvedValue({ ok: true, user: { id: "session-user", role: "homeowner" } });
  state.guard.mockReset().mockResolvedValue(null); state.respond.mockReset().mockRejectedValue(new HomeAddressRequiredError());
});

describe("address-required participation HTTP contract", () => {
  it("returns only a sanitized actionable 409 and uses the session identity", async () => {
    const response = await POST(request(), context);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Add and confirm your home address before joining this request.", code: "HOME_ADDRESS_REQUIRED", addressRequired: true });
    expect(state.respond).toHaveBeenCalledWith("session-user", "request-1", "joined");
    expect(state.guard).toHaveBeenCalledWith("session-user");
  });

  it("rejects unauthenticated access before service/profile validation", async () => {
    state.authorize.mockResolvedValueOnce({ ok: false, response: new Response("unauthorized", { status: 401 }) });
    expect((await POST(request(), context)).status).toBe(401);
    expect(state.respond).not.toHaveBeenCalled(); expect(state.guard).not.toHaveBeenCalled();
  });

  it("preserves rate limits and strict body validation before participating", async () => {
    state.guard.mockResolvedValueOnce({ status: 429 });
    expect((await POST(request(), context)).status).toBe(429);
    expect(state.respond).not.toHaveBeenCalled();
    expect((await POST(request({ response: "joined", userId: "other-user", latitude: 0 }), context)).status).toBe(400);
    expect(state.respond).not.toHaveBeenCalled();
  });
});
