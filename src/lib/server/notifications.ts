import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { after } from "next/server";

import type { NotificationKind } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { getEmailProvider } from "@/lib/server/email";
import { db } from "@/lib/server/db";

/**
 * Durable, idempotent notifications.
 *
 * Services build notification + outbox rows with {@link buildNotificationOps}
 * and include them in the same `$transaction` batch as the domain change, so a
 * committed award always has its notification intent recorded. Actual email
 * delivery happens later in {@link deliverPendingOutbox}; a mail-provider
 * outage can never roll back or block a domain write.
 *
 * Every row carries a deterministic `dedupeKey`, and both `createMany` calls
 * use `skipDuplicates`, so retries, refreshes, and concurrent mutations
 * produce exactly one record per intended event.
 */

export type NotificationIntent = {
  userId: string;
  /** Recipient address for the email copy; omit for in-app only. */
  email?: string | null;
  /** Security/transactional mail can bypass a homeowner's general mail opt-out. */
  emailPolicy?: "respect_preference" | "required";
  kind: NotificationKind;
  title: string;
  body: string;
  linkPath?: string | null;
  /**
   * Deterministic identity of this event for this user. Two calls with the
   * same key are the same event; a genuine change must change the key.
   */
  dedupeKey: string;
};

/** Stable short hash for building dedupe keys out of mutable content. */
export function contentHash(parts: readonly (string | number | null)[]): string {
  return createHash("sha256").update(parts.map(String).join("|")).digest("hex").slice(0, 16);
}

const MAX_OUTBOX_ATTEMPTS = 8;

type BatchOp = Prisma.PrismaPromise<unknown>;

function absoluteAppUrl(linkPath: string | null | undefined): string {
  const path = linkPath?.startsWith("/") ? linkPath : "/";
  const configuredBase =
    process.env.APP_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.VERCEL_PROJECT_PRODUCTION_URL ??
    process.env.VERCEL_URL;
  if (!configuredBase) return path;
  const base = /^https?:\/\//i.test(configuredBase)
    ? configuredBase
    : `https://${configuredBase}`;
  try {
    return new URL(path, base).toString();
  } catch {
    return path;
  }
}

/**
 * Kicks the durable outbox after the current response has been sent. The
 * domain mutation therefore stays fast and independent of Resend, while the
 * email normally arrives immediately instead of waiting for a cron window.
 */
export function scheduleOutboxDrain(): void {
  try {
    after(async () => {
      try {
        await deliverPendingOutbox(100);
      } catch (error) {
        console.error("[outbox] real-time drain failed", {
          name: error instanceof Error ? error.name : "UnknownError",
        });
      }
    });
  } catch {
    // Service-level unit tests and maintenance scripts have no Next request
    // lifecycle. Their caller (or the scheduled recovery worker) owns draining.
  }
}

/**
 * Returns the `createMany` operations for a set of notification intents, ready
 * to be spread into the caller's `$transaction` batch.
 */
export function buildNotificationOps(intents: readonly NotificationIntent[]): BatchOp[] {
  if (intents.length === 0) return [];

  const notificationRows = intents.map((intent) => ({
    id: randomUUID(),
    userId: intent.userId,
    kind: intent.kind,
    title: intent.title.slice(0, 200),
    body: intent.body.slice(0, 1_000),
    linkPath: intent.linkPath ?? null,
    dedupeKey: intent.dedupeKey,
  }));

  const outboxRows = intents
    .filter((intent) => Boolean(intent.email))
    .map((intent) => ({
      id: randomUUID(),
      kind: "notification_email",
      dedupeKey: `email:${intent.dedupeKey}`,
      payload: {
        to: intent.email as string,
        subject: intent.title.slice(0, 200),
        text: `${intent.body.slice(0, 1_000)}\n\nOpen Bundleen: ${absoluteAppUrl(intent.linkPath)}`,
      },
      updatedAt: new Date(),
    }));

  const ops: BatchOp[] = [
    db.notification.createMany({ data: notificationRows, skipDuplicates: true }),
  ];
  if (outboxRows.length > 0) {
    ops.push(db.outboxEvent.createMany({ data: outboxRows, skipDuplicates: true }));
  }
  return ops;
}

