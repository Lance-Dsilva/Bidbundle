import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  gate: vi.fn(), list: vi.fn(), upsert: vi.fn(), importCsv: vi.fn(), sourcing: vi.fn(), invite: vi.fn(),
  referral: vi.fn(), summary: vi.fn(), claim: vi.fn(), submit: vi.fn(), started: vi.fn(), unsubscribe: vi.fn(), webhook: vi.fn(), requests: vi.fn(),
}));
vi.mock("@/lib/server/admin-api", () => ({ requireAdmin: state.gate, requireAdminMutation: state.gate }));
vi.mock("@/lib/server/hoa-api", () => ({
  requireProviderMutation: state.gate, requireHoaMutation: state.gate,
  hoaErrorResponse: () => Response.json({ error: "Unexpected failure." }, { status: 500 }),
  validationErrorResponse: () => Response.json({ error: "Invalid input." }, { status: 422 }),
}));
vi.mock("@/lib/server/vendor-sourcing", () => ({
  listVendorLeads: state.list, upsertVendorLead: state.upsert, importCslbLeads: state.importCsv,
  listRequestSourcing: state.sourcing, inviteVendorBatch: state.invite, addVendorReferral: state.referral,
  getPublicBidSummary: state.summary, claimVendorInvitation: state.claim, submitInvitedProposal: state.submit,
  markProposalStarted: state.started, unsubscribeVendor: state.unsubscribe, ingestResendWebhook: state.webhook,
  listVendorSourcingRequests: state.requests,
}));
import * as leads from "@/app/api/admin/vendor-leads/route";
import * as lead from "@/app/api/admin/vendor-leads/[leadId]/route";
import * as imports from "@/app/api/admin/vendor-leads/import/route";
import * as sourcing from "@/app/api/admin/requests/[requestId]/vendor-sourcing/route";
import * as referrals from "@/app/api/hoa/requests/[requestId]/vendor-referrals/route";
import * as summary from "@/app/api/vendor-bids/[token]/route";
import * as claim from "@/app/api/vendor-bids/[token]/claim/route";
import * as proposal from "@/app/api/vendor-bids/[token]/proposal/route";
import * as started from "@/app/api/vendor-bids/[token]/started/route";
import * as unsubscribe from "@/app/api/vendor-unsubscribe/[token]/route";
import * as webhook from "@/app/api/webhooks/resend/vendor-invites/route";

