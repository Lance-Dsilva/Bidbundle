import "server-only";

import { randomUUID } from "node:crypto";

import type { Prisma } from "@/generated/prisma/client";
import type { BroadcastSeverity, BroadcastStatus } from "@/generated/prisma/enums";
import { buildAuditEntry } from "@/lib/server/audit";
import { db } from "@/lib/server/db";
import { deliverPendingOutbox, scheduleOutboxDrain } from "@/lib/server/notifications";
import type {
  BroadcastDraftInput,
  BroadcastSegment,
  BroadcastSendInput,
} from "@/lib/validation/communications";
import { URGENT_OPERATIONAL_SEVERITIES } from "@/lib/validation/communications";

/**
 * Platform-wide operational email.
 *
 * The design constraints that shape this module:
 *
 * - **Nothing sends inside a request handler.** {@link sendBroadcast} writes
 *   `BroadcastRecipient` rows and `OutboxEvent` rows, then returns. The
 *   existing outbox worker (real-time drain plus the scheduled cron recovery)
 *   does the delivery, so a request cannot time out halfway through a mailing.
 * - **Retries cannot duplicate.** Recipient rows are unique per
 *   `(broadcastId, userId)` and per `(broadcastId, email)`, and every outbox
 *   row carries a stable `broadcast:{id}:{recipientId}` dedupe key. Re-running
 *   send inserts nothing new and therefore sends nothing new.
 * - **Preferences are honoured by default.** A general announcement respects
 *   `notifyEmail`. Only a clearly classified urgent operational message, with
 *   the admin's explicit confirmation, reaches an opted-out account — and that
 *   fact is written to the immutable audit log.
 */

export class BroadcastError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "BroadcastError";
    this.status = status;
  }
}

/** Resend's documented per-request ceiling for a batched send. */
const RECIPIENT_BATCH_SIZE = 100;
/** Hard cap per broadcast, so a misconfiguration cannot mail the whole world. */
const MAX_RECIPIENTS = 50_000;
const PREVIEW_SAMPLE_SIZE = 5;

const SEVERITY_PREFIX: Record<BroadcastSeverity, string> = {
  announcement: "Bundleen update",
  maintenance: "Planned maintenance",
  degraded: "Service degradation",
  outage: "Service outage",
  security: "Security notice",
};

export function broadcastBypassesPreference(input: {
  severity: BroadcastSeverity;
  overridesEmailPreference: boolean;
}): boolean {
  return (
    input.overridesEmailPreference &&
    (URGENT_OPERATIONAL_SEVERITIES as readonly string[]).includes(input.severity)
  );
}

/* ── Audience ────────────────────────────────────────────────────────────── */

/**
 * Turns named segments into a database filter over live accounts.
 *
 * `hoa_manager` is not a global role in Bundleen — it is a scoped, revocable
 * assignment — so that segment is expressed as "has an active hoa_manager or
 * hoa_team assignment", which is the only truthful reading of it.
 */
function audienceWhere(segments: readonly BroadcastSegment[]): Prisma.UserWhereInput {
  const base: Prisma.UserWhereInput = {
    // Never mail an unverified address: it may belong to someone else.
    isVerified: true,
    email: { contains: "@" },
  };

  if (segments.length === 0) {
    // "All active users" excludes staff accounts, which have their own
    // channels and are not customers.
    return { ...base, role: { in: ["homeowner", "provider"] } };
  }

  const clauses: Prisma.UserWhereInput[] = [];
  if (segments.includes("homeowner")) {
    clauses.push({ role: "homeowner" });
  }
  if (segments.includes("provider")) {
    clauses.push({ role: "provider" });
  }
  if (segments.includes("hoa_manager")) {
    clauses.push({
      staffAssignments: {
        some: { status: "active", role: { in: ["hoa_manager", "hoa_team"] } },
      },
    });
  }
  return { ...base, OR: clauses };
}

export type BroadcastPreview = {
  recipientCount: number;
  /** A handful of real addresses so an admin can sanity-check the audience. */
  sample: { name: string; email: string; role: string }[];
  /** How many of those would be skipped if preferences were respected. */
  optedOutCount: number;
  bypassesPreference: boolean;
  segments: BroadcastSegment[];
};

