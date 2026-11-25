import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/server/db";
import { deliverProductAnalytics, enqueueProductEvent, setProductAnalyticsConsent } from "@/lib/server/product-analytics";
const url = new URL(process.env.DATABASE_URL ?? "https://disabled.invalid");
if (url.hostname !== "127.0.0.1" || url.port !== "53957" || url.pathname !== "/bundleen_analytics_test") throw new Error("Analytics integration suite requires its dedicated loopback test database.");
const userId = "analytics57_fixture_user";
const input = { userId, event: "payment_succeeded" as const, eventId: "evt_test_one", properties: { role: "homeowner" as const } };
beforeAll(async () => {
  vi.stubEnv("PRODUCT_ANALYTICS_ENABLED", "1"); vi.stubEnv("POSTHOG_PROJECT_KEY", "phc_test_only"); vi.stubEnv("POSTHOG_HOST", "https://us.i.posthog.com");
  await db.user.upsert({ where: { id: userId }, update: {}, create: { id: userId, clerkUserId: "analytics57_fixture", email: "analytics57@example.invalid", fullName: "Synthetic analytics fixture" } });
});
beforeEach(async () => {
  await db.productAnalyticsEvent.deleteMany({ where: { userId } });
  await setProductAnalyticsConsent(userId, true);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ status: 1 })));
});
afterAll(async () => { await db.user.delete({ where: { id: userId } }); await db.$disconnect(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("real PostgreSQL analytics lifecycle", () => {
  it("deduplicates concurrent retries in the business transaction", async () => {
    await Promise.all(Array.from({ length: 8 }, () => db.$transaction((tx) => enqueueProductEvent(tx, input))));
    expect(await db.productAnalyticsEvent.count({ where: { userId } })).toBe(1);
  });
  it("rolls back event with failed business transaction", async () => {
    await expect(db.$transaction(async (tx) => { await enqueueProductEvent(tx, input); throw new Error("business rollback"); })).rejects.toThrow("business rollback");
    expect(await db.productAnalyticsEvent.count({ where: { userId } })).toBe(0);
  });
  it("revocation deletes pending data and re-opt-in does not replay it", async () => {
    await db.$transaction((tx) => enqueueProductEvent(tx, input));
    await setProductAnalyticsConsent(userId, false); await setProductAnalyticsConsent(userId, true);
    await deliverProductAnalytics(); expect(fetch).not.toHaveBeenCalled();
  });
  it("concurrent drains send a queued event once", async () => {
    await db.$transaction((tx) => enqueueProductEvent(tx, input));
    await Promise.all([deliverProductAnalytics(), deliverProductAnalytics()]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await db.productAnalyticsEvent.count({ where: { userId, deliveredAt: { not: null } } })).toBe(1);
  });
  it("failed delivery remains pending and is backed off", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("synthetic outage")));
    await db.$transaction((tx) => enqueueProductEvent(tx, input));
    expect((await deliverProductAnalytics()).failed).toBe(1);
    const row = await db.productAnalyticsEvent.findFirstOrThrow({ where: { userId } });
    expect(row.deliveredAt).toBeNull(); expect(row.attempts).toBe(1); expect(row.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
  });
});
