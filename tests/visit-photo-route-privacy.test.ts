import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  gate: vi.fn(), mutation: vi.fn(), body: vi.fn(), readForm: vi.fn(),
  load: vi.fn(), bytes: vi.fn(), list: vi.fn(), store: vi.fn(), remove: vi.fn(), consent: vi.fn(),
}));
vi.mock("@/lib/server/auth", () => ({ authorizeRequest: state.gate }));
vi.mock("@/lib/server/provider-api", () => ({ requireProviderConsole: state.gate, requireProviderConsoleMutation: state.gate }));
vi.mock("@/lib/server/auth-guard", () => ({
  guardHoaMutation: state.mutation,
  guardFailureResponse: () => Response.json({ error: "Rate limited." }, { status: 429, headers: { "Retry-After": "30" } }),
}));
vi.mock("@/lib/server/hoa", () => ({ HoaWorkflowError: class extends Error {
  constructor(message: string, readonly status = 409) { super(message); }
} }));
vi.mock("@/lib/server/hoa-api", () => ({
  readHoaBody: state.body,
  validationErrorResponse: () => Response.json({ error: "Invalid input." }, { status: 400 }),
  hoaErrorResponse: (_scope: string, error: { status?: number }) => Response.json({ error: "Request failed." }, { status: error.status ?? 500 }),
}));
vi.mock("@/lib/server/visit-photos", () => ({
  loadVisitPhotoForAccess: state.load, readVisitPhotoBytes: state.bytes,
  listVisitPhotos: state.list, readVisitPhotoForm: state.readForm, storeVisitPhoto: state.store,
  removeVisitPhoto: state.remove, setVisitPhotoMarketingConsent: state.consent,
}));

import { GET as photoGet } from "@/app/api/visit-photos/[mediaId]/route";
import { GET as photoList, POST as photoUpload } from "@/app/api/provider/marketplace/visits/[visitId]/photos/route";
import { DELETE as photoDelete } from "@/app/api/provider/marketplace/visits/[visitId]/photos/[mediaId]/route";
import { PATCH as photoConsent } from "@/app/api/hoa/visits/[visitId]/photos/[mediaId]/consent/route";
import { privateVisitPhotoResponse } from "@/lib/server/private-visit-photo-response";

type Context = { params: Promise<{ visitId: string; mediaId: string }> };
const routes: Array<{ name: string; method: string; handler: (request: Request, context: Context) => Promise<Response>; success: number }> = [
  { name: "private bytes", method: "GET", handler: photoGet, success: 200 },
  { name: "provider list", method: "GET", handler: photoList, success: 200 },
  { name: "provider upload", method: "POST", handler: photoUpload, success: 201 },
  { name: "provider delete", method: "DELETE", handler: photoDelete, success: 200 },
  { name: "resident consent", method: "PATCH", handler: photoConsent, success: 200 },
];
function call(route: typeof routes[number]) {
  return route.handler(new Request("https://example.invalid/api/visit-photos/photo-1", { method: route.method }),
    { params: Promise.resolve({ visitId: "visit-1", mediaId: "photo-1" }) });
}
function expectPrivate(response: Response) {
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  const vary = response.headers.get("Vary")!.toLowerCase().split(",").map((value) => value.trim());
  expect(vary).toContain("cookie"); expect(vary).toContain("authorization");
}

beforeEach(() => {
  vi.resetAllMocks();
  state.gate.mockResolvedValue({ ok: true, user: { id: "user-1" } });
  state.mutation.mockResolvedValue(null);
  state.body.mockResolvedValue({ ok: true, value: { consent: true } });
  const form = new FormData(); form.set("purpose", "visit_after"); form.set("file", new Blob(["synthetic"]));
  state.readForm.mockResolvedValue(form);
  state.load.mockResolvedValue({ id: "photo-1", contentType: "image/jpeg" });
  state.bytes.mockResolvedValue(new Uint8Array([1, 2, 3]));
  state.list.mockResolvedValue({ photos: [] });
  state.store.mockResolvedValue({ id: "photo-1" });
  state.remove.mockResolvedValue(undefined);
  state.consent.mockResolvedValue({ id: "photo-1", marketingConsented: true });
});