/**
 * The server-calculated audience. Never a client estimate — this number is what
 * the confirmation screen shows and what {@link sendBroadcast} re-checks.
 */
export async function previewBroadcastAudience(input: {
  audienceSegments: readonly BroadcastSegment[];
  severity: BroadcastSeverity;
  overridesEmailPreference: boolean;
}): Promise<BroadcastPreview> {
  const where = audienceWhere(input.audienceSegments);
  const bypassesPreference = broadcastBypassesPreference(input);

  const [recipientCount, optedOutCount, sample] = await Promise.all([
    db.user.count({ where }),
    db.user.count({
      where: { ...where, homeownerProfile: { notifyEmail: false } },
    }),
    db.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: PREVIEW_SAMPLE_SIZE,
      select: { fullName: true, email: true, role: true },
    }),
  ]);

  return {
    // What will actually be mailed: everyone, or everyone minus opt-outs.
    recipientCount: bypassesPreference ? recipientCount : recipientCount - optedOutCount,
    sample: sample.map((user) => ({
      name: user.fullName,
      email: user.email,
      role: user.role,
    })),
    optedOutCount,
    bypassesPreference,
    segments: [...input.audienceSegments],
  };
}

/* ── Composition ─────────────────────────────────────────────────────────── */

export type BroadcastView = {
  id: string;
  subject: string;
  body: string;
  severity: BroadcastSeverity;
  status: BroadcastStatus;
  inAppTitle: string | null;
  inAppBody: string | null;
  linkPath: string | null;
  audienceSegments: string[];
  overridesEmailPreference: boolean;
  recipientCount: number;
  createdByName: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  queuedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  delivery: { sent: number; pending: number; failed: number; suppressed: number };
};

const broadcastSelect = {
  id: true,
  subject: true,
  body: true,
  severity: true,
  status: true,
  inAppTitle: true,
  inAppBody: true,
  linkPath: true,
  audienceSegments: true,
  overridesEmailPreference: true,
  recipientCount: true,
  approvedAt: true,
  queuedAt: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: { fullName: true } },
  approvedBy: { select: { fullName: true } },
} satisfies Prisma.BroadcastSelect;

type BroadcastRow = Prisma.BroadcastGetPayload<{ select: typeof broadcastSelect }>;

async function serializeBroadcast(row: BroadcastRow): Promise<BroadcastView> {
  const counts = await db.broadcastRecipient.groupBy({
    by: ["status"],
    where: { broadcastId: row.id },
    _count: { _all: true },
  });
  const delivery = { sent: 0, pending: 0, failed: 0, suppressed: 0 };
  for (const entry of counts) delivery[entry.status] = entry._count._all;

  return {
    id: row.id,
    subject: row.subject,
    body: row.body,
    severity: row.severity,
    status: row.status,
    inAppTitle: row.inAppTitle,
    inAppBody: row.inAppBody,
    linkPath: row.linkPath,
    audienceSegments: row.audienceSegments,
    overridesEmailPreference: row.overridesEmailPreference,
    recipientCount: row.recipientCount,
    createdByName: row.createdBy?.fullName ?? null,
    approvedByName: row.approvedBy?.fullName ?? null,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    queuedAt: row.queuedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    delivery,
  };
}

export async function listBroadcasts(options?: {
  search?: string;
  limit?: number;
}): Promise<BroadcastView[]> {
  const where: Prisma.BroadcastWhereInput = options?.search
    ? {
        OR: [
          { subject: { contains: options.search, mode: "insensitive" } },
          { body: { contains: options.search, mode: "insensitive" } },
        ],
      }
    : {};

  const rows = await db.broadcast.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(options?.limit ?? 50, 1), 100),
    select: broadcastSelect,
  });
  return Promise.all(rows.map(serializeBroadcast));
}

export async function getBroadcast(broadcastId: string): Promise<BroadcastView | null> {
  const row = await db.broadcast.findUnique({
    where: { id: broadcastId },
    select: broadcastSelect,
  });
  return row ? serializeBroadcast(row) : null;
}

