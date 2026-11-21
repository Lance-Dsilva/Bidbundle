import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ gate: true, start: vi.fn(), join: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/server/enrollment-billing", () => ({ startEnrollmentBilling: m.start, confirmEnrollmentBilling: m.join }));
vi.mock("@/lib/server/hoa-api", () => ({ requireHoaMutation: async () => m.gate ? { ok: true, user: { id: "payer" } } : { ok: false, response: new Response("unauthorized", { status: 401 }) },
 readHoaBody: async (request: Request) => ({ ok: true, value: await request.json() }), validationErrorResponse: () => new Response("invalid", { status: 400 }), hoaErrorResponse: m.error }));
import { POST } from "@/app/api/hoa/requests/[requestId]/enrollment/route";
const consentId = "a48b32ca-e60f-4b35-b721-902cab981876", termsToken = "a".repeat(64);
const context = { params: Promise.resolve({ requestId: "request" }) };
const request = (body: unknown) => new Request("https://example.invalid", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => { vi.resetAllMocks(); m.gate = true; m.start.mockResolvedValue({ clientSecret: "secret" }); m.join.mockResolvedValue({ joined: true }); m.error.mockImplementation((_scope, error) => Response.json({ error: error.message }, { status: error.status })); });
it("authenticates before creating a setup intent", async () => { m.gate = false; expect((await POST(request({ action: "start", consentId, termsToken, accepted: true }), context)).status).toBe(401); expect(m.start).not.toHaveBeenCalled(); });
it.each([
 { action: "start", consentId, termsToken }, { action: "start", consentId, termsToken, accepted: false },
 { action: "start", consentId, termsToken, accepted: true, maximumCents: 1 },
 { action: "join", consentId, setupIntentId: "pi_wrong" }, { action: "join", consentId, setupIntentId: "seti_valid", userId: "other" },
])("rejects missing consent or injected identity/pricing %j", async body => { expect((await POST(request(body), context)).status).toBe(400); expect(m.start).not.toHaveBeenCalled(); expect(m.join).not.toHaveBeenCalled(); });
it("binds setup to authenticated payer and explicit terms with no-store response", async () => {
 const response = await POST(request({ action: "start", consentId, termsToken, accepted: true }), context);
 expect(m.start).toHaveBeenCalledWith("payer", "request", consentId, termsToken); expect(response.headers.get("Cache-Control")).toBe("private, no-store");
});
it("forwards only verified setup identifiers to atomic enrollment", async () => { await POST(request({ action: "join", consentId, setupIntentId: "seti_valid" }), context); expect(m.join).toHaveBeenCalledWith("payer", "request", consentId, "seti_valid"); });
it("sanitizes processor failures", async () => { m.start.mockRejectedValue(new Error("processor secret")); const response = await POST(request({ action: "start", consentId, termsToken, accepted: true }), context); expect(response.status).toBe(503); expect(await response.text()).not.toContain("processor secret"); });
