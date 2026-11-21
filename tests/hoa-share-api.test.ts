import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ allowed: true, mutation: true, dashboard: vi.fn(), rate: vi.fn(), connect: vi.fn(), refresh: vi.fn(), statement: vi.fn(), manual: vi.fn(), payout: vi.fn(), detail: vi.fn(), csv: vi.fn(), pdf: vi.fn() }));
const gates = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }));
vi.mock("@/lib/server/admin-api", () => ({ requireAdminOwner: gates.read, requireAdminOwnerMutation: gates.write }));
vi.mock("@/lib/server/hoa-api", () => ({ requireHoaUser: gates.read, requireHoaMutation: gates.write,
 readHoaBody: async (request: Request) => ({ ok: true, value: await request.json() }), validationErrorResponse: () => Response.json({ error: "Invalid action" }, { status: 400 }),
 hoaErrorResponse: (_scope: string, error: { message: string; status: number }) => Response.json({ error: error.message }, { status: error.status }) }));
vi.mock("@/lib/server/hoa-revenue-share", () => ({ getHoaShareDashboard: m.dashboard, setHoaShareRate: m.rate, createHoaShareAccountLink: m.connect, refreshHoaShareAccount: m.refresh, createHoaShareStatement: m.statement, markHoaShareStatementPaid: m.manual, payoutHoaShareStatement: m.payout, getHoaShareStatement: m.detail }));
vi.mock("@/lib/server/hoa-share-export", () => ({ hoaShareCsv: m.csv, hoaSharePdf: m.pdf }));
import { hoaShareExportHandler, hoaShareHandlers } from "@/lib/server/hoa-share-api";
const context = { params: Promise.resolve({ communityId: "c1" }) };
const request = (body: unknown) => new Request("https://example.invalid", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => {
 vi.resetAllMocks(); m.allowed = true; m.mutation = true;
 gates.read.mockImplementation(async () => m.allowed ? { ok: true, user: { id: "actor" } } : { ok: false, response: new Response("Denied", { status: 403 }) });
 gates.write.mockImplementation(async () => m.mutation ? gates.read() : { ok: false, response: new Response("Rate limited", { status: 429 }) });
 m.dashboard.mockResolvedValue({ communityId: "c1" }); m.rate.mockResolvedValue({ rateBps: 500 }); m.manual.mockResolvedValue({ status: "paid" }); m.payout.mockResolvedValue({ status: "paid" }); m.connect.mockResolvedValue({ url: "https://connect.stripe.com/setup" });
 m.detail.mockResolvedValue({ periodStart: "2026-10-01", id: "s1" }); m.csv.mockReturnValue("safe CSV");
});
it("authenticates and rate-limits before touching financial operations", async () => {
 m.allowed = false; expect((await hoaShareHandlers(true).GET(new Request("https://example.invalid"), context)).status).toBe(403); expect(m.dashboard).not.toHaveBeenCalled();
 m.allowed = true; m.mutation = false; expect((await hoaShareHandlers(true).POST(request({ action: "payout", statementId: "s1" }), context)).status).toBe(429); expect(m.payout).not.toHaveBeenCalled();
});
it.each([{ action: "rate", rateBps: 500 }, { action: "statement", period: "2026-10" }, { action: "manual", statementId: "s1", reference: "check" }, { action: "payout", statementId: "s1" }])("manager route rejects owner operation %j", async body => {
 expect((await hoaShareHandlers(false).POST(request(body), context)).status).toBe(403); expect(m.manual).not.toHaveBeenCalled(); expect(m.payout).not.toHaveBeenCalled(); expect(m.rate).not.toHaveBeenCalled();
});
it.each([{ action: "rate", rateBps: 1001 }, { action: "rate", rateBps: 2.5 }, { action: "payout", statementId: "s1", amountCents: 1 }, { action: "manual", statementId: "s1", reference: " " }, { action: "statement", period: "2026-13" }, { action: "connect", accountId: "foreign" }])("rejects injected identity/amount and invalid values %j", async body => {
 expect((await hoaShareHandlers(true).POST(request(body), context)).status).toBe(400); expect(m.payout).not.toHaveBeenCalled(); expect(m.connect).not.toHaveBeenCalled();
});
it("binds manual payment to authenticated actor, route community and exact reference", async () => {
 const result = await hoaShareHandlers(true).POST(request({ action: "manual", statementId: "s1", reference: " check-1 " }), context);
 expect(m.manual).toHaveBeenCalledWith("actor", "c1", "s1", "check-1"); expect(result.headers.get("Cache-Control")).toBe("private, no-store");
});
it("requires domain authorization for export before invoking renderer", async () => {
 m.detail.mockRejectedValue(new Error("private database content")); const result = await hoaShareExportHandler(false)(new Request("https://example.invalid?format=csv"), { params: Promise.resolve({ communityId: "foreign", statementId: "s1" }) });
 expect(result.status).toBe(503); expect(await result.text()).not.toContain("private database"); expect(m.csv).not.toHaveBeenCalled(); expect(m.detail).toHaveBeenCalledWith("actor", "foreign", "s1");
});
it("exports no-store attachments after scoped authorization and rejects unknown format", async () => {
 const handler = hoaShareExportHandler(false), ctx = { params: Promise.resolve({ communityId: "c1", statementId: "s1" }) };
 const result = await handler(new Request("https://example.invalid?format=csv"), ctx); expect(await result.text()).toBe("safe CSV"); expect(result.headers.get("Content-Disposition")).toContain("association-statement-2026-10.csv"); expect(result.headers.get("Cache-Control")).toBe("private, no-store");
 expect((await handler(new Request("https://example.invalid?format=exe"), ctx)).status).toBe(400);
});