export async function createBroadcastDraft(
  adminUserId: string,
  input: BroadcastDraftInput,
): Promise<BroadcastView> {
  const id = randomUUID();
  await db.$transaction([
    db.broadcast.create({
      data: {
        id,
        subject: input.subject,
        body: input.body,
        severity: input.severity,
        inAppTitle: input.inAppTitle,
        inAppBody: input.inAppBody,
        linkPath: input.linkPath,
        audienceSegments: input.audienceSegments,
        overridesEmailPreference: input.overridesEmailPreference,
        createdByUserId: adminUserId,
        status: "draft",
      },
    }),
    db.adminAuditLog.create({
      data: buildAuditEntry({
        actorUserId: adminUserId,
        action: "broadcast_created",
        targetType: "broadcast",
        targetId: id,
        metadata: { kind: input.severity, status: "draft" },
      }),
    }),
  ]);

  const created = await getBroadcast(id);
  if (!created) throw new BroadcastError("The draft could not be created.", 500);
  return created;
}

export async function updateBroadcastDraft(
  adminUserId: string,
  broadcastId: string,
  input: BroadcastDraftInput,
): Promise<BroadcastView> {
  // Only a draft is editable. Once queued the content is the historical record
  // of what customers were told, so it must not be rewritten afterwards.
  const result = await db.broadcast.updateMany({
    where: { id: broadcastId, status: "draft" },
    data: {
      subject: input.subject,
      body: input.body,
      severity: input.severity,
      inAppTitle: input.inAppTitle,
      inAppBody: input.inAppBody,
      linkPath: input.linkPath,
      audienceSegments: input.audienceSegments,
      overridesEmailPreference: input.overridesEmailPreference,
    },
  });
  if (result.count === 0) {
    throw new BroadcastError("Only a draft can be edited.", 409);
  }

  await db.adminAuditLog.create({
    data: buildAuditEntry({
      actorUserId: adminUserId,
      action: "broadcast_updated",
      targetType: "broadcast",
      targetId: broadcastId,
      metadata: { kind: input.severity, status: "draft" },
    }),
  });

  const updated = await getBroadcast(broadcastId);
  if (!updated) throw new BroadcastError("That broadcast does not exist.", 404);
  return updated;
}

export async function discardBroadcastDraft(
  adminUserId: string,
  broadcastId: string,
): Promise<void> {
  const result = await db.broadcast.updateMany({
    where: { id: broadcastId, status: "draft" },
    data: { status: "cancelled" },
  });
  if (result.count === 0) throw new BroadcastError("Only a draft can be discarded.", 409);

  await db.adminAuditLog.create({
    data: buildAuditEntry({
      actorUserId: adminUserId,
      action: "broadcast_discarded",
      targetType: "broadcast",
      targetId: broadcastId,
      metadata: { status: "cancelled" },
    }),
  });
}

/* ── Message rendering ───────────────────────────────────────────────────── */

/**
 * The email body.
 *
 * Plain text on purpose. Bundleen's outbox sends `text`, so admin-entered
 * content is never parsed as markup by any client and there is no template
 * escaping problem to get wrong — a `<script>` in the body arrives as those
 * characters. The severity prefix is server-chosen from a closed map, not
 * from admin input.
 */
export function renderBroadcastEmail(broadcast: {
  subject: string;
  body: string;
  severity: BroadcastSeverity;
  linkPath: string | null;
  overridesEmailPreference: boolean;
}): { subject: string; text: string } {
  const lines = [
    broadcast.body,
    "",
    broadcast.linkPath ? `More detail: ${broadcast.linkPath}` : null,
    broadcast.overridesEmailPreference
      ? "You are receiving this because it is an urgent operational notice about your Bundleen account. Operational notices are sent regardless of your announcement email preference."
      : "You are receiving this because you have announcement emails enabled for your Bundleen account.",
  ].filter((line): line is string => line !== null);

  return {
    subject: `[${SEVERITY_PREFIX[broadcast.severity]}] ${broadcast.subject}`,
    text: lines.join("\n"),
  };
}

