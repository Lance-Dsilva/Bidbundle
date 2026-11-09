import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  authorized: true,
  user: { id: "session-provider", role: "provider", adminAccessLevel: null as string | null, adminIsStaffAccount: false },
  list: vi.fn(), store: vi.fn(), access: vi.fn(), read: vi.fn(),
  adminDetail: vi.fn(), adminUpdate: vi.fn(),
}));
function gate() {
  return state.authorized ? { ok: true, user: state.user } : { ok: false, response: Response.json({ error: "Unauthorized" }, { status: 401 }) };
}
vi.mock("@/lib/server/provider-api", () => ({ requireProviderConsole: gate, requireProviderConsoleMutation: gate }));
vi.mock("@/lib/server/auth", () => ({ authorizeRequest: gate }));
vi.mock("@/lib/server/admin-api", async (importActual) => ({
  ...await importActual<typeof import("@/lib/server/admin-api")>(), requireAdmin: gate, requireAdminMutation: gate,
}));
vi.mock("@/lib/server/providers-admin", () => ({ getProviderDetail: state.adminDetail, updateProviderAdministration: state.adminUpdate }));
vi.mock("@/lib/server/provider-credentials", async (importActual) => ({
  ...await importActual<typeof import("@/lib/server/provider-credentials")>(),
  listProviderCredentials: state.list, storeProviderCredential: state.store,
  loadProviderCredentialForAccess: state.access, readPrivateCredentialBytes: state.read,
}));
vi.mock("@/lib/server/hoa-api", () => ({
  hoaErrorResponse: (_context: string, error: { status?: number; message?: string }) =>
    Response.json({ error: error.message ?? "Failure" }, { status: error.status ?? 500 }),
}));

const credentials = await import("@/app/api/provider/credentials/route");
const download = await import("@/app/api/provider/credentials/[mediaId]/route");
const admin = await import("@/app/api/admin/providers/[userId]/route");
const context = { params: Promise.resolve({ mediaId: "document-1" }) };
const URL = "https://bundleen.test/api/provider/credentials";
const request = () => new Request(`${URL}/document-1`);

function form() {
  const body = new FormData();
  body.append("kind", "license");
  body.append("file", new Blob(["%PDF-1.7\n%%EOF"], { type: "application/pdf" }), "license.pdf");
  return body;
}

beforeEach(() => {
  vi.clearAllMocks(); state.authorized = true;
  state.user = { id: "session-provider", role: "provider", adminAccessLevel: null, adminIsStaffAccount: false };
  state.list.mockResolvedValue({ license: { id: "document-1", url: "/api/provider/credentials/document-1" }, insurance: null });
  state.store.mockResolvedValue("document-1");
  state.adminDetail.mockResolvedValue({ userId: "provider-1", accountStatus: "active", credentials: null });
  state.adminUpdate.mockResolvedValue({ changed: true });
  state.access.mockResolvedValue({ id: "document-1", storagePath: "server-only-path", contentType: "application/pdf" });
  state.read.mockImplementation(async () => ({ contentType: "application/pdf", stream: new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode("private-document")); controller.close(); },
  }) }));
});

describe("operations staff provider administration routes", () => {
  const adminContext = { params: Promise.resolve({ userId: "provider-1" }) };
  const adminRequest = (body?: unknown) => new Request("https://bundleen.test/api/admin/providers/provider-1", body ? {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  } : undefined);

  beforeEach(() => { state.user = { id: "operations-1", role: "admin", adminAccessLevel: "admin", adminIsStaffAccount: true }; });

  it("keeps provider account reads but requests a DTO without private credentials", async () => {
    const response = await admin.GET(adminRequest(), adminContext);
    expect(response.status).toBe(200);
    expect(state.adminDetail).toHaveBeenCalledExactlyOnceWith("provider-1", { includeCredentials: false });
    expect(await response.json()).toMatchObject({ userId: "provider-1", credentials: null });
  });

  it("preserves authorized account-status changes and redacts their response", async () => {
    const body = { accountStatus: "suspended", expectedUpdatedAt: "2026-11-08T12:00:00Z" };
    const response = await admin.PATCH(adminRequest(body), adminContext);
    expect(response.status).toBe(200);
    expect(state.adminUpdate).toHaveBeenCalledExactlyOnceWith(state.user, "provider-1", body);
    expect(state.adminDetail).toHaveBeenCalledExactlyOnceWith("provider-1", { includeCredentials: false });
    expect(await response.json()).toMatchObject({ changed: true, credentials: null });
  });

  it.each([
    { license: "verify", licenseDocumentId: "document-1", licenseDocumentChecksum: "a".repeat(64), licenseExpiresOn: "2099-01-01" },
    { insurance: "revoke" },
  ])("rejects credential intents before calling the service: %j", async (intent) => {
    const response = await admin.PATCH(adminRequest({ ...intent, expectedUpdatedAt: "2026-11-08T12:00:00Z" }), adminContext);
    expect(response.status).toBe(403);
    expect(state.adminUpdate).not.toHaveBeenCalled(); expect(state.adminDetail).not.toHaveBeenCalled();
  });
});

