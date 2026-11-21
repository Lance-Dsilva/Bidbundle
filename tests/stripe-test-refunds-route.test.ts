import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ gate: true, reserve: vi.fn(), retry: vi.fn(), find: vi.fn() }));
vi.mock("@/lib/server/stripe-test-refunds", () => ({ requestStripeTestRefund: m.reserve, retryStripeTestRefund: m.retry }));
vi.mock("@/lib/server/db", () => ({ db: { stripeTestRefund: { findFirst: m.find } } }));
vi.mock("@/lib/server/hoa", () => ({ HoaWorkflowError: class extends Error { constructor(message: string, public status: number) { super(message); } } }));
vi.mock("@/lib/server/admin-api", () => ({
  requireAdminOwnerMutation: async () => m.gate ? { ok: true, user: { id: "owner" } } : { ok: false, response: new Response("denied", { status: 403 }) },
  readAdminBody: async (request: Request) => ({ ok: true, value: await request.json() }),
  validationErrorResponse: () => new Response("invalid", { status: 400 }),
}));
import { POST } from "@/app/api/admin/payments/[visitId]/refunds/route";
import { HoaWorkflowError } from "@/lib/server/hoa";
const id = "a48b32ca-e60f-4b35-b721-902cab981876";
const payload = { action: "request", id, amountCents: 100, reason: "service_quality", confirmed: true };
const call = (body: unknown) => POST(new Request("https://bundleen.test/api/admin/payments/visit/refunds", { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ visitId: "visit" }) });
beforeEach(() => { vi.resetAllMocks(); m.gate = true; m.find.mockResolvedValue({ id, state: "succeeded", amountCents: 100, reversalCents: 90 }); });
it("rejects non-owner before reserving or processing", async () => { m.gate = false; expect((await call(payload)).status).toBe(403); expect(m.reserve).not.toHaveBeenCalled(); expect(m.retry).not.toHaveBeenCalled(); });
it.each([{ ...payload, confirmed: false }, { ...payload, amountCents: -1 }, { ...payload, amountCents: 1.5 }, { ...payload, actorUserId: "other" }, { ...payload, reason: "anything" }, { action: "retry", id: "bad" }])("rejects invalid and injected fields %j", async body => { expect((await call(body)).status).toBe(400); expect(m.reserve).not.toHaveBeenCalled(); expect(m.retry).not.toHaveBeenCalled(); });
it("reserves using authenticated owner and URL visit and returns no-store status", async () => {
  const result = await call(payload); expect(result.status).toBe(200); expect(result.headers.get("cache-control")).toBe("private, no-store");
  expect(m.reserve).toHaveBeenCalledWith("owner", "visit", payload); expect(m.retry).toHaveBeenCalledWith("owner", "visit", id);
});
it("retries an existing operation without reserving another", async () => { await call({ action: "retry", id }); expect(m.reserve).not.toHaveBeenCalled(); expect(m.retry).toHaveBeenCalledWith("owner", "visit", id); });
it("preserves a saved operation after processor uncertainty without exposing raw errors", async () => {
  m.retry.mockRejectedValue(new Error("secret processor customer details")); m.find.mockResolvedValue({ id, state: "pending", amountCents: 100, reversalCents: 90 });
  const result = await call(payload); expect(result.status).toBe(202); const body = await result.json(); expect(body.id).toBe(id); expect(body.message).toContain("do not create another"); expect(JSON.stringify(body)).not.toMatch(/secret processor/);
});
it.each([403, 404, 503])("preserves security and disabled-feature rejection %s", async status => { m.retry.mockRejectedValue(new HoaWorkflowError("Unavailable", status)); expect((await call({ action: "retry", id })).status).toBe(status); expect(m.find).not.toHaveBeenCalled(); });
it("does not claim asynchronous refunds are complete", async () => { m.find.mockResolvedValue({ id, state: "reversal_pending", amountCents: 100, reversalCents: 90 }); expect((await call(payload)).status).toBe(202); });
