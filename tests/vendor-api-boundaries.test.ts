import { beforeEach, describe, expect, it, vi } from "vitest";
const fallback = vi.hoisted(() => vi.fn(() => Response.json({ error: "Unexpected server failure." }, { status: 500 })));
vi.mock("@/lib/server/hoa-api", () => ({ hoaErrorResponse: fallback, validationErrorResponse: () => Response.json({ error: "Invalid input." }, { status: 422 }) }));
import { readVendorRawBody, vendorHandler, vendorResponse } from "@/lib/server/vendor-api";
import { VendorSourcingError } from "@/lib/server/vendor-errors";
import { vendorBidReturnPath, vendorOnboardingPath } from "@/lib/vendor-bid-return";

function expectPrivate(response: Response) {
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
  expect(response.headers.get("X-Robots-Tag")).toContain("noindex");
  expect(response.headers.get("Vary")).toMatch(/Cookie/i); expect(response.headers.get("Vary")).toMatch(/Authorization/i);
}
beforeEach(() => fallback.mockClear());

describe("public invitation API boundary", () => {
  it.each([400, 403, 404, 409, 429, 503])("preserves the explicit vendor service %s error rather than returning an accidental500", async status => {
    const handler = vendorHandler("synthetic", async () => { throw new VendorSourcingError("Invitation unavailable.", status); });
    const response = await handler(new Request("https://bundleen.example/api/vendor-bids/opaque"), undefined);
    expect(response.status).toBe(status); expectPrivate(response);
    expect(fallback).not.toHaveBeenCalled();
  });
  it("keeps unexpected failures generic and never reflects backend exception text", async () => {
    const handler = vendorHandler("synthetic", async () => { throw new Error("synthetic-database-password-never-reflect"); });
    const response = await handler(new Request("https://bundleen.example/api/vendor-bids/opaque"), undefined);
    expect(response.status).toBe(500); expectPrivate(response);
    expect(await response.text()).not.toContain("synthetic-database-password");
  });
  it.each(["POST", "PATCH", "PUT", "DELETE"])("blocks cross-origin %s before executing a normal mutation", async method => {
    const work = vi.fn(async () => Response.json({ done: true }));
    const response = await vendorHandler("synthetic", work)(new Request("https://bundleen.example/api/vendor-bids/token", { method, headers: { Origin: "https://attacker.invalid" } }), undefined);
    expect(response.status).toBe(403); expectPrivate(response); expect(work).not.toHaveBeenCalled();
  });
  it("rejects Sec-Fetch-Site cross-site even without a stated Origin", async () => {
    const work = vi.fn(async () => Response.json({ done: true }));
    const response = await vendorHandler("synthetic", work)(new Request("https://bundleen.example/api/vendor-bids/token", { method: "POST", headers: { "Sec-Fetch-Site": "cross-site" } }), undefined);
    expect(response.status).toBe(403); expect(work).not.toHaveBeenCalled(); expectPrivate(response);
  });
  it("permits purpose-authenticated one-click unsubscribe/webhook cross-origin transport", async () => {
    const work = vi.fn(async () => Response.json({ accepted: true }));
    const response = await vendorHandler("external signed endpoint", work, true)(new Request("https://bundleen.example/api/vendor-unsubscribe/signed", { method: "POST", headers: { Origin: "https://mail.example.invalid", "Sec-Fetch-Site": "cross-site" } }), undefined);
    expect(response.status).toBe(200); expect(work).toHaveBeenCalledOnce(); expectPrivate(response);
  });
  it("retains cookies, response status, body and existing Vary metadata", async () => {
    const original = Response.json({ denied: true }, { status: 401, headers: { "Set-Cookie": "synthetic=expired; HttpOnly; Secure", Vary: "Origin" } });
    expect(vendorResponse(original)).toBe(original); expectPrivate(original);
    expect(original.headers.get("Set-Cookie")).toContain("HttpOnly"); expect(original.headers.get("Vary")).toContain("Origin");
    expect(await original.json()).toEqual({ denied: true });
  });
});

describe("raw webhook bytes stay bounded and unmodified for signature verification", () => {
  it("does not parse/stringify signed JSON before verification", async () => {
    const raw = '{ "type" : "email.delivered",\n"data": { "email_id": "synthetic" } }\n';
    expect(await readVendorRawBody(new Request("https://bundleen.example", { method: "POST", body: raw }))).toBe(raw);
  });
  it("bounds actual bytes and cancels a dishonest streamed body", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(65537)); }, cancel() { cancelled = true; } });
    const request = new Request("https://bundleen.example", { method: "POST", headers: { "Content-Length": "1" }, body, duplex: "half" } as RequestInit);
    await expect(readVendorRawBody(request)).rejects.toMatchObject({ status: 413 }); expect(cancelled).toBe(true);
  });
  it("refuses absent or invalid UTF8 payloads", async () => {
    await expect(readVendorRawBody(new Request("https://bundleen.example", { method: "POST" }))).rejects.toMatchObject({ status: 400 });
    await expect(readVendorRawBody(new Request("https://bundleen.example", { method: "POST", body: new Uint8Array([255, 254]) }))).rejects.toMatchObject({ status: 400 });
  });
});

describe("signup cannot turn a vendor return path into an open redirect", () => {
  const destination = "/bid/invitation123.nonce123.mac123";
  it("preserves only an opaque local bid destination across provider signup and sign-in", () => {
    expect(vendorBidReturnPath(destination)).toBe(destination);
    const signup = new URL(vendorOnboardingPath("/get-started", destination), "https://bundleen.example");
    expect(signup.searchParams.get("role")).toBe("provider"); expect(signup.searchParams.get("returnTo")).toBe(destination);
    expect(vendorOnboardingPath("/sign-in", destination)).toContain("returnTo=");
  });
  it.each(["https://attacker.invalid/bid/opaque", "//attacker.invalid", "/bid/../admin", "/bid/token?redirect=https://attacker.invalid", "/app/admin", "%2F%2Fattacker.invalid", "/bid/too-short"])("rejects a forged destination %s", value => {
    expect(vendorBidReturnPath(value)).toBeNull(); expect(vendorOnboardingPath("/get-started/profile", value)).toBe("/get-started/profile");
  });
});
