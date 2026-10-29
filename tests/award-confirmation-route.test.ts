import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ award: vi.fn(), gate: true }));
vi.mock("@/lib/server/hoa-market", () => ({ awardBid: state.award }));
vi.mock("@/lib/server/neighborhood-market", () => ({ getNeighborhoodRequest: async () => ({ id: "request" }) }));
vi.mock("@/lib/server/hoa-api", () => ({
  requireHoaMutation: async () => state.gate ? { ok: true, user: { id: "session-manager" } } : { ok: false, response: new Response("unauthorized", { status: 401 }) },
  readHoaBody: async (request: Request) => ({ ok: true, value: await request.json() }),
  validationErrorResponse: () => new Response("invalid body", { status: 400 }),
  hoaErrorResponse: () => new Response("failure", { status: 500 }),
}));
import { POST } from "@/app/api/homeowner/requests/[requestId]/award/route";
import { POST as hoaPOST } from "@/app/api/hoa/requests/[requestId]/award/route";
function request(body: unknown) { return new Request("https://bundleen.test/api/homeowner/requests/request/award", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
const context = { params: Promise.resolve({ requestId: "request" }) };
beforeEach(() => { state.gate = true; state.award.mockReset().mockResolvedValue("agreement"); });
describe.each([["neighborhood", POST, 200], ["HOA", hoaPOST, 201]] as const)("%s award confirmation version route contract", (_label, handler, status) => {
  it("forwards the displayed version and authenticated account through parsed data", async () => {
    const response = await handler(request({ bidId: "bid", expectedBidVersion: 3 }), context);
    expect(response.status).toBe(status); expect(await response.json()).toMatchObject({ agreementId: "agreement" }); expect(state.award).toHaveBeenCalledWith("session-manager", "request", { bidId: "bid", expectedBidVersion: 3 });
  });
  it("rejects invalid versions before calling the domain", async () => {
    expect((await handler(request({ bidId: "bid", expectedBidVersion: 0 }), context)).status).toBe(400); expect(state.award).not.toHaveBeenCalled();
  });
  it("retains authentication before processing a confirmation", async () => {
    state.gate = false; expect((await handler(request({ bidId: "bid", expectedBidVersion: 3 }), context)).status).toBe(401); expect(state.award).not.toHaveBeenCalled();
  });
  it("never takes identity, authority, price, or desired request status from the client", async () => {
    const response = await handler(request({ bidId: "bid", expectedBidVersion: 3, userId: "attacker", canAward: true, amountCents: 1, status: "awarded" }), context);
    expect(response.status).toBe(400);
    expect(state.award).not.toHaveBeenCalled();
  });
});