describe("provider credential collection routes", () => {
  it("lists only the authenticated provider's evidence without cache reuse", async () => {
    const response = await credentials.GET();
    expect(response.status).toBe(200);
    expect(state.list).toHaveBeenCalledExactlyOnceWith("session-provider");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({ license: { url: "/api/provider/credentials/document-1" } });
  });

  it("uploads through session identity and returns the refreshed private proxy metadata", async () => {
    const response = await credentials.POST(new Request(URL, { method: "POST", body: form() }));
    expect(response.status).toBe(201);
    expect(state.store).toHaveBeenCalledExactlyOnceWith("session-provider", "license", expect.any(Blob));
    expect(state.list).toHaveBeenCalledExactlyOnceWith("session-provider");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(JSON.stringify(await response.json())).not.toMatch(/storagePath|storageUrl|server-only-path/);
  });

  it("authenticates before reading or writing any evidence", async () => {
    state.authorized = false;
    expect((await credentials.GET()).status).toBe(401);
    expect((await credentials.POST(new Request(URL, { method: "POST", body: "malformed" }))).status).toBe(401);
    expect(state.list).not.toHaveBeenCalled(); expect(state.store).not.toHaveBeenCalled();
  });

  it.each(["other-kind", "provider_license", "LICENSE", ""])("rejects unsupported credential kinds: %s", async (kind) => {
    const body = form(); body.set("kind", kind);
    expect((await credentials.POST(new Request(URL, { method: "POST", body }))).status).toBe(422);
    expect(state.store).not.toHaveBeenCalled();
  });

  it.each(["duplicate-kind", "duplicate-file", "client-owner"])("rejects ambiguous multipart or client ownership: %s", async (caseName) => {
    const body = form();
    if (caseName === "duplicate-kind") body.append("kind", "insurance");
    else if (caseName === "duplicate-file") body.append("file", new Blob(["other"]));
    else body.append("userId", "another-provider");
    expect((await credentials.POST(new Request(URL, { method: "POST", body }))).status).toBe(422);
    expect(state.store).not.toHaveBeenCalled();
  });

  it("bounds actual multipart bytes even when Content-Length understates them", async () => {
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new Uint8Array(4 * 1024 * 1024 + 65537)); controller.close();
    } });
    const response = await credentials.POST(new Request(URL, { method: "POST", body,
      headers: { "Content-Type": "multipart/form-data; boundary=test", "Content-Length": "1" }, duplex: "half",
    } as RequestInit));
    expect(response.status).toBe(413);
    expect(state.store).not.toHaveBeenCalled(); expect(state.list).not.toHaveBeenCalled();
  });
});

describe("private credential download route", () => {
  it("returns attachment bytes with no-store, nosniff and sandbox protection", async () => {
    const response = await download.GET(request(), context);
    expect(response.status).toBe(200);
    expect(state.access).toHaveBeenCalledExactlyOnceWith("document-1", { userId: "session-provider", canReviewProviders: false });
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toContain("sandbox");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(await response.text()).toBe("private-document");
  });

  it.each([
    { role: "admin", adminAccessLevel: "admin", adminIsStaffAccount: false, allowed: true },
    { role: "admin", adminAccessLevel: null, adminIsStaffAccount: false, allowed: false },
    { role: "admin", adminAccessLevel: "admin", adminIsStaffAccount: true, allowed: false },
    { role: "provider", adminAccessLevel: "admin", adminIsStaffAccount: false, allowed: false },
  ])("grants reviewer access only to an authorized non-staff Bundleen administrator: %j", async ({ allowed, ...user }) => {
    state.user = { id: "viewer", ...user };
    await download.GET(request(), context);
    expect(state.access).toHaveBeenCalledWith("document-1", { userId: "viewer", canReviewProviders: allowed });
  });

  it("makes unauthenticated and inaccessible identifiers indistinguishable", async () => {
    state.authorized = false;
    const unauthenticated = await download.GET(request(), context);
    expect(state.access).not.toHaveBeenCalled();
    state.authorized = true; state.access.mockResolvedValueOnce(null);
    const inaccessible = await download.GET(request(), context);
    expect(unauthenticated.status).toBe(404); expect(inaccessible.status).toBe(404);
    expect(await unauthenticated.json()).toEqual(await inaccessible.json());
    expect(inaccessible.headers.get("cache-control")).toBe("private, no-store");
    expect(state.read).not.toHaveBeenCalled();
  });

  it("returns the same missing response when private storage has no bytes", async () => {
    state.read.mockResolvedValueOnce(null);
    const response = await download.GET(request(), context);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Not found." });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
