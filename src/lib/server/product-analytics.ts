import "server-only";
import { createHash } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/server/db";
import { ANALYTICS_CONSENT_VERSION, productEventSchema, productPropertiesSchema, type ProductEvent, type ProductProperties } from "@/lib/analytics/events";

type Store = Pick<Prisma.TransactionClient, "productAnalyticsConsent" | "productAnalyticsEvent" | "$queryRaw">;
export type ProductEventInput = { userId: string; event: ProductEvent; eventId: string; properties: ProductProperties };

export function analyticsConfig() {
  const key = process.env.POSTHOG_PROJECT_KEY;
  const host = process.env.POSTHOG_HOST;
  // Only documented ingestion regions. No arbitrary outbound URL / SSRF.
  if (process.env.PRODUCT_ANALYTICS_ENABLED !== "1" || !key?.startsWith("phc_") || !["https://us.i.posthog.com", "https://eu.i.posthog.com"].includes(host ?? "")) return null;
  return { key, host: host! };
}

export function productEventUuid(input: Pick<ProductEventInput, "userId" | "event" | "eventId">): string {
  const hex = createHash("sha256").update(JSON.stringify([input.userId, input.event, input.eventId])).digest("hex");
  // Stable UUID across retries; neither raw business ID nor event token leaves the server.
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** Use inside the same business transaction when the event must be atomic
 * (especially Stripe webhook transitions). No network call in this method. */
export async function enqueueProductEvent(tx: Store, input: ProductEventInput): Promise<boolean> {
  if (!analyticsConfig()) return false;
  const event = productEventSchema.parse(input.event);
  const properties = productPropertiesSchema.parse(input.properties);
  if (!input.eventId || input.eventId.length > 256) throw new Error("Invalid analytics event identity.");
  await tx.$queryRaw`SELECT "userId" FROM "ProductAnalyticsConsent" WHERE "userId" = ${input.userId} FOR UPDATE`;
  const consent = await tx.productAnalyticsConsent.findUnique({ where: { userId: input.userId } });
  if (!consent?.allowed || consent.version !== ANALYTICS_CONSENT_VERSION) return false;
  const id = productEventUuid(input);
  await tx.productAnalyticsEvent.upsert({ where: { id }, create: { id, userId: input.userId, event, properties }, update: {} });
  return true;
}

/** Best effort for already committed nonfinancial actions. Analytics failure
 * must never turn a successful business operation into a client-facing failure. */
export async function captureProductEvent(input: ProductEventInput): Promise<void> {
  if (!analyticsConfig()) return;
  try { await db.$transaction((tx) => enqueueProductEvent(tx, input)); }
  catch { console.warn("[analytics] optional event enqueue failed"); }
}

export async function setProductAnalyticsConsent(userId: string, allowed: boolean): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.productAnalyticsConsent.upsert({ where: { userId }, create: { userId, allowed, version: ANALYTICS_CONSENT_VERSION }, update: { allowed, version: ANALYTICS_CONSENT_VERSION } });
    // Revocation removes queued data so opting in again cannot replay it.
    if (!allowed) await tx.productAnalyticsEvent.deleteMany({ where: { userId, deliveredAt: null } });
  });
}

export function posthogPayload(row: { id: string; userId: string; event: string; properties: unknown; occurredAt: Date }, key: string) {
  return {
    api_key: key,
    distinct_id: row.userId,
    event: productEventSchema.parse(row.event),
    uuid: row.id,
    timestamp: row.occurredAt.toISOString(),
    properties: {
      ...productPropertiesSchema.parse(row.properties),
      $process_person_profile: false,
      $geoip_disable: true,
      $ip: null,
    },
  };
}

/** Bounded, durable, at-least-once worker with stable event UUIDs. Locks make
 * concurrent drains safe; consent is rechecked immediately before export.
 * Revocation serializes with any in-flight export and suppresses later ones. */
