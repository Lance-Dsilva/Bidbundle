import "server-only";

import { createHash, randomUUID } from "node:crypto";

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
        text: `${intent.body.slice(0, 1_000)}\n\nOpen Bundleen: ${intent.linkPath ?? "/"}`,
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
    select: { id: true, kind: true, payload: true, attempts: true },
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
