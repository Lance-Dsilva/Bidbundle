import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ gate: true, refresh: vi.fn(), start: vi.fn(), retry: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/server/stripe-test-payment-recovery", () => ({
  getStripeTestPaymentRecovery: m.refresh, startStripeTestPaymentRecovery: m.start, retryStripeTestPayment: m.retry,
}));
vi.mock("@/lib/server/hoa-api", () => ({
  requireHoaMutation: async () => m.gate ? { ok: true, user: { id: "authenticated-payer" } } : { ok: false, response: new Response("unauthorized", { status: 401 }) },
  readHoaBody: async (request: Request) => ({ ok: true, value: await request.json() }),
  validationErrorResponse: () => new Response("invalid body", { status: 400 }),
  hoaErrorResponse: m.error,
}));
import { POST } from "@/app/api/hoa/payments/[visitId]/recovery/route";
const attemptId = "a48b32ca-e60f-4b35-b721-902cab981876";
const context = { params: Promise.resolve({ visitId: "owned-visit" }) };
const request = (body: unknown) => new Request("https://bundleen.test/api/hoa/payments/owned-visit/recovery", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => {
  vi.resetAllMocks(); m.gate = true;
  m.refresh.mockResolvedValue({ status: "requires_action", clientSecret: "fixture-secret" });
  m.start.mockResolvedValue({ clientSecret: "fixture-setup-secret" });
  m.retry.mockResolvedValue({ status: "succeeded" });
  m.error.mockImplementation((_scope, error) => Response.json({ error: error.message }, { status: error.status }));
});
it("requires authentication before recovery processing", async () => {
  m.gate = false;
  expect((await POST(request({ action: "retry", attemptId, setupIntentId: "seti_owned", accepted: true }), context)).status).toBe(401);
  expect(m.retry).not.toHaveBeenCalled();
});
it.each([
  { action: "start", attemptId }, { action: "start", attemptId, accepted: false },
  { action: "retry", attemptId, setupIntentId: "seti_owned" },
  { action: "retry", attemptId, setupIntentId: "seti_owned", accepted: false },
  { action: "retry", attemptId: "not-a-uuid", setupIntentId: "seti_owned", accepted: true },
  { action: "retry", attemptId, setupIntentId: "pi_not_setup", accepted: true },
  { action: "retry", attemptId, setupIntentId: "seti_owned", accepted: true, userId: "attacker" },
  { action: "start", attemptId, accepted: true, amountCents: 1 },
])("rejects missing consent or client-injected recovery data %j", async body => {
  expect((await POST(request(body), context)).status).toBe(400);
  expect(m.start).not.toHaveBeenCalled(); expect(m.retry).not.toHaveBeenCalled();
});
it("uses authenticated identity and URL visit for card setup", async () => {
  const response = await POST(request({ action: "start", attemptId, accepted: true }), context);
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(m.start).toHaveBeenCalledExactlyOnceWith("authenticated-payer", "owned-visit", attemptId);
});
it("forwards verified retry identifiers only after explicit consent", async () => {
  const response = await POST(request({ action: "retry", attemptId, setupIntentId: "seti_owned", accepted: true }), context);
  expect(response.status).toBe(200);
  expect(m.retry).toHaveBeenCalledExactlyOnceWith("authenticated-payer", "owned-visit", attemptId, "seti_owned");
});
it("returns owned action status without cacheability", async () => {
  const response = await POST(request({ action: "refresh" }), context);
  expect(m.refresh).toHaveBeenCalledExactlyOnceWith("authenticated-payer", "owned-visit");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});
it("sanitizes raw processor failure details before the API reporter", async () => {
  m.retry.mockRejectedValue(new Error("processor error includes secret_fixture and customer_fixture"));
  const response = await POST(request({ action: "retry", attemptId, setupIntentId: "seti_owned", accepted: true }), context);
  expect(response.status).toBe(503);
  expect(await response.text()).not.toMatch(/secret_fixture|customer_fixture/);
  expect(m.error.mock.calls[0][1].message).not.toMatch(/secret_fixture|customer_fixture/);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});