export async function deliverProductAnalytics(limit = 10): Promise<{ delivered: number; suppressed: number; failed: number }> {
  const result = { delivered: 0, suppressed: 0, failed: 0 };
  const config = analyticsConfig();
  if (!config) return result;
  const rows = await db.productAnalyticsEvent.findMany({ where: { deliveredAt: null, nextAttemptAt: { lte: new Date() } }, orderBy: { occurredAt: "asc" }, take: Math.min(Math.max(limit, 1), 10), select: { id: true, userId: true } });
  for (const candidate of rows) {
    await db.$transaction(async (tx) => {
      // Same lock order as consent update/delete prevents deadlocks.
      await tx.$queryRaw`SELECT "userId" FROM "ProductAnalyticsConsent" WHERE "userId" = ${candidate.userId} FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "ProductAnalyticsEvent" WHERE "id" = ${candidate.id} FOR UPDATE`;
      const row = await tx.productAnalyticsEvent.findUnique({ where: { id: candidate.id } });
      if (!row || row.deliveredAt || row.nextAttemptAt > new Date()) return;
      const consent = await tx.productAnalyticsConsent.findUnique({ where: { userId: row.userId } });
      if (!consent?.allowed || consent.version !== ANALYTICS_CONSENT_VERSION) {
        await tx.productAnalyticsEvent.delete({ where: { id: row.id } }); result.suppressed++; return;
      }
      try {
        const response = await fetch(`${config.host}/i/v0/e/`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(posthogPayload(row, config.key)), signal: AbortSignal.timeout(3000),
          redirect: "error", cache: "no-store",
        });
        if (!response.ok) throw new Error("Analytics transport rejected event.");
        const body: unknown = await response.json();
        if (!body || typeof body !== "object" || ("quota_limited" in body && (Array.isArray(body.quota_limited) ? body.quota_limited.length > 0 : Boolean(body.quota_limited)))) throw new Error("Analytics quota unavailable.");
        await tx.productAnalyticsEvent.update({ where: { id: row.id }, data: { deliveredAt: new Date(), attempts: { increment: 1 } } });
        result.delivered++;
      } catch {
        await tx.productAnalyticsEvent.update({ where: { id: row.id }, data: { attempts: { increment: 1 }, nextAttemptAt: new Date(Date.now() + Math.min(3600000, 60000 * 2 ** Math.min(row.attempts, 6))) } });
        result.failed++;
      }
    }, { timeout: 5000 });
  }
  return result;
}

/** Call only after the existing authorization/business operation succeeds.
 * Context comes from stored records, never arbitrary browser properties. */
export async function captureRequestProductEvent(userId: string, event: ProductEvent, requestId: string, eventId: string, role: ProductProperties["role"]): Promise<void> {
  if (!analyticsConfig()) return;
  try {
    const request = await db.hoaServiceRequest.findUnique({ where: { id: requestId }, select: { id: true, communityId: true, category: true } });
    if (!request) return;
    const category = productPropertiesSchema.shape.category.safeParse(request.category);
    await captureProductEvent({ userId, event, eventId, properties: { requestId: request.id, communityId: request.communityId, ...(category.success ? { category: category.data } : {}), role } });
  } catch { console.warn("[analytics] optional context lookup failed"); }
}

export async function captureVisitProductEvent(visitId: string, event: "visit_completed" | "review_submitted", actorUserId?: string): Promise<void> {
  if (!analyticsConfig()) return;
  try {
    const visit = await db.serviceVisit.findUnique({ where: { id: visitId }, select: { homeownerUserId: true, status: true, occurrence: { select: { agreement: { select: { requestId: true } } } } } });
    if (!visit || visit.status !== "completed") return;
    const userId = actorUserId ?? visit.homeownerUserId;
    if (!userId) return;
    await captureRequestProductEvent(userId, event, visit.occurrence.agreement.requestId, visitId, "homeowner");
  } catch { console.warn("[analytics] optional visit context lookup failed"); }
}

/** Optional measurement must not invalidate a successful operational drain. */
export async function deliverOptionalProductAnalytics() {
  try { return { ...await deliverProductAnalytics(), unavailable: false }; }
  catch {
    console.warn("[analytics] optional delivery unavailable");
    return { delivered: 0, suppressed: 0, failed: 0, unavailable: true };
  }
}