/**
 * Applies the persisted homeowner email preference while always retaining the
 * in-app notification. Providers have separate job preferences and accounts
 * without a HomeownerProfile are unaffected.
 */
export async function buildPreferenceAwareNotificationOps(
  intents: readonly NotificationIntent[],
): Promise<BatchOp[]> {
  if (intents.length === 0) return [];

  const preferenceControlledIds = [
    ...new Set(
      intents
        .filter(
          (intent) => Boolean(intent.email) && intent.emailPolicy !== "required",
        )
        .map((intent) => intent.userId),
    ),
  ];
  const optedOut = new Set<string>();
  if (preferenceControlledIds.length > 0) {
    const profiles = await db.homeownerProfile.findMany({
      where: {
        userId: { in: preferenceControlledIds },
        notifyEmail: false,
        user: { role: "homeowner" },
      },
      select: { userId: true },
    });
    for (const profile of profiles) optedOut.add(profile.userId);
  }

  const ops = buildNotificationOps(
    intents.map((intent) =>
      optedOut.has(intent.userId) ? { ...intent, email: null } : intent,
    ),
  );
  if (intents.some((intent) => Boolean(intent.email))) scheduleOutboxDrain();
  return ops;
}

/** Queues a standalone notification outside another domain transaction. */
export async function enqueueNotifications(
  intents: readonly NotificationIntent[],
): Promise<void> {
  const ops = await buildPreferenceAwareNotificationOps(intents);
  if (ops.length > 0) await db.$transaction(ops);
}

/**
 * Materializes reminders for scheduled visits due in the next 24 hours.
 * Deterministic keys make the daily safety job safe to retry or overlap.
 */
