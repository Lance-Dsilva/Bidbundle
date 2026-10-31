import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ session: "clerk-ops" as string | null, role: "admin", verified: true, grant: "active" as string | null, list: vi.fn() }));
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: state.session }) }));
vi.mock("@/lib/server/db", () => ({ db: { user: { findUnique: async () => ({ id: "ops", clerkUserId: state.session, email: "ops@example.invalid", fullName: "Ops", role: state.role, isVerified: state.verified, adminAccess: state.grant ? { email: "ops@example.invalid", level: "admin", status: state.grant, permissions: [], isStaffAccount: false } : null }) } } }));
vi.mock("@/lib/server/hoa", () => ({ isHoaManager: async () => false, HoaWorkflowError: class extends Error {} }));
vi.mock("@/lib/server/community-interest", () => ({ listCommunityInterest: state.list }));
import AdminCommunityInterestPage from "@/app/app/admin/community-interest/page";
import { GET } from "@/app/api/admin/community-interest/route";
function req(query = "") { return new Request(`https://bundleen.test/api/admin/community-interest${query}`); }
beforeEach(() => { state.session = "clerk-ops"; state.role = "admin"; state.verified = true; state.grant = "active"; state.list.mockReset().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 }); });
describe("admin interest read uses the actual live grant gate", () => {
  it("admits an active verified admin and defaults to a bounded page", async () => { const response = await GET(req()); expect(response.status).toBe(200); expect(state.list).toHaveBeenCalledWith({ page: 1, pageSize: 20 }); expect(response.headers.get("Cache-Control")).toBe("no-store"); });
  it.each(["homeowner", "provider", "hoa_staff"])("denies a %s before listing contacts", async (role) => { state.role = role; const response = await GET(req()); expect(response.status).toBe(403); expect(state.list).not.toHaveBeenCalled(); });
  it("denies signed-out callers before listing contacts", async () => { state.session = null; expect((await GET(req())).status).toBe(401); expect(state.list).not.toHaveBeenCalled(); });
  it.each([null, "pending", "revoked"])("denies admin role without a currently active grant: %j", async (grant) => { state.grant = grant; expect((await GET(req())).status).toBe(403); expect(state.list).not.toHaveBeenCalled(); });
  it("denies an unverified admin despite an active grant row", async () => { state.verified = false; expect((await GET(req())).status).not.toBe(200); expect(state.list).not.toHaveBeenCalled(); });
  it.each(["?page=0", "?pageSize=51", "?page=1.5", "?page=1&page=2", "?userId=target"])("rejects invalid paging or probing fields: %s", async (query) => { expect((await GET(req(query))).status).toBe(400); expect(state.list).not.toHaveBeenCalled(); });
  it("forwards an explicit bounded page", async () => { expect((await GET(req("?page=2&pageSize=50"))).status).toBe(200); expect(state.list).toHaveBeenCalledWith({ page: 2, pageSize: 50 }); });
  it("does not expose contact-bearing database errors in response or logs", async () => { const log = vi.spyOn(console, "error").mockImplementation(() => {}); state.list.mockRejectedValue(new Error("jane@example.invalid 1 Oak St private-secret")); try { const response = await GET(req()); expect(response.status).toBe(503); expect(JSON.stringify(await response.json())).not.toMatch(/jane|Oak St|private-secret/); expect(log).not.toHaveBeenCalled(); } finally { log.mockRestore(); } });
  it("protects the server page with the same live administrator grant", async () => {
    await expect(AdminCommunityInterestPage()).resolves.toBeDefined(); state.grant = "revoked";
    await expect(AdminCommunityInterestPage()).rejects.toThrow("NEXT_REDIRECT"); state.grant = "active"; state.session = null;
    await expect(AdminCommunityInterestPage()).rejects.toThrow("NEXT_REDIRECT"); expect(state.list).not.toHaveBeenCalled();
  });

});