describe("every private visit-photo handler", () => {
  it.each(routes)("keeps anonymous $name at 401 with private response headers", async (route) => {
    state.gate.mockResolvedValue({ ok: false, response: Response.json({ error: "Authentication required." }, { status: 401 }) });
    const response = await call(route);
    expect(response.status).toBe(401); expectPrivate(response);
    for (const operation of [state.load, state.bytes, state.list, state.store, state.remove, state.consent, state.readForm]) {
      expect(operation).not.toHaveBeenCalled();
    }
  });

  it.each(routes)("keeps the successful $name status and headers", async (route) => {
    const response = await call(route);
    expect(response.status).toBe(route.success); expectPrivate(response);
    if (route.name === "private bytes") {
      expect(response.headers.get("Content-Type")).toBe("image/jpeg");
      expect(response.headers.get("Content-Disposition")).toBe("inline");
      expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1, 2, 3]);
    }
  });

  it.each(routes)("keeps $name service failures private without changing their status", async (route) => {
    if (route.name === "private bytes") state.load.mockResolvedValue(null);
    else {
      const service = route.name === "provider list" ? state.list : route.name === "provider upload" ? state.store : route.name === "provider delete" ? state.remove : state.consent;
      service.mockRejectedValue(Object.assign(new Error("Scoped access denied."), { status: 403 }));
    }
    const response = await call(route);
    expect(response.status).toBe(route.name === "private bytes" ? 404 : 403); expectPrivate(response);
  });

  it.each(routes)("keeps even an unexpected $name authentication-service error private", async (route) => {
    state.gate.mockRejectedValue(new Error("Session lookup unavailable."));
    const response = await call(route);
    expect(response.status).toBe(500); expectPrivate(response);
  });
});

describe("early returns and private response metadata", () => {
  it("retains authenticated unknown-byte 404 and does not attempt storage access", async () => {
    state.load.mockResolvedValue(null);
    const response = await call(routes[0]);
    expect(response.status).toBe(404); expectPrivate(response); expect(state.bytes).not.toHaveBeenCalled();
  });
  it("keeps private storage errors private", async () => {
    state.bytes.mockRejectedValue(Object.assign(new Error("Storage unavailable."), { status: 503 }));
    const response = await call(routes[0]); expect(response.status).toBe(503); expectPrivate(response);
  });
  it("keeps consent rate-limit and body/validation denials private", async () => {
    state.mutation.mockResolvedValue({ kind: "rate-limited" });
    const limited = await call(routes[4]); expect(limited.status).toBe(429); expect(limited.headers.get("Retry-After")).toBe("30"); expectPrivate(limited);
    state.mutation.mockResolvedValue(null);
    state.body.mockResolvedValue({ ok: false, response: Response.json({ error: "Too large." }, { status: 413 }) });
    const oversized = await call(routes[4]); expect(oversized.status).toBe(413); expectPrivate(oversized);
    state.body.mockResolvedValue({ ok: true, value: { consent: "yes" } });
    const invalid = await call(routes[4]); expect(invalid.status).toBe(400); expectPrivate(invalid);
    expect(state.consent).not.toHaveBeenCalled();
  });
  it("keeps malformed upload form failures private without storing bytes", async () => {
    state.readForm.mockResolvedValue(new FormData());
    const response = await call(routes[2]); expect(response.status).toBe(400); expectPrivate(response); expect(state.store).not.toHaveBeenCalled();
  });
  it("preserves existing Vary values, authentication cookies, status and body", async () => {
    const original = Response.json({ error: "Authentication required." }, {
      status: 401, headers: { Vary: "Origin, cookie", "Set-Cookie": "session=expired; HttpOnly; Secure", "Cache-Control": "public, max-age=300" },
    });
    const response = privateVisitPhotoResponse(original);
    expect(response).toBe(original); expect(response.status).toBe(401); expectPrivate(response);
    expect(response.headers.get("Vary")).toBe("Origin, cookie, Authorization");
    expect(response.headers.get("Set-Cookie")).toBe("session=expired; HttpOnly; Secure");
    expect(await response.json()).toEqual({ error: "Authentication required." });
  });
});
