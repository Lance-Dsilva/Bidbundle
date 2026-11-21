import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ authorize: vi.fn(), receipt: vi.fn() }));
vi.mock("@/lib/server/auth", () => ({ authorizeRequest: m.authorize }));
vi.mock("@/lib/server/stripe-test-payment-history", () => ({ getResidentTestReceipt: m.receipt }));
import { GET } from "@/app/api/hoa/payments/[visitId]/receipt/route";
beforeEach(() => {
  vi.resetAllMocks(); m.authorize.mockResolvedValue({ ok: true, user: { id: "payer" } });
  m.receipt.mockResolvedValue("https://pay.stripe.com/receipts/payment/verified");
});
it("redirects only to the verified owned receipt and disables caching/referrer", async () => {
  const response = await GET(new Request("https://bundleen.test/receipt?url=https://evil.invalid"), { params: Promise.resolve({ visitId: "visit" }) });
  expect(m.authorize).toHaveBeenCalledWith(["homeowner"]);
  expect(m.receipt).toHaveBeenCalledExactlyOnceWith("payer", "visit");
  expect(response.status).toBe(303); expect(response.headers.get("location")).toBe("https://pay.stripe.com/receipts/payment/verified");
  expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(response.headers.get("referrer-policy")).toBe("no-referrer");
});
it("denies unauthorized access before receipt lookup and does not cache the denial", async () => {
  m.authorize.mockResolvedValue({ ok: false, response: Response.json({ error: "Unauthorized" }, { status: 401 }) });
  const response = await GET(new Request("https://bundleen.test/receipt"), { params: Promise.resolve({ visitId: "visit" }) });
  expect(response.status).toBe(401); expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(m.receipt).not.toHaveBeenCalled();
});
it("never exposes raw Stripe failure data", async () => {
  m.receipt.mockRejectedValue(new Error("secret_internal_processor_payload"));
  const response = await GET(new Request("https://bundleen.test/receipt"), { params: Promise.resolve({ visitId: "visit" }) });
  expect(response.status).toBe(503); expect(await response.text()).not.toContain("secret_internal_processor_payload");
});
