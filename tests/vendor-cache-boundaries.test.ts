import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

function worker() {
  const handlers = new Map<string, (event: any) => void>();
  const stores = new Map<string, Map<string, Response>>();
  const fetch = vi.fn(); const writes = vi.fn(); const lookups = vi.fn();
  const key = (request: Request | string) => typeof request === "string" ? new URL(request, "https://bundleen.example").href : request.url;
  const cache = (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name)!;
    return { match: async (request: Request | string) => { lookups(name, key(request)); return store.get(key(request))?.clone(); },
      put: async (request: Request | string, response: Response) => { writes(name, key(request)); store.set(key(request), response.clone()); },
      delete: async (request: Request | string) => store.delete(key(request)), addAll: vi.fn() };
  };
  const caches = { open: async (name: string) => cache(name), keys: async () => [...stores.keys()], delete: async (name: string) => stores.delete(name),
    match: async (request: Request | string) => { for (const name of stores.keys()) { const found = await cache(name).match(request); if (found) return found; } } };
  runInNewContext(readFileSync(new URL("../public/sw.js", import.meta.url), "utf8"), { URL, Request, Response, Headers, fetch, caches,
    self: { location: { origin: "https://bundleen.example" }, clients: { claim: vi.fn() }, skipWaiting: vi.fn(), addEventListener: (kind: string, handler: (event: any) => void) => handlers.set(kind, handler) } });
  async function request(path: string, mode = "navigate") {
    let response: Promise<Response | undefined> | undefined; const background: Promise<unknown>[] = [];
    handlers.get("fetch")!({ request: { url: `https://bundleen.example${path}`, method: "GET", mode }, respondWith: (value: Promise<Response | undefined>) => { response = value; }, waitUntil: (value: Promise<unknown>) => background.push(value) });
    const result = response ? await response : undefined; await Promise.allSettled(background); await Promise.resolve();
    return { handled: !!response, response: result };
  }
  async function activate() { const pending: Promise<unknown>[] = []; handlers.get("activate")!({ waitUntil: (p: Promise<unknown>) => pending.push(p) }); await Promise.all(pending); }
  return { fetch, stores, cache, writes, lookups, request, activate };
}

describe("service-worker boundaries for private vendor links", () => {
  it.each(["/bid/signed-private-token.jpg", "/vendor-unsubscribe/signed-token.png", "/sign-in?returnTo=%2Fbid%2Fsecret", "/get-started/profile", "/app/provider/profile", "/admin/communities", "/public?returnTo=%2Fbid%2Fsecret", "/api/vendor-bids/secret", "/_next/webpack-hmr"])("does not intercept or cache %s", async path => {
    const w = worker(); const response = await w.request(path);
    expect(response.handled).toBe(false); expect(w.fetch).not.toHaveBeenCalled(); expect(w.writes).not.toHaveBeenCalled(); expect(w.lookups).not.toHaveBeenCalled();
  });
  it("removes old Bundleen generations without deleting unrelated application caches", async () => {
    const w = worker(); w.cache("bundleen-v1"); w.cache("bundleen-v2"); w.cache("other-application-v1"); await w.activate();
    expect([...w.stores.keys()].sort()).toEqual(["bundleen-v2", "other-application-v1"]);
  });
  it("never falls back to a prior-generation private page while offline", async () => {
    const w = worker(); await w.cache("bundleen-v1").put("/residents", new Response("old private content")); await w.cache("bundleen-v2").put("/offline.html", new Response("Offline shell")); w.fetch.mockRejectedValue(new Error("offline"));
    const result = await w.request("/residents"); expect(await result.response!.text()).toBe("Offline shell");
    expect(w.lookups.mock.calls.every(([name]) => name === "bundleen-v2")).toBe(true);
  });
  it.each(["private", "no-store", "private, no-store"])("evicts old public-page cache when network says %s", async directive => {
    const w = worker(); await w.cache("bundleen-v2").put("/residents", new Response("stale")); w.fetch.mockResolvedValue(new Response("private response", { headers: { "Cache-Control": directive } })); w.writes.mockClear();
    const result = await w.request("/residents"); expect(await result.response!.text()).toBe("private response");
    expect(w.stores.get("bundleen-v2")?.has("https://bundleen.example/residents")).toBe(false); expect(w.writes).not.toHaveBeenCalled();
  });
  it("refuses cached no-store responses when offline", async () => {
    const w = worker(); await w.cache("bundleen-v2").put("/residents", new Response("sensitive", { headers: { "Cache-Control": "no-store" } })); await w.cache("bundleen-v2").put("/offline.html", new Response("Offline shell")); w.fetch.mockRejectedValue(new Error("offline"));
    const result = await w.request("/residents"); expect(await result.response!.text()).toBe("Offline shell");
  });
  it("continues to cache successful public navigation", async () => {
    const w = worker(); w.fetch.mockResolvedValue(new Response("Public homepage", { headers: { "Cache-Control": "public, max-age=60" } }));
    const result = await w.request("/"); expect(await result.response!.text()).toBe("Public homepage");
    expect(w.stores.get("bundleen-v2")?.has("https://bundleen.example/")).toBe(true);
  });
  it("does not cache errors or redirects as successful public pages", async () => {
    for (const response of [new Response("Failure", { status: 500 }), Response.redirect("https://bundleen.example/sign-in")]) {
      const w = worker(); w.fetch.mockResolvedValue(response); await w.request("/residents"); expect(w.writes).not.toHaveBeenCalled();
    }
  });
});