/* ── Test send ───────────────────────────────────────────────────────────── */

/**
 * Sends the rendered message to the requesting admin and nobody else.
 *
 * Deliberately does not create `BroadcastRecipient` rows: a test is not a
 * delivery, and counting it as one would corrupt the record of who was
 * actually mailed.
 */
export async function sendBroadcastTest(
  admin: { id: string; email: string },
  broadcastId: string,
): Promise<void> {
  const broadcast = await db.broadcast.findUnique({
    where: { id: broadcastId },
    select: {
      id: true,
      subject: true,
      body: true,
      severity: true,
      linkPath: true,
      overridesEmailPreference: true,
    },
  });
  if (!broadcast) throw new BroadcastError("That broadcast does not exist.", 404);

  const rendered = renderBroadcastEmail(broadcast);
  await db.$transaction([
    db.outboxEvent.createMany({
      data: [
        {
          id: randomUUID(),
          kind: "notification_email",
          // Timestamped so an admin can send more than one test while editing,
          // while the key stays stable enough for provider-side deduping.
          dedupeKey: `broadcast-test:${broadcastId}:${admin.id}:${Date.now()}`,
          payload: {
            to: admin.email,
            subject: `[TEST] ${rendered.subject}`,
            text: `This is a test copy sent only to you. No customer received it.\n\n${rendered.text}`,
          },
          updatedAt: new Date(),
        },
      ],
      skipDuplicates: true,
    }),
    db.adminAuditLog.create({
      data: buildAuditEntry({
        actorUserId: admin.id,
        action: "broadcast_test_sent",
        targetType: "broadcast",
        targetId: broadcastId,
        metadata: { kind: broadcast.severity },
      }),
    }),
  ]);

  scheduleOutboxDrain();
}

/* ── Global send ─────────────────────────────────────────────────────────── */

export type BroadcastSendResult = {
  broadcast: BroadcastView;
  queued: number;
  suppressed: number;
};

/**
 * Materializes recipients and enqueues delivery. Idempotent.
 *
 * Everything is `createMany({ skipDuplicates: true })` against the unique
 * constraints, so calling this twice — a double click, a retried request, a
 * recovered timeout — produces the same rows and therefore the same emails.
 * A broadcast that is already past `draft` is rejected outright rather than
 * re-queued.
 */