const context = { params: Promise.resolve({ requestId: "request-server-route", leadId: "lead-server-route", token: "opaque-signed-token" }) };
const request = (path: string, method = "GET", body?: unknown) => new Request(`https://bundleen.example${path}`, { method, ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
function expectPrivate(response: Response) {
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
  expect(response.headers.get("X-Robots-Tag")).toContain("noindex");
}
beforeEach(() => {
  vi.resetAllMocks(); state.gate.mockResolvedValue({ ok: true, user: { id: "session-actor" } });
  state.list.mockResolvedValue({ leads: [] }); state.upsert.mockResolvedValue({ id: "lead-1" });
  state.importCsv.mockResolvedValue({ dryRun: true, imported: 0 }); state.sourcing.mockResolvedValue({ leads: [] });
  state.invite.mockResolvedValue({ invited: 1 }); state.summary.mockResolvedValue({ request: { category: "pool_care", homeCount: 2 } });
  state.submit.mockResolvedValue({ id: "bid-1" });
});

describe("vendor admin and referral routes", () => {
  const protectedRoutes = [
    { name: "list", run: () => leads.GET(request("/api/admin/vendor-leads"), undefined) },
    { name: "create", run: () => leads.POST(request("/api/admin/vendor-leads", "POST", {}), undefined) },
    { name: "update", run: () => lead.PATCH(request("/api/admin/vendor-leads/lead", "PATCH", {}), context) },
    { name: "import", run: () => imports.POST(request("/api/admin/vendor-leads/import", "POST", {}), undefined) },
    { name: "candidates", run: () => sourcing.GET(request("/api/admin/requests/request/vendor-sourcing"), context) },
    { name: "invite", run: () => sourcing.POST(request("/api/admin/requests/request/vendor-sourcing", "POST", {}), context) },
    { name: "referral", run: () => referrals.POST(request("/api/hoa/requests/request/vendor-referrals", "POST", {}), context) },
    { name: "claim", run: () => claim.POST(request("/api/vendor-bids/token/claim", "POST", {}), context) },
    { name: "proposal", run: () => proposal.PUT(request("/api/vendor-bids/token/proposal", "PUT", {}), context) },
  ];
  it.each(protectedRoutes)("denies anonymous $name before touching any vendor service", async item => {
    state.gate.mockResolvedValue({ ok: false, response: Response.json({ error: "Authentication required." }, { status: 401 }) });
    const response = await item.run(); expect(response.status).toBe(401); expectPrivate(response);
    for (const operation of [state.list, state.upsert, state.importCsv, state.sourcing, state.invite, state.referral, state.claim, state.submit]) expect(operation).not.toHaveBeenCalled();
  });
  it("passes only authenticated actor identity and normalized search", async () => {
    await leads.GET(request("/api/admin/vendor-leads?q=%20Pool%20&actorId=forged"), undefined);
    expect(state.list).toHaveBeenCalledExactlyOnceWith("session-actor", { search: "Pool" });
    const tooLong = await leads.GET(request("/api/admin/vendor-leads?q=" + "x".repeat(161)), undefined);
    expect(tooLong.status).toBe(400); expect(state.list).toHaveBeenCalledOnce();
  });
  it("takes request identity from the route and selected recipients from a strict bounded body", async () => {
    const response = await sourcing.POST(request("/api/admin/requests/request/vendor-sourcing", "POST", { leadIds: ["lead-1"] }), context);
    expect(response.status).toBe(200); expectPrivate(response);
    expect(state.invite).toHaveBeenCalledExactlyOnceWith("session-actor", "request-server-route", { leadIds: ["lead-1"], providerUserIds: [] });
    expect((await sourcing.POST(request("/api/admin/requests/request/vendor-sourcing", "POST", { leadIds: ["lead-1"], actorId: "forged" }), context)).status).toBe(422);
    expect(state.invite).toHaveBeenCalledOnce();
  });
  it("keeps referral provenance server-owned and rejects caller verification flags", async () => {
    const contact = { businessName: "Our synthetic pool tech", email: "pool@example.invalid" };
    expect((await referrals.POST(request("/api/hoa/requests/request/vendor-referrals", "POST", contact), context)).status).toBe(201);
    expect(state.referral).toHaveBeenCalledExactlyOnceWith("session-actor", "request-server-route", expect.objectContaining(contact));
    expect((await referrals.POST(request("/api/hoa/requests/request/vendor-referrals", "POST", { ...contact, contactConfirmed: true }), context)).status).toBe(422);
    expect(state.referral).toHaveBeenCalledOnce();
  });
  it("bounds actual import bytes even when Content-Length understates the payload", async () => {
    const oversized = new Request("https://bundleen.example/api/admin/vendor-leads/import", { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": "1" }, body: JSON.stringify({ csv: "x".repeat(512 * 1024 + 1), targetCounties: ["Los Angeles"] }) });
    const response = await imports.POST(oversized, undefined); expect(response.status).toBe(413); expectPrivate(response); expect(state.importCsv).not.toHaveBeenCalled();
  });
});

describe("opaque invitation public and claimed-provider routes", () => {
  it("lets the public view read a bounded summary without claiming, starting or unsubscribing", async () => {
    const response = await summary.GET(request("/api/vendor-bids/token"), context);
    expect(response.status).toBe(200); expectPrivate(response); expect(state.summary).toHaveBeenCalledExactlyOnceWith("opaque-signed-token");
    for (const operation of [state.gate, state.claim, state.started, state.unsubscribe, state.submit]) expect(operation).not.toHaveBeenCalled();
  });
  it("keeps a missing public invitation private and unavailable", async () => {
    state.summary.mockResolvedValue(null); const response = await summary.GET(request("/api/vendor-bids/token"), context);
    expect(response.status).toBe(404); expectPrivate(response);
  });
  it("does not expose GET mutations for claim, proposal start or unsubscribe", () => {
    for (const module of [claim, started, unsubscribe]) expect((module as unknown as Record<string, unknown>).GET).toBeUndefined();
  });
  it("claims through session identity only and refuses client-specified ownership", async () => {
    expect((await claim.POST(request("/api/vendor-bids/token/claim", "POST", {}), context)).status).toBe(200);
    expect(state.claim).toHaveBeenCalledExactlyOnceWith("session-actor", "opaque-signed-token");
    expect((await claim.POST(request("/api/vendor-bids/token/claim", "POST", { userId: "forged" }), context)).status).toBe(422);
    expect(state.claim).toHaveBeenCalledOnce();
  });
  it("accepts RFC8058 one-click POST through its signed token without an application session", async () => {
    const response = await unsubscribe.POST(new Request("https://bundleen.example/api/vendor-unsubscribe/signed", { method: "POST", headers: { Origin: "https://mail.example.invalid" }, body: "List-Unsubscribe=One-Click" }), context);
    expect(response.status).toBe(200); expectPrivate(response); expect(state.unsubscribe).toHaveBeenCalledExactlyOnceWith("opaque-signed-token"); expect(state.gate).not.toHaveBeenCalled();
  });
  it("passes the exact raw webhook and only the three signature headers to verification", async () => {
    const raw = '{ "type": "email.opened",\n "data" : { "email_id": "synthetic-message" } }';
    const response = await webhook.POST(new Request("https://bundleen.example/api/webhooks/resend/vendor-invites", { method: "POST", headers: { "svix-id": "evt-1", "svix-timestamp": "123", "svix-signature": "v1,synthetic", Origin: "https://api.resend.com" }, body: raw }), undefined);
    expect(response.status).toBe(200); expectPrivate(response);
    expect(state.webhook).toHaveBeenCalledExactlyOnceWith(raw, { "svix-id": "evt-1", "svix-timestamp": "123", "svix-signature": "v1,synthetic" }); expect(state.gate).not.toHaveBeenCalled();
  });
});
