import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ coverage: vi.fn(), guard: vi.fn() }));
vi.mock("@/lib/server/onboarding-coverage", () => ({ getOnboardingCoverage: state.coverage }));
vi.mock("@/lib/server/onboarding-coverage-guard", async (original) => ({ ...await original<typeof import("@/lib/server/onboarding-coverage-guard")>(), guardOnboardingCoverage: state.guard }));
import { POST } from "@/app/api/onboarding/coverage/route";
import { MAX_COVERAGE_BODY_BYTES, onboardingCoverageSchema } from "@/lib/validation/onboarding-coverage";
function request(body: unknown, headers: Record<string, string> = {}) { return new Request("https://bundleen.test/api/onboarding/coverage", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) }); }
const point = { latitude: 30.4, longitude: -97.7 };
beforeEach(() => { state.guard.mockReset().mockResolvedValue(null); state.coverage.mockReset().mockResolvedValue("available"); });
describe("public coverage endpoint", () => {
  it.each(["available", "unavailable"])("returns only the coarse %s advisory result without session or membership creation", async (coverage) => {
    state.coverage.mockResolvedValue(coverage); const response = await POST(request(point)); expect(response.status).toBe(200); expect(await response.json()).toEqual({ coverage }); expect(response.headers.get("Cache-Control")).toBe("no-store"); expect(state.coverage).toHaveBeenCalledWith(point);
  });
  it.each([{ status: 403, error: "Check coverage from this site." }, { status: 429, error: "Too many checks", retryAfterSeconds: 23 }, { status: 503, error: "Unavailable" }])("enforces guard $status before body/database work", async (failure) => {
    state.guard.mockResolvedValue(failure); const response = await POST(new Request("https://bundleen.test/api/onboarding/coverage", { method: "POST", body: "not JSON" })); expect(response.status).toBe(failure.status); expect(await response.json()).toEqual({ error: failure.error }); expect(response.headers.get("Cache-Control")).toBe("no-store"); expect(state.coverage).not.toHaveBeenCalled(); if (failure.status === 429) expect(response.headers.get("Retry-After")).toBe("23");
  });
  it.each([{ ...point, communityId: "target" }, { ...point, userId: "target" }, { latitude: 91, longitude: 0 }, { latitude: 0, longitude: -181 }, { latitude: "30", longitude: 0 }, { latitude: null, longitude: 0 }, {}, []])("rejects invalid or probing payload before a database read: %j", async (body) => {
    const response = await POST(request(body)); expect(response.status).toBe(400); expect(response.headers.get("Cache-Control")).toBe("no-store"); expect(state.coverage).not.toHaveBeenCalled();
  });
  it.each([NaN, Infinity, -Infinity])("rejects non-finite coordinates in the validation boundary: %s", (latitude) => { expect(onboardingCoverageSchema.safeParse({ latitude, longitude: 0 }).success).toBe(false); });
  it.each([{ latitude: -90, longitude: -180 }, { latitude: 90, longitude: 180 }, { latitude: 0, longitude: 0 }])("accepts valid geographic bounds: %j", async (body) => { expect((await POST(request(body))).status).toBe(200); expect(state.coverage).toHaveBeenCalledWith(body); });
  it.each([{ body: "{", type: "application/json", status: 400 }, { body: "{}", type: "text/plain", status: 415 }, { body: "x".repeat(MAX_COVERAGE_BODY_BYTES + 1), type: "application/json", status: 413 }])("retains bounded JSON parsing: $status", async ({ body, type, status }) => {
    const response = await POST(new Request("https://bundleen.test/api/onboarding/coverage", { method: "POST", headers: { "Content-Type": type }, body })); expect(response.status).toBe(status); expect(state.coverage).not.toHaveBeenCalled(); expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
  it("rejects declared oversized bodies before reading them", async () => { const response = await POST(request(point, { "Content-Length": String(MAX_COVERAGE_BODY_BYTES + 1) })); expect(response.status).toBe(413); expect(state.coverage).not.toHaveBeenCalled(); });
  it.each(["guard", "coverage"] as const)("contains unexpected %s errors without coordinate/identity leakage or logs", async (source) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {}); state[source].mockRejectedValue(new Error("private-ip203.0.113.7 latitude30.4 dbpassword"));
    try { const response = await POST(request(point)); expect(response.status).toBe(503); expect(response.headers.get("Cache-Control")).toBe("no-store"); expect(JSON.stringify(await response.json())).not.toMatch(/203\.0\.113|30\.4|dbpassword/); expect(log).not.toHaveBeenCalled(); } finally { log.mockRestore(); }
  });
});