export async function enqueueUpcomingServiceReminders(now = new Date()): Promise<number> {
  const horizon = new Date(now.getTime() + 24 * 60 * 60 * 1_000);
  const visits = await db.serviceVisit.findMany({
    where: {
      status: "scheduled",
      scheduledDate: { gt: now, lte: horizon },
      occurrence: { status: { in: ["planned", "in_progress"] }, agreement: { status: "active" } },
    },
    select: {
      id: true,
      scheduledDate: true,
      windowStart: true,
      windowEnd: true,
      unit: {
        select: {
          label: true,
          memberships: {
            where: { status: "active" },
            select: { user: { select: { id: true, email: true } } },
            take: 1,
          },
        },
      },
      occurrence: {
        select: {
          id: true,
          agreement: {
            select: {
              provider: { select: { id: true, email: true } },
              request: { select: { title: true } },
              community: {
                select: {
                  name: true,
                  staffAssignments: {
                    where: { role: "hoa_manager", status: "active" },
                    select: { user: { select: { id: true, email: true } } },
                    take: 1,
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  const intents: NotificationIntent[] = [];
  const occurrenceRecipients = new Set<string>();
  for (const visit of visits) {
    const agreement = visit.occurrence.agreement;
    const dateLabel = visit.scheduledDate?.toISOString().slice(0, 10) ?? "tomorrow";
    const window =
      visit.windowStart && visit.windowEnd
        ? ` between ${visit.windowStart} and ${visit.windowEnd}`
        : "";
    const resident = visit.unit.memberships[0]?.user;
    if (resident) {
      intents.push({
        userId: resident.id,
        email: resident.email,
        kind: "reminder",
        title: `Upcoming service at ${visit.unit.label}`,
        body: `“${agreement.request.title}” is scheduled for ${dateLabel}${window}.`,
        linkPath: "/app/homeowner/community",
        dedupeKey: `service-reminder-resident:${visit.id}:${dateLabel}`,
      });
    }

    const providerKey = `${visit.occurrence.id}:${agreement.provider.id}`;
    if (!occurrenceRecipients.has(providerKey)) {
      occurrenceRecipients.add(providerKey);
      intents.push({
        userId: agreement.provider.id,
        email: agreement.provider.email,
        kind: "reminder",
        title: `Upcoming service day for ${agreement.community.name}`,
        body: `“${agreement.request.title}” is scheduled for ${dateLabel}. Review your route before starting.`,
        linkPath: "/app/provider/hoa",
        dedupeKey: `service-reminder-provider:${visit.occurrence.id}:${dateLabel}`,
      });
    }

    const manager = agreement.community.staffAssignments[0]?.user;
    const managerKey = manager ? `${visit.occurrence.id}:${manager.id}` : null;
    if (manager && managerKey && !occurrenceRecipients.has(managerKey)) {
      occurrenceRecipients.add(managerKey);
      intents.push({
        userId: manager.id,
        email: manager.email,
        kind: "reminder",
        title: `Upcoming service day for ${agreement.community.name}`,
        body: `“${agreement.request.title}” is scheduled for ${dateLabel}.`,
        linkPath: "/app/hoa/dashboard",
        dedupeKey: `service-reminder-manager:${visit.occurrence.id}:${dateLabel}`,
      });
    }
  }

  await enqueueNotifications(intents);
  return intents.length;
}

export type OutboxDrainResult = {
  claimed: number;
  delivered: number;
  failed: number;
};

function backoffMinutes(attempts: number): number {
  return Math.min(60, 2 ** attempts);
}

/**
 * Drains due outbox events. Safe to call concurrently: each event is claimed
 * with an optimistic `updateMany` on its previous state, so two workers cannot
 * deliver the same event twice.
 */
export async function deliverPendingOutbox(limit = 25): Promise<OutboxDrainResult> {
  const now = new Date();
  const candidates = await db.outboxEvent.findMany({
    where: { status: "pending", nextAttemptAt: { lte: now } },
    orderBy: { nextAttemptAt: "asc" },
    take: Math.min(Math.max(limit, 1), 100),
    select: { id: true, kind: true, dedupeKey: true, payload: true, attempts: true },
  });

  const result: OutboxDrainResult = { claimed: 0, delivered: 0, failed: 0 };
  if (candidates.length === 0) return result;

  const provider = getEmailProvider();

  for (const event of candidates) {
    const claim = await db.outboxEvent.updateMany({
      where: { id: event.id, status: "pending", attempts: event.attempts },
      data: {
        attempts: { increment: 1 },
        nextAttemptAt: new Date(now.getTime() + backoffMinutes(event.attempts + 1) * 60_000),
      },
    });
    if (claim.count === 0) continue;
    result.claimed += 1;

    try {
      if (event.kind !== "notification_email") {
        throw new Error(`unknown outbox kind ${event.kind}`);
      }
      const payload = event.payload as { to?: string; subject?: string; text?: string };
      if (!payload.to || !payload.subject || !payload.text) {
        throw new Error("outbox payload is incomplete");
      }
      const delivery = await provider.send({
        to: payload.to,
        subject: payload.subject,
        text: payload.text,
        idempotencyKey: event.dedupeKey,
      });
      await db.outboxEvent.update({
        where: { id: event.id },
        data: {
          status: "delivered",
          deliveredAt: new Date(),
          providerMessageId: delivery.providerMessageId,
          lastError: null,
        },
      });
      result.delivered += 1;
    } catch (error) {
      const attemptsUsed = event.attempts + 1;
      await db.outboxEvent
        .update({
          where: { id: event.id },
          data: {
            lastError:
              error instanceof Error ? error.message.slice(0, 500) : "delivery failed",
            ...(attemptsUsed >= MAX_OUTBOX_ATTEMPTS ? { status: "failed" } : {}),
          },
        })
        .catch(() => undefined);
      result.failed += 1;
    }
  }

  return result;
}

/* ── Reading ─────────────────────────────────────────────────────────────── */

export async function listNotifications(userId: string, limit = 30) {
  const rows = await db.notification.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 100),
    select: {
      id: true,
      kind: true,
      title: true,
      body: true,
      linkPath: true,
      readAt: true,
      createdAt: true,
    },
  });
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    linkPath: row.linkPath,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function markNotificationsRead(userId: string): Promise<void> {
  await db.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
}

export async function markNotificationRead(userId: string, notificationId: string): Promise<boolean> {
  const result = await db.notification.updateMany({
    where: { id: notificationId, userId, readAt: null },
    data: { readAt: new Date() },
  });
  return result.count > 0;
}

export async function dismissNotification(userId: string, notificationId: string): Promise<boolean> {
  const result = await db.notification.deleteMany({
    where: { id: notificationId, userId },
  });
  return result.count > 0;
}
