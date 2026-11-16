import { beforeEach, describe, expect, it, vi } from "vitest";
const { consent, events, query, transaction } = vi.hoisted(() => ({
  consent: { findUnique: vi.fn(), upsert: vi.fn() },
  events: { upsert: vi.fn(), deleteMany: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
  query: vi.fn(), transaction: vi.fn(),
}));
vi.mock("@/lib/server/db", () => ({ db: { productAnalyticsConsent: consent, productAnalyticsEvent: events, $queryRaw: query, $transaction: transaction } }));
import { analyticsConfig, captureProductEvent, deliverProductAnalytics, deliverOptionalProductAnalytics, enqueueProductEvent, posthogPayload, productEventUuid, setProductAnalyticsConsent } from "@/lib/server/product-analytics";
import { ANALYTICS_CONSENT_VERSION, productPropertiesSchema } from "@/lib/analytics/events";
const store = { productAnalyticsConsent: consent, productAnalyticsEvent: events, $queryRaw: query } as never;
const input = { userId: "internal_user", event: "payment_succeeded" as const, eventId: "evt_fixture", properties: { communityId: "community_1", requestId: "request_1", role: "homeowner" as const } };
const row = { id: productEventUuid(input), userId: input.userId, event: input.event, properties: input.properties, occurredAt: new Date("2026-01-01"), deliveredAt: null, nextAttemptAt: new Date(0), attempts: 0 };
beforeEach(() => {
  vi.clearAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals();
  vi.stubEnv("PRODUCT_ANALYTICS_ENABLED", "1"); vi.stubEnv("POSTHOG_PROJECT_KEY", "phc_fixture"); vi.stubEnv("POSTHOG_HOST", "https://us.i.posthog.com");
  transaction.mockImplementation((callback) => callback(store));
  consent.findUnique.mockResolvedValue({ allowed: true, version: ANALYTICS_CONSENT_VERSION });
  events.findMany.mockResolvedValue([{ id: row.id, userId: row.userId }]); events.findUnique.mockResolvedValue(row);
});
describe("analytics privacy and identity", () => {
  it.each(["name", "address", "email", "url", "token", "phone", "ip", "anything"])("rejects unexpected %s property", (key) => { expect(productPropertiesSchema.safeParse({ [key]: "private" }).success).toBe(false); });
  it("rejects arbitrary category and role text", () => { expect(productPropertiesSchema.safeParse({ category: "123 Main Street" }).success).toBe(false); expect(productPropertiesSchema.safeParse({ role: "John" }).success).toBe(false); });
  it("only exports allowlisted data and disables enrichment/profiles", () => {
    const body = posthogPayload(row, "phc_fixture");
    expect(body.properties).toEqual({ ...input.properties, $process_person_profile: false, $geoip_disable: true, $ip: null });
    expect(body.uuid).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-a[a-f0-9]{3}-[a-f0-9]{12}$/);
    expect(JSON.stringify(body)).not.toContain("evt_fixture");
  });
  it("uses stable event IDs but separates actors and outcomes", () => {
    expect(productEventUuid(input)).toBe(productEventUuid({ ...input }));
    expect(productEventUuid(input)).not.toBe(productEventUuid({ ...input, userId: "other" }));
    expect(productEventUuid(input)).not.toBe(productEventUuid({ ...input, event: "payment_failed" }));
  });
  it.each(["http://localhost:4321", "https://example.com", "https://us.i.posthog.com.evil.test", "https://us.i.posthog.com/path"])("rejects ingestion host %s", (host) => { vi.stubEnv("POSTHOG_HOST", host); expect(analyticsConfig()).toBeNull(); });
  it("rejects personal API keys", () => { vi.stubEnv("POSTHOG_PROJECT_KEY", "phx_private"); expect(analyticsConfig()).toBeNull(); });
});
describe("consent collection", () => {
  it("does nothing while disabled", async () => { vi.stubEnv("PRODUCT_ANALYTICS_ENABLED", "0"); expect(await enqueueProductEvent(store, input)).toBe(false); expect(query).not.toHaveBeenCalled(); });
  it.each([null, { allowed: false, version: ANALYTICS_CONSENT_VERSION }, { allowed: true, version: "old" }])("does not collect without current consent %#", async (value) => { consent.findUnique.mockResolvedValue(value); expect(await enqueueProductEvent(store, input)).toBe(false); expect(events.upsert).not.toHaveBeenCalled(); });
  it("locks consent and upserts without overwriting original event time or context", async () => { expect(await enqueueProductEvent(store, input)).toBe(true); expect(query).toHaveBeenCalled(); expect(events.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: {}, where: { id: row.id } })); });
  it("revocation deletes queued events transactionally", async () => { await setProductAnalyticsConsent(input.userId, false); expect(events.deleteMany).toHaveBeenCalledWith({ where: { userId: input.userId, deliveredAt: null } }); });
  it("opt in never retroactively queues activity", async () => { await setProductAnalyticsConsent(input.userId, true); expect(events.upsert).not.toHaveBeenCalled(); expect(events.deleteMany).not.toHaveBeenCalled(); });
  it("optional collection failure never fails the original business action", async () => { transaction.mockRejectedValue(new Error("database down")); const warn = vi.spyOn(console, "warn").mockImplementation(() => {}); await expect(captureProductEvent(input)).resolves.toBeUndefined(); warn.mockRestore(); });
});
describe("durable delivery", () => {
  it("rechecks consent before sending queued events", async () => { const fetch = vi.fn(); vi.stubGlobal("fetch", fetch); consent.findUnique.mockResolvedValue({ allowed: false }); expect(await deliverProductAnalytics()).toEqual({ delivered: 0, failed: 0, suppressed: 1 }); expect(fetch).not.toHaveBeenCalled(); expect(events.delete).toHaveBeenCalled(); });
  it("sends stable UUID and original timestamp on successful delivery", async () => { const fetch = vi.fn().mockResolvedValue(Response.json({ status: 1 })); vi.stubGlobal("fetch", fetch); expect(await deliverProductAnalytics()).toEqual({ delivered: 1, failed: 0, suppressed: 0 }); const options = fetch.mock.calls[0][1]; expect(JSON.parse(options.body).uuid).toBe(row.id); expect(JSON.parse(options.body).timestamp).toBe("2026-01-01T00:00:00.000Z"); expect(options.redirect).toBe("error"); });
  it.each([503, 429])("retains failed events for retry on HTTP %s", async (status) => { vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Unavailable", { status }))); expect((await deliverProductAnalytics()).failed).toBe(1); expect(events.update.mock.calls[0][0].data.deliveredAt).toBeUndefined(); expect(events.update.mock.calls[0][0].data.nextAttemptAt).toBeInstanceOf(Date); });
  it("does not treat quota-limited HTTP 200 as delivered", async () => { vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ status: 1, quota_limited: ["events"] }))); expect((await deliverProductAnalytics()).failed).toBe(1); });
  it("does not send already delivered rows claimed by another worker", async () => { events.findUnique.mockResolvedValue({ ...row, deliveredAt: new Date() }); const fetch = vi.fn(); vi.stubGlobal("fetch", fetch); await deliverProductAnalytics(); expect(fetch).not.toHaveBeenCalled(); });
  it("caps every drain", async () => { events.findMany.mockResolvedValue([]); await deliverProductAnalytics(10000); expect(events.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 10 })); });
});

it("isolates an analytics database outage from the operational worker", async () => {
  events.findMany.mockRejectedValueOnce(new Error("database unavailable"));
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  await expect(deliverOptionalProductAnalytics()).resolves.toMatchObject({ unavailable: true });
  warn.mockRestore();
});