export async function sendBroadcast(
  admin: { id: string; email: string },
  broadcastId: string,
  input: BroadcastSendInput,
): Promise<BroadcastSendResult> {
  const broadcast = await db.broadcast.findUnique({
    where: { id: broadcastId },
    select: {
      id: true,
      subject: true,
      body: true,
      severity: true,
      status: true,
      linkPath: true,
      inAppTitle: true,
      inAppBody: true,
      audienceSegments: true,
      overridesEmailPreference: true,
    },
  });
  if (!broadcast) throw new BroadcastError("That broadcast does not exist.", 404);
  if (broadcast.status !== "draft") {
    throw new BroadcastError("This broadcast has already been sent.", 409);
  }

  const segments = broadcast.audienceSegments as BroadcastSegment[];
  const bypassesPreference = broadcastBypassesPreference(broadcast);

  const preview = await previewBroadcastAudience({
    audienceSegments: segments,
    severity: broadcast.severity,
    overridesEmailPreference: broadcast.overridesEmailPreference,
  });

  // The admin confirmed a specific number on the review screen. If the audience
  // moved materially since then, stop and make them look again rather than
  // mailing a set they never approved.
  const drift = Math.abs(preview.recipientCount - input.acknowledgedRecipientCount);
  if (drift > Math.max(5, Math.ceil(input.acknowledgedRecipientCount * 0.05))) {
    throw new BroadcastError(
      `The audience changed from ${input.acknowledgedRecipientCount} to ${preview.recipientCount} recipients since you reviewed it. Re-check the preview and confirm again.`,
      409,
    );
  }
  if (preview.recipientCount === 0) {
    throw new BroadcastError("This audience currently has no recipients.", 400);
  }
  if (preview.recipientCount > MAX_RECIPIENTS) {
    throw new BroadcastError(
      `This audience is larger than the ${MAX_RECIPIENTS.toLocaleString()} recipient safety ceiling.`,
      400,
    );
  }

  const now = new Date();
  await db.broadcast.update({
    where: { id: broadcastId },
    data: {
      status: "processing",
      approvedByUserId: admin.id,
      approvedAt: now,
      queuedAt: now,
      recipientCount: preview.recipientCount,
    },
  });

  const where = audienceWhere(segments);
  const rendered = renderBroadcastEmail(broadcast);

  let queued = 0;
  let suppressed = 0;
  let cursor: string | undefined;

  // Paged rather than loaded at once: 50k users must not become 50k objects in
  // one serverless function's heap.
  for (;;) {
    const users = await db.user.findMany({
      where,
      orderBy: { id: "asc" },
      take: RECIPIENT_BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      select: {
        id: true,
        email: true,
        homeownerProfile: { select: { notifyEmail: true } },
      },
    });
    if (users.length === 0) break;
    cursor = users[users.length - 1]!.id;

    const seenEmails = new Set<string>();
    const recipientRows: Prisma.BroadcastRecipientCreateManyInput[] = [];
    const outboxRows: Prisma.OutboxEventCreateManyInput[] = [];
    const notificationRows: Prisma.NotificationCreateManyInput[] = [];

    for (const user of users) {
      const email = user.email.trim().toLowerCase();
      // Two accounts sharing an address would otherwise get the message twice.
      // The `(broadcastId, email)` unique index catches this across batches;
      // this set catches it within one.
      if (!email.includes("@") || seenEmails.has(email)) continue;
      seenEmails.add(email);

      const optedOut = user.homeownerProfile?.notifyEmail === false;
      const recipientId = randomUUID();

      if (optedOut && !bypassesPreference) {
        suppressed += 1;
        recipientRows.push({
          id: recipientId,
          broadcastId,
          userId: user.id,
          email,
          status: "suppressed",
          suppressedReason: "preference_opt_out",
        });
        continue;
      }

      queued += 1;
      recipientRows.push({
        id: recipientId,
        broadcastId,
        userId: user.id,
        email,
        status: "pending",
      });
      outboxRows.push({
        id: randomUUID(),
        kind: "notification_email",
        // Stable per broadcast and per recipient: this is the key that makes a
        // retry a no-op, both in our table and at Resend.
        dedupeKey: `broadcast:${broadcastId}:${user.id}`,
        payload: { to: email, subject: rendered.subject, text: rendered.text },
        updatedAt: now,
      });

      if (broadcast.inAppTitle && broadcast.inAppBody) {
        notificationRows.push({
          id: randomUUID(),
          userId: user.id,
          // `security` keeps broadcast counters out of the support-ticket and
          // marketplace notification kinds.
          kind: broadcast.severity === "security" ? "security" : "account",
          title: broadcast.inAppTitle,
          body: broadcast.inAppBody,
          linkPath: broadcast.linkPath,
          dedupeKey: `broadcast-inapp:${broadcastId}:${user.id}`,
        });
      }
    }

    await db.$transaction([
      db.broadcastRecipient.createMany({ data: recipientRows, skipDuplicates: true }),
      ...(outboxRows.length > 0
        ? [db.outboxEvent.createMany({ data: outboxRows, skipDuplicates: true })]
        : []),
      ...(notificationRows.length > 0
        ? [db.notification.createMany({ data: notificationRows, skipDuplicates: true })]
        : []),
    ]);
  }

  await db.$transaction([
    db.broadcast.update({
      where: { id: broadcastId },
      data: { status: "queued", recipientCount: queued },
    }),
    db.adminAuditLog.create({
      data: buildAuditEntry({
        actorUserId: admin.id,
        action: "broadcast_sent",
        targetType: "broadcast",
        targetId: broadcastId,
        metadata: {
          kind: broadcast.severity,
          status: "queued",
          // The preference override is the fact that most needs to be
          // permanently reviewable after the incident.
          isPrimary: bypassesPreference,
          updatedCount: queued,
          duplicateCount: suppressed,
        },
      }),
    }),
  ]);

  // Kick the outbox now; the scheduled cron remains the recovery path if this
  // request's `after()` never runs.
  scheduleOutboxDrain();

  const view = await getBroadcast(broadcastId);
  if (!view) throw new BroadcastError("That broadcast does not exist.", 404);
  return { broadcast: view, queued, suppressed };
}

/**
 * Reconciles a broadcast against its outbox rows and marks it complete.
 *
 * Called after a drain so the admin's delivery summary reflects what the worker
 * actually achieved rather than what was queued. Failures stay retryable: the
 * outbox owns its own backoff, and this only reports.
 */
export async function reconcileBroadcastDelivery(broadcastId: string): Promise<BroadcastView> {
  const recipients = await db.broadcastRecipient.findMany({
    where: { broadcastId, status: "pending" },
    select: { id: true, userId: true },
  });

  if (recipients.length > 0) {
    const keys = recipients.map((recipient) => `broadcast:${broadcastId}:${recipient.userId}`);
    const events = await db.outboxEvent.findMany({
      where: { dedupeKey: { in: keys } },
      select: { dedupeKey: true, status: true, deliveredAt: true },
    });
    const byKey = new Map(events.map((event) => [event.dedupeKey, event]));

    const delivered: string[] = [];
    const failed: string[] = [];
    for (const recipient of recipients) {
      const event = byKey.get(`broadcast:${broadcastId}:${recipient.userId}`);
      if (event?.status === "delivered") delivered.push(recipient.id);
      else if (event?.status === "failed") failed.push(recipient.id);
    }

    await db.$transaction([
      ...(delivered.length > 0
        ? [
            db.broadcastRecipient.updateMany({
              where: { id: { in: delivered } },
              data: { status: "sent", sentAt: new Date() },
            }),
          ]
        : []),
      ...(failed.length > 0
        ? [
            db.broadcastRecipient.updateMany({
              where: { id: { in: failed } },
              data: { status: "failed" },
            }),
          ]
        : []),
    ]);
  }

  const stillPending = await db.broadcastRecipient.count({
    where: { broadcastId, status: "pending" },
  });
  const anyFailed = await db.broadcastRecipient.count({
    where: { broadcastId, status: "failed" },
  });

  if (stillPending === 0) {
    await db.broadcast.updateMany({
      where: { id: broadcastId, status: { in: ["queued", "processing"] } },
      data: { status: anyFailed > 0 ? "failed" : "completed", completedAt: new Date() },
    });
  }

  const view = await getBroadcast(broadcastId);
  if (!view) throw new BroadcastError("That broadcast does not exist.", 404);
  return view;
}

/**
 * Re-queues the failures of one broadcast.
 *
 * The recipient rows already exist and are not recreated, so this cannot widen
 * the audience — it only resets the outbox rows that ran out of attempts.
 */
export async function retryBroadcastFailures(
  adminUserId: string,
  broadcastId: string,
): Promise<{ retried: number }> {
  const failures = await db.broadcastRecipient.findMany({
    where: { broadcastId, status: "failed" },
    select: { id: true, userId: true },
  });
  if (failures.length === 0) return { retried: 0 };

  const keys = failures.map((recipient) => `broadcast:${broadcastId}:${recipient.userId}`);
  await db.$transaction([
    db.outboxEvent.updateMany({
      where: { dedupeKey: { in: keys }, status: "failed" },
      data: { status: "pending", attempts: 0, nextAttemptAt: new Date(), lastError: null },
    }),
    db.broadcastRecipient.updateMany({
      where: { id: { in: failures.map((recipient) => recipient.id) } },
      data: { status: "pending" },
    }),
    db.broadcast.updateMany({
      where: { id: broadcastId, status: "failed" },
      data: { status: "queued", completedAt: null },
    }),
  ]);

  void adminUserId;
  await deliverPendingOutbox(RECIPIENT_BATCH_SIZE);
  return { retried: failures.length };
}
