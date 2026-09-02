import "server-only";

import { randomUUID } from "node:crypto";

import type { Prisma } from "@/generated/prisma/client";
import type {
  SupportTicketCategory,
  SupportTicketEventType,
  SupportTicketPriority,
  SupportTicketStatus,
  UserRole,
} from "@/generated/prisma/enums";
import { buildAuditEntry } from "@/lib/server/audit";
import { db } from "@/lib/server/db";
import {
  buildPreferenceAwareNotificationOps,
  scheduleOutboxDrain,
  type NotificationIntent,
} from "@/lib/server/notifications";
import type {
  AdminProviderTicketCreateInput,
  AdminTicketMessageInput,
  AdminTicketQuery,
  AdminTicketUpdateInput,
  CreateTicketInput,
  CustomerReplyInput,
} from "@/lib/validation/support";

/**
 * Customer support: one conversation model shared by the requester-facing
 * support centre and the admin queue, with the visibility boundary enforced in
 * exactly one place.
 *
 * The rule that matters: `internal_note` messages and every AI explanation are
 * excluded by {@link customerMessageWhere}, which is the only message filter a
 * customer-facing read may use. A customer serializer never receives an
 * internal row to accidentally leak.
 *
 * Concurrency: every admin mutation is an `updateMany` whose `where` carries
 * both the ticket id and the `updatedAt` the admin was looking at. A stale
 * write matches zero rows and raises {@link SupportConflictError} instead of
 * overwriting a colleague.
 */

export class SupportError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "SupportError";
    this.status = status;
  }
}

export class SupportConflictError extends SupportError {
  constructor(
    message = "Someone else updated this ticket while you were working. Reload to see the latest.",
  ) {
    super(message, 409);
    this.name = "SupportConflictError";
  }
}

/* ── Policy ──────────────────────────────────────────────────────────────── */

/** How long after resolution a customer may reopen rather than start fresh. */
export const REOPEN_WINDOW_DAYS = 14;

/** Statuses in which a customer may still write. */
const CUSTOMER_WRITABLE_STATUSES: readonly SupportTicketStatus[] = [
  "new",
  "open",
  "pending_customer",
  "pending_internal",
];

/** Ticket ages (hours) at which the queue flags a first response as overdue. */
export const SLA_FIRST_RESPONSE_HOURS: Record<SupportTicketPriority, number> = {
  urgent: 2,
  high: 8,
  normal: 24,
  low: 72,
};

/* ── Serialization ───────────────────────────────────────────────────────── */

export type SupportMessageView = {
  id: string;
  kind: "customer_reply" | "admin_reply" | "internal_note";
  body: string;
  authorName: string;
  /** `you`, `support`, or `customer` — never another customer's identity. */
  authorSide: "you" | "support" | "customer";
  fromAi: boolean;
  createdAt: string;
};

export type SupportTicketSummary = {
  id: string;
  ticketNumber: string;
  subject: string;
  category: SupportTicketCategory;
  status: SupportTicketStatus;
  priority: SupportTicketPriority;
  requesterName: string;
  requesterEmail: string;
  requesterRole: UserRole;
  communityId: string | null;
  communityName: string | null;
  assignedAdminUserId: string | null;
  assignedAdminName: string | null;
  messageCount: number;
  /** True when the newest message is from the customer and nobody replied. */
  awaitingAdminReply: boolean;
  firstResponseOverdue: boolean;
  ageHours: number;
  lastActivityAt: string;
  createdAt: string;
  updatedAt: string;
};

export type SupportTicketDetail = SupportTicketSummary & {
  messages: SupportMessageView[];
  relatedRequestId: string | null;
  relatedBidId: string | null;
  relatedVisitId: string | null;
  reopenedFromTicketId: string | null;
  canReply: boolean;
  canReopen: boolean;
};

export type SupportTicketEventView = {
  id: string;
  type: SupportTicketEventType;
  actorName: string | null;
  fromValue: string | null;
  toValue: string | null;
  createdAt: string;
};

const ticketSelect = {
  id: true,
  ticketNumber: true,
  subject: true,
  category: true,
  status: true,
  priority: true,
  requesterUserId: true,
  requesterRole: true,
  communityId: true,
  assignedAdminUserId: true,
  relatedRequestId: true,
  relatedBidId: true,
  relatedVisitId: true,
  reopenedFromTicketId: true,
  firstAdminReplyAt: true,
  lastCustomerMessageAt: true,
  lastAdminMessageAt: true,
  lastActivityAt: true,
  resolvedAt: true,
  closedAt: true,
  createdAt: true,
  updatedAt: true,
  requester: { select: { fullName: true, email: true } },
  community: { select: { name: true } },
  assignedAdmin: { select: { fullName: true, email: true } },
  _count: { select: { messages: true } },
} satisfies Prisma.SupportTicketSelect;

type TicketRow = Prisma.SupportTicketGetPayload<{ select: typeof ticketSelect }>;

function hoursBetween(from: Date, to: Date): number {
  return Math.max(0, Math.round(((to.getTime() - from.getTime()) / 3_600_000) * 10) / 10);
}

function isOpenStatus(status: SupportTicketStatus): boolean {
  return status !== "resolved" && status !== "closed";
}

function summarize(row: TicketRow, now = new Date()): SupportTicketSummary {
  const awaitingAdminReply =
    isOpenStatus(row.status) &&
    row.lastCustomerMessageAt !== null &&
    (row.lastAdminMessageAt === null || row.lastAdminMessageAt < row.lastCustomerMessageAt);

  const ageHours = hoursBetween(row.createdAt, now);
  const firstResponseOverdue =
    row.firstAdminReplyAt === null &&
    isOpenStatus(row.status) &&
    ageHours > SLA_FIRST_RESPONSE_HOURS[row.priority];

  return {
    id: row.id,
    ticketNumber: row.ticketNumber,
    subject: row.subject,
    category: row.category,
    status: row.status,
    priority: row.priority,
    requesterName: row.requester.fullName,
    requesterEmail: row.requester.email,
    requesterRole: row.requesterRole,
    communityId: row.communityId,
    communityName: row.community?.name ?? null,
    assignedAdminUserId: row.assignedAdminUserId,
    assignedAdminName: row.assignedAdmin?.fullName ?? null,
    messageCount: row._count.messages,
    awaitingAdminReply,
    firstResponseOverdue,
    ageHours,
    lastActivityAt: row.lastActivityAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * The one message filter a customer-facing read is allowed to use.
 *
 * Internal notes never leave the admin surface. Written as a shared constant so
 * a new customer endpoint cannot forget it and quietly ship the internal thread.
 */
export const customerMessageWhere = { kind: { not: "internal_note" } } as const;

function toMessageView(
  row: {
    id: string;
    kind: "customer_reply" | "admin_reply" | "internal_note";
    body: string;
    fromAiDraftId: string | null;
    createdAt: Date;
    author: { id: string; fullName: string } | null;
  },
  viewerUserId: string,
  viewerIsAdmin: boolean,
): SupportMessageView {
  const isOwn = row.author?.id === viewerUserId;
  const fromSupport = row.kind !== "customer_reply";

  return {
    id: row.id,
    kind: row.kind,
    body: row.body,
    // A customer sees "Bundleen Support", not the individual staff member's
    // name; an admin sees the real names on their own side of the desk.
    authorName: viewerIsAdmin
      ? (row.author?.fullName ?? "Bundleen")
      : fromSupport
        ? "Bundleen Support"
        : (row.author?.fullName ?? "You"),
    authorSide: isOwn ? "you" : fromSupport ? "support" : "customer",
    fromAi: viewerIsAdmin ? row.fromAiDraftId !== null : false,
    createdAt: row.createdAt.toISOString(),
  };
}

/* ── Ticket numbering ────────────────────────────────────────────────────── */

/**
 * Draws the next human-friendly number from a Postgres sequence.
 *
 * A sequence rather than `count(*) + 1`: two people opening a ticket at the
 * same instant must never receive the same number, and a gap after a rolled
 * back insert is harmless — the number identifies, it does not count.
 */
async function nextTicketNumber(): Promise<string> {
  const rows = await db.$queryRaw<
    { value: bigint }[]
  >`SELECT nextval('support_ticket_number_seq') AS value`;
  const value = rows[0]?.value ?? BigInt(Date.now());
  return `BDL-${value.toString().padStart(6, "0")}`;
}

/* ── Notifications ───────────────────────────────────────────────────────── */

function ticketLinkForCustomer(ticketId: string): string {
  return `/app/support/${ticketId}`;
}

/**
 * The email/in-app notification for a customer-visible change.
 *
 * Deliberately links back to the authenticated thread and carries only the
 * subject line — never the reply body. Bundleen has no inbound-email webhook,
 * so the mail must not imply that replying to it reaches anyone.
 */
function customerNotification(input: {
  ticketId: string;
  ticketNumber: string;
  subject: string;
  requesterUserId: string;
  requesterEmail: string;
  kind: "reply" | "status";
  detail: string;
  dedupeSuffix: string;
}): NotificationIntent {
  return {
    userId: input.requesterUserId,
    email: input.requesterEmail,
    kind: "account",
    title:
      input.kind === "reply"
        ? `Bundleen Support replied to ${input.ticketNumber}`
        : `${input.ticketNumber} is now ${input.detail}`,
    body:
      input.kind === "reply"
        ? `“${input.subject}” has a new response. Open the ticket in Bundleen to read and reply — this mailbox is not monitored.`
        : `“${input.subject}” was moved to ${input.detail}. Open the ticket in Bundleen for the details.`,
    linkPath: ticketLinkForCustomer(input.ticketId),
    dedupeKey: `support-${input.kind}:${input.ticketId}:${input.dedupeSuffix}`,
  };
}

/* ── Customer surface ────────────────────────────────────────────────────── */

/**
 * Which optional context ids this requester may actually attach.
 *
 * Each is re-checked against records the requester can already see, so naming
 * a stranger's request stores nothing and reveals nothing — the field is simply
 * dropped rather than erroring, because a stale id is not worth failing a
 * support request over.
 */
async function authorizeTicketContext(
  requesterUserId: string,
  input: CreateTicketInput,
): Promise<{
  communityId: string | null;
  relatedRequestId: string | null;
  relatedBidId: string | null;
  relatedVisitId: string | null;
}> {
  const [community, request, bid, visit] = await Promise.all([
    input.communityId
      ? db.community.findFirst({
          where: {
            id: input.communityId,
            OR: [
              { memberships: { some: { userId: requesterUserId, status: "active" } } },
              {
                staffAssignments: {
                  some: { userId: requesterUserId, status: "active" },
                },
              },
              { serviceAgreements: { some: { providerUserId: requesterUserId } } },
            ],
          },
          select: { id: true },
        })
      : null,
    input.relatedRequestId
      ? db.hoaServiceRequest.findFirst({
          where: {
            id: input.relatedRequestId,
            OR: [
              { createdByUserId: requesterUserId },
              { participations: { some: { userId: requesterUserId } } },
              { bids: { some: { providerUserId: requesterUserId } } },
              {
                community: {
                  memberships: { some: { userId: requesterUserId, status: "active" } },
                },
              },
            ],
          },
          select: { id: true },
        })
      : null,
    input.relatedBidId
      ? db.serviceBid.findFirst({
          where: {
            id: input.relatedBidId,
            OR: [
              { providerUserId: requesterUserId },
              {
                request: {
                  community: {
                    staffAssignments: {
                      some: { userId: requesterUserId, status: "active" },
                    },
                  },
                },
              },
            ],
          },
          select: { id: true },
        })
      : null,
    input.relatedVisitId
      ? db.serviceVisit.findFirst({
          where: {
            id: input.relatedVisitId,
            OR: [
              { unit: { memberships: { some: { userId: requesterUserId, status: "active" } } } },
              { occurrence: { agreement: { providerUserId: requesterUserId } } },
            ],
          },
          select: { id: true },
        })
      : null,
  ]);

  return {
    communityId: community?.id ?? null,
    relatedRequestId: request?.id ?? null,
    relatedBidId: bid?.id ?? null,
    relatedVisitId: visit?.id ?? null,
  };
}

/**
 * How long two identical submissions from the same account are treated as one.
 *
 * A double-click, an impatient retry, and a browser replaying the request after
 * a dropped response all arrive within seconds of each other and carry the same
 * subject, category, and body. Answering the second one with the ticket the
 * first one created is what "submit once" means to the customer — the
 * alternative is two tickets an admin then has to merge by hand.
 */
const DUPLICATE_SUBMISSION_WINDOW_MS = 120_000;

/**
 * Returns the ticket an identical submission just created, if there is one.
 *
 * Matching is on requester + subject + category + the opening message, so two
 * genuinely different problems reported a second apart still produce two
 * tickets. Only the requester's own rows are considered.
 */
async function findRecentDuplicate(
  requesterUserId: string,
  input: CreateTicketInput,
): Promise<string | null> {
  const candidates = await db.supportTicket.findMany({
    where: {
      requesterUserId,
      subject: input.subject,
      category: input.category,
      createdAt: { gte: new Date(Date.now() - DUPLICATE_SUBMISSION_WINDOW_MS) },
    },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: {
      id: true,
      messages: {
        where: { kind: "customer_reply" },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { body: true },
      },
    },
  });

  return candidates.find((row) => row.messages[0]?.body === input.message)?.id ?? null;
}

/**
 * The receipt a customer gets for opening a ticket.
 *
 * Persisted as a notification + outbox row inside the creation transaction, so
 * a committed ticket always has its delivery intent recorded and the mail is
 * retried by the outbox worker rather than being lost with the request.
 */
function ticketOpenedNotification(input: {
  ticketId: string;
  ticketNumber: string;
  subject: string;
  requesterUserId: string;
  requesterEmail: string;
}): NotificationIntent {
  return {
    userId: input.requesterUserId,
    email: input.requesterEmail,
    kind: "account",
    title: `We received ${input.ticketNumber}`,
    body: `“${input.subject}” is with the Bundleen support team. Open the ticket in Bundleen to add detail or read our reply — this mailbox is not monitored.`,
    linkPath: ticketLinkForCustomer(input.ticketId),
    dedupeKey: `support-created:${input.ticketId}`,
  };
}

/** Required operational email when Bundleen starts the conversation. */
function providerActionNotification(input: {
  ticketId: string;
  ticketNumber: string;
  subject: string;
  providerUserId: string;
  providerEmail: string;
}): NotificationIntent {
  return {
    userId: input.providerUserId,
    email: input.providerEmail,
    emailPolicy: "required",
    kind: "account",
    title: `Action requested by Bundleen · ${input.ticketNumber}`,
    body: `Bundleen opened “${input.subject}” for your account. Open the secure ticket in Bundleen to read the message and reply about any requested documents or account issue — this mailbox is not monitored.`,
    linkPath: ticketLinkForCustomer(input.ticketId),
    dedupeKey: `support-admin-created:${input.ticketId}`,
  };
}

export async function createSupportTicket(
  requester: { id: string; role: UserRole; email: string; name: string | null },
  input: CreateTicketInput,
  options?: { reopenedFromTicketId?: string },
): Promise<SupportTicketDetail> {
  // Idempotency first: a retry must return the original ticket, not open a
  // second one and not burn a second ticket number.
  const duplicateId = await findRecentDuplicate(requester.id, input);
  if (duplicateId) {
    const existing = await getTicketForRequester(requester.id, duplicateId);
    if (existing) return existing;
  }

  const context = await authorizeTicketContext(requester.id, input);
  const ticketId = randomUUID();
  const ticketNumber = await nextTicketNumber();
  const now = new Date();

  // Built before the batch so a preference lookup failure fails the request
  // cleanly rather than half-way through the write.
  const notificationOps = await buildPreferenceAwareNotificationOps([
    ticketOpenedNotification({
      ticketId,
      ticketNumber,
      subject: input.subject,
      requesterUserId: requester.id,
      requesterEmail: requester.email,
    }),
  ]);

  // One batch, one transaction: the ticket, its opening message, the creation
  // event, and the queued notification either all exist or none do. There is no
  // state in which an admin sees a ticket with no message in it.
  await db.$transaction([
    db.supportTicket.create({
      data: {
        id: ticketId,
        ticketNumber,
        requesterUserId: requester.id,
        requesterRole: requester.role,
        subject: input.subject,
        category: input.category,
        status: "new",
        priority: "normal",
        lastCustomerMessageAt: now,
        lastActivityAt: now,
        reopenedFromTicketId: options?.reopenedFromTicketId ?? null,
        ...context,
      },
    }),
    db.supportTicketMessage.create({
      data: {
        id: randomUUID(),
        ticketId,
        authorUserId: requester.id,
        kind: "customer_reply",
        body: input.message,
      },
    }),
    db.supportTicketEvent.create({
      data: {
        id: randomUUID(),
        ticketId,
        actorUserId: requester.id,
        type: "created",
        toValue: "new",
      },
    }),
    ...(notificationOps as Prisma.PrismaPromise<unknown>[]),
  ]);

  // Delivery is deliberately outside the transaction and cannot fail the
  // request: the intent is already durable, and both this drain and the cron
  // worker retry it. A mail outage delays the receipt, it never voids the
  // ticket.
  scheduleOutboxDrain();

  const detail = await getTicketForRequester(requester.id, ticketId);
  if (!detail) {
    // The write committed, so this is a read-back failure, not a lost ticket.
    throw new SupportError(
      "Your request was saved but could not be displayed. Reload the support centre to see it.",
      500,
    );
  }
  return detail;
}

/**
 * Starts a provider-facing support thread from the internal provider record.
 *
 * The provider remains the ticket requester so the existing customer support
 * APIs automatically scope the thread to that account. The opening line is an
 * `admin_reply`, the initiating admin owns the ticket, and the provider gets a
 * required operational email plus the ordinary in-app notification.
 */
export async function createAdminProviderTicket(
  admin: { id: string; name: string | null },
  providerUserId: string,
  input: AdminProviderTicketCreateInput,
): Promise<AdminTicketDetail> {
  const provider = await db.user.findUnique({
    where: { id: providerUserId },
    select: {
      id: true,
      role: true,
      email: true,
      providerProfile: { select: { userId: true } },
    },
  });
  if (!provider || provider.role !== "provider" || !provider.providerProfile) {
    throw new SupportError("That provider account does not exist.", 404);
  }

  // Network retries and impatient double-clicks must return the same thread,
  // not send the provider the same operational request twice.
  const duplicate = await db.supportTicket.findFirst({
    where: {
      requesterUserId: provider.id,
      subject: input.subject,
      category: input.category,
      createdAt: { gte: new Date(Date.now() - DUPLICATE_SUBMISSION_WINDOW_MS) },
      messages: {
        some: {
          authorUserId: admin.id,
          kind: "admin_reply",
          body: input.message,
        },
      },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (duplicate) {
    const existing = await getAdminTicket(admin.id, duplicate.id);
    if (existing) return existing;
  }

  const ticketId = randomUUID();
  const ticketNumber = await nextTicketNumber();
  const messageId = randomUUID();
  const now = new Date();
  const notificationOps = await buildPreferenceAwareNotificationOps([
    providerActionNotification({
      ticketId,
      ticketNumber,
      subject: input.subject,
      providerUserId: provider.id,
      providerEmail: provider.email,
    }),
  ]);

  await db.$transaction([
    db.supportTicket.create({
      data: {
        id: ticketId,
        ticketNumber,
        requesterUserId: provider.id,
        requesterRole: "provider",
        subject: input.subject,
        category: input.category,
        status: "pending_customer",
        priority: input.priority,
        assignedAdminUserId: admin.id,
        firstAdminReplyAt: now,
        lastAdminMessageAt: now,
        lastActivityAt: now,
      },
    }),
    db.supportTicketMessage.create({
      data: {
        id: messageId,
        ticketId,
        authorUserId: admin.id,
        kind: "admin_reply",
        body: input.message,
      },
    }),
    db.supportTicketEvent.create({
      data: {
        id: randomUUID(),
        ticketId,
        actorUserId: admin.id,
        type: "created",
        toValue: "pending_customer",
      },
    }),
    db.supportTicketEvent.create({
      data: {
        id: randomUUID(),
        ticketId,
        actorUserId: admin.id,
        type: "assigned",
        toValue: admin.id,
      },
    }),
    db.supportTicketEvent.create({
      data: {
        id: randomUUID(),
        ticketId,
        actorUserId: admin.id,
        type: "admin_replied",
      },
    }),
    db.adminAuditLog.create({
      data: buildAuditEntry({
        actorUserId: admin.id,
        action: "support_ticket_created",
        targetType: "support_ticket",
        targetId: ticketId,
        providerUserId: provider.id,
        metadata: {
          category: input.category,
          status: "pending_customer",
        },
      }),
    }),
    ...(notificationOps as Prisma.PrismaPromise<unknown>[]),
  ]);

  scheduleOutboxDrain();

  const detail = await getAdminTicket(admin.id, ticketId);
  if (!detail) {
    throw new SupportError(
      "The provider ticket was saved but could not be displayed. Open the support queue to find it.",
      500,
    );
  }
  return detail;
}

export async function listTicketsForRequester(
  requesterUserId: string,
): Promise<SupportTicketSummary[]> {
  const rows = await db.supportTicket.findMany({
    where: await requesterVisibilityWhere(requesterUserId),
    orderBy: { lastActivityAt: "desc" },
    take: 100,
    select: ticketSelect,
  });
  const now = new Date();
  return rows.map((row) => summarize(row, now));
}

/**
 * What a non-admin may see: their own tickets, plus tickets raised by residents
 * of a community they actively manage.
 *
 * An HOA manager needs the second case to do their job; a resident never gets
 * it, and no branch here can widen to "every ticket in the system".
 */
async function requesterVisibilityWhere(
  userId: string,
): Promise<Prisma.SupportTicketWhereInput> {
  const managed = await db.communityStaffAssignment.findMany({
    where: { userId, status: "active", role: { in: ["hoa_manager", "hoa_team"] } },
    select: { communityId: true },
  });
  const managedCommunityIds = managed.map((assignment) => assignment.communityId);

  return managedCommunityIds.length > 0
    ? { OR: [{ requesterUserId: userId }, { communityId: { in: managedCommunityIds } }] }
    : { requesterUserId: userId };
}

export async function getTicketForRequester(
  requesterUserId: string,
  ticketId: string,
): Promise<SupportTicketDetail | null> {
  const visibility = await requesterVisibilityWhere(requesterUserId);
  const row = await db.supportTicket.findFirst({
    where: { AND: [{ id: ticketId }, visibility] },
    select: ticketSelect,
  });
  if (!row) return null;

  const messages = await db.supportTicketMessage.findMany({
    where: { ticketId, ...customerMessageWhere },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      kind: true,
      body: true,
      fromAiDraftId: true,
      createdAt: true,
      author: { select: { id: true, fullName: true } },
    },
  });

  const summary = summarize(row);
  return {
    ...summary,
    messages: messages.map((message) => toMessageView(message, requesterUserId, false)),
    relatedRequestId: row.relatedRequestId,
    relatedBidId: row.relatedBidId,
    relatedVisitId: row.relatedVisitId,
    reopenedFromTicketId: row.reopenedFromTicketId,
    // Only the person who opened the ticket writes to it. A manager viewing a
    // resident's ticket reads the thread; they do not answer as that resident.
    canReply:
      row.requesterUserId === requesterUserId &&
      CUSTOMER_WRITABLE_STATUSES.includes(row.status),
    canReopen:
      row.requesterUserId === requesterUserId &&
      row.status === "resolved" &&
      row.resolvedAt !== null &&
      Date.now() - row.resolvedAt.getTime() <= REOPEN_WINDOW_DAYS * 86_400_000,
  };
}

export async function addCustomerReply(
  requesterUserId: string,
  ticketId: string,
  input: CustomerReplyInput,
): Promise<SupportTicketDetail> {
  const ticket = await db.supportTicket.findFirst({
    // Ownership is in the `where`, so a forged id selects nothing.
    where: { id: ticketId, requesterUserId },
    select: { id: true, status: true, assignedAdminUserId: true, ticketNumber: true },
  });
  if (!ticket) throw new SupportError("That ticket does not exist.", 404);
  if (!CUSTOMER_WRITABLE_STATUSES.includes(ticket.status)) {
    throw new SupportError(
      "This ticket is closed. Open a new one and we will link it to this conversation.",
      409,
    );
  }

  const now = new Date();
  await db.$transaction([
    db.supportTicketMessage.create({
      data: {
        id: randomUUID(),
        ticketId,
        authorUserId: requesterUserId,
        kind: "customer_reply",
        body: input.message,
      },
    }),
    db.supportTicket.update({
      where: { id: ticketId },
      data: {
        // A customer reply always reopens the "we owe an answer" state.
        status: ticket.status === "pending_customer" ? "open" : ticket.status,
        lastCustomerMessageAt: now,
        lastActivityAt: now,
      },
    }),
    db.supportTicketEvent.create({
      data: {
        id: randomUUID(),
        ticketId,
        actorUserId: requesterUserId,
        type: "customer_replied",
      },
    }),
  ]);

  const detail = await getTicketForRequester(requesterUserId, ticketId);
  if (!detail) throw new SupportError("That ticket does not exist.", 404);
  return detail;
}

/**
 * Reopens a recently resolved ticket, or creates a linked follow-up when the
 * reopen window has passed. Either way the customer keeps one continuous story
 * rather than being told to start over with no context.
 */
export async function reopenTicket(
  requester: { id: string; role: UserRole; email: string; name: string | null },
  ticketId: string,
  message: string,
): Promise<SupportTicketDetail> {
  const ticket = await db.supportTicket.findFirst({
    where: { id: ticketId, requesterUserId: requester.id },
    select: {
      id: true,
      subject: true,
      category: true,
      status: true,
      resolvedAt: true,
      communityId: true,
    },
  });
  if (!ticket) throw new SupportError("That ticket does not exist.", 404);

  const withinWindow =
    ticket.status === "resolved" &&
    ticket.resolvedAt !== null &&
    Date.now() - ticket.resolvedAt.getTime() <= REOPEN_WINDOW_DAYS * 86_400_000;

  if (!withinWindow) {
    return createSupportTicket(
      requester,
      {
        subject: `Follow-up: ${ticket.subject}`.slice(0, 160),
        category: ticket.category,
        message,
        ...(ticket.communityId ? { communityId: ticket.communityId } : {}),
      },
      { reopenedFromTicketId: ticket.id },
    );
  }

  const now = new Date();
  await db.$transaction([
    db.supportTicket.update({
      where: { id: ticketId },
      data: {
        status: "open",
        resolvedAt: null,
        lastCustomerMessageAt: now,
        lastActivityAt: now,
      },
    }),
    db.supportTicketMessage.create({
      data: {
        id: randomUUID(),
        ticketId,
        authorUserId: requester.id,
        kind: "customer_reply",
        body: message,
      },
    }),
    db.supportTicketEvent.create({
      data: {
        id: randomUUID(),
        ticketId,
        actorUserId: requester.id,
        type: "reopened",
        fromValue: "resolved",
        toValue: "open",
      },
    }),
  ]);

  const detail = await getTicketForRequester(requester.id, ticketId);
  if (!detail) throw new SupportError("That ticket does not exist.", 404);
  return detail;
}

/* ── Admin surface ───────────────────────────────────────────────────────── */

export type AdminTicketPage = {
  tickets: SupportTicketSummary[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};

function queueWhere(query: AdminTicketQuery): Prisma.SupportTicketWhereInput {
  const where: Prisma.SupportTicketWhereInput = {};

  if (query.status) where.status = query.status;
  if (query.priority) where.priority = query.priority;
  if (query.category) where.category = query.category;
  if (query.requesterRole) where.requesterRole = query.requesterRole;

  if (query.assignee === "unassigned") where.assignedAdminUserId = null;
  else if (query.assignee) where.assignedAdminUserId = query.assignee;

  if (query.minAgeDays !== undefined) {
    where.createdAt = { lte: new Date(Date.now() - query.minAgeDays * 86_400_000) };
  }

  if (query.search) {
    const term = query.search;
    where.OR = [
      { ticketNumber: { contains: term, mode: "insensitive" } },
      { subject: { contains: term, mode: "insensitive" } },
      { requester: { fullName: { contains: term, mode: "insensitive" } } },
      { requester: { email: { contains: term, mode: "insensitive" } } },
      { community: { name: { contains: term, mode: "insensitive" } } },
    ];
  }

  return where;
}

function queueOrder(sort: AdminTicketQuery["sort"]): Prisma.SupportTicketOrderByWithRelationInput[] {
  switch (sort) {
    case "newest":
      return [{ createdAt: "desc" }];
    case "oldest_unanswered":
      // Never-answered first, then the longest-waiting of those.
      return [{ firstAdminReplyAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }];
    case "priority":
      // Prisma orders enums by their declared position, which runs low → urgent,
      // so `desc` puts urgent at the top.
      return [{ priority: "desc" }, { lastActivityAt: "desc" }];
    default:
      return [{ lastActivityAt: "desc" }];
  }
}

/** Server-side filtering, sorting, and pagination — the queue can be large. */
export async function listAdminTickets(query: AdminTicketQuery): Promise<AdminTicketPage> {
  const where = queueWhere(query);
  const [total, rows] = await Promise.all([
    db.supportTicket.count({ where }),
    db.supportTicket.findMany({
      where,
      orderBy: queueOrder(query.sort),
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: ticketSelect,
    }),
  ]);

  const now = new Date();
  return {
    tickets: rows.map((row) => summarize(row, now)),
    total,
    page: query.page,
    pageSize: query.pageSize,
    pageCount: Math.max(1, Math.ceil(total / query.pageSize)),
  };
}

export type AdminTicketDetail = SupportTicketSummary & {
  messages: SupportMessageView[];
  events: SupportTicketEventView[];
  relatedRequestId: string | null;
  relatedBidId: string | null;
  relatedVisitId: string | null;
  reopenedFromTicketId: string | null;
  requesterUserId: string;
};

export async function getAdminTicket(
  adminUserId: string,
  ticketId: string,
): Promise<AdminTicketDetail | null> {
  const row = await db.supportTicket.findUnique({ where: { id: ticketId }, select: ticketSelect });
  if (!row) return null;

  const [messages, events] = await Promise.all([
    db.supportTicketMessage.findMany({
      where: { ticketId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        kind: true,
        body: true,
        fromAiDraftId: true,
        createdAt: true,
        author: { select: { id: true, fullName: true } },
      },
    }),
    db.supportTicketEvent.findMany({
      where: { ticketId },
      orderBy: { createdAt: "desc" },
      take: 60,
      select: {
        id: true,
        type: true,
        fromValue: true,
        toValue: true,
        createdAt: true,
        actor: { select: { fullName: true } },
      },
    }),
  ]);

  return {
    ...summarize(row),
    requesterUserId: row.requesterUserId,
    messages: messages.map((message) => toMessageView(message, adminUserId, true)),
    events: events.map((event) => ({
      id: event.id,
      type: event.type,
      actorName: event.actor?.fullName ?? null,
      fromValue: event.fromValue,
      toValue: event.toValue,
      createdAt: event.createdAt.toISOString(),
    })),
    relatedRequestId: row.relatedRequestId,
    relatedBidId: row.relatedBidId,
    relatedVisitId: row.relatedVisitId,
    reopenedFromTicketId: row.reopenedFromTicketId,
  };
}

/** Resolution timestamps the database CHECK constraint requires. */
function statusTimestamps(status: SupportTicketStatus, now: Date) {
  return {
    resolvedAt: status === "resolved" ? now : status === "closed" ? undefined : null,
    closedAt: status === "closed" ? now : null,
  };
}

/**
 * Guards an admin write with the `updatedAt` the admin was looking at.
 *
 * Returns the ticket, or throws {@link SupportConflictError}. The check is
 * repeated inside the mutating `updateMany` — this read only produces a clear
 * error before doing work, it is not the lock.
 */
async function requireFreshTicket(ticketId: string, expectedUpdatedAt: string) {
  const ticket = await db.supportTicket.findUnique({
    where: { id: ticketId },
    select: {
      id: true,
      ticketNumber: true,
      subject: true,
      status: true,
      priority: true,
      updatedAt: true,
      assignedAdminUserId: true,
      requesterUserId: true,
      firstAdminReplyAt: true,
      requester: { select: { email: true } },
    },
  });
  if (!ticket) throw new SupportError("That ticket does not exist.", 404);
  if (ticket.updatedAt.toISOString() !== new Date(expectedUpdatedAt).toISOString()) {
    throw new SupportConflictError();
  }
  return ticket;
}

const STATUS_LABELS: Record<SupportTicketStatus, string> = {
  new: "new",
  open: "open",
  pending_customer: "waiting on you",
  pending_internal: "in progress",
  resolved: "resolved",
  closed: "closed",
};

/**
 * Posts an admin reply or an internal note, optionally moving status, in one
 * transaction with the event row and the customer's notification intent.
 */
export async function addAdminMessage(
  admin: { id: string; name: string | null },
  ticketId: string,
  input: AdminTicketMessageInput,
): Promise<AdminTicketDetail> {
  const ticket = await requireFreshTicket(ticketId, input.expectedUpdatedAt);
  const now = new Date();
  const messageId = randomUUID();
  const nextStatus =
    input.status ?? (input.internal ? ticket.status : nextStatusAfterAdminReply(ticket.status));

  const ops: Prisma.PrismaPromise<unknown>[] = [
    db.supportTicketMessage.create({
      data: {
        id: messageId,
        ticketId,
        authorUserId: admin.id,
        kind: input.internal ? "internal_note" : "admin_reply",
        body: input.message,
      },
    }),
    // Optimistic guard: `updatedAt` in the filter means a concurrent write
    // between the read above and here updates zero rows.
    db.supportTicket.updateMany({
      where: { id: ticketId, updatedAt: ticket.updatedAt },
      data: {
        status: nextStatus,
        lastActivityAt: now,
        ...(input.internal
          ? {}
          : {
              lastAdminMessageAt: now,
              // Write-once: the first response time must not be reset by a
              // later reply on the same ticket.
              ...(ticket.firstAdminReplyAt ? {} : { firstAdminReplyAt: now }),
            }),
        ...statusTimestamps(nextStatus, now),
      },
    }),
    db.supportTicketEvent.create({
      data: {
        id: randomUUID(),
        ticketId,
        actorUserId: admin.id,
        type: input.internal ? "internal_note_added" : "admin_replied",
      },
    }),
  ];

  if (nextStatus !== ticket.status) {
    ops.push(
      db.supportTicketEvent.create({
        data: {
          id: randomUUID(),
          ticketId,
          actorUserId: admin.id,
          type: "status_changed",
          fromValue: ticket.status,
          toValue: nextStatus,
        },
      }),
    );
  }

  // An internal note is invisible to the customer, so it produces no
  // notification and no audit entry about "replying".
  if (!input.internal) {
    ops.push(
      db.adminAuditLog.create({
        data: buildAuditEntry({
          actorUserId: admin.id,
          action: "support_ticket_replied",
          targetType: "support_ticket",
          targetId: ticketId,
          metadata: { status: nextStatus },
        }),
      }),
    );
    const notificationOps = await buildPreferenceAwareNotificationOps([
      customerNotification({
        ticketId,
        ticketNumber: ticket.ticketNumber,
        subject: ticket.subject,
        requesterUserId: ticket.requesterUserId,
        requesterEmail: ticket.requester.email,
        kind: "reply",
        detail: STATUS_LABELS[nextStatus],
        dedupeSuffix: messageId,
      }),
    ]);
    ops.push(...(notificationOps as Prisma.PrismaPromise<unknown>[]));
  }

  const results = await db.$transaction(ops);
  const updated = results[1] as { count: number };
  if (updated.count === 0) throw new SupportConflictError();

  scheduleOutboxDrain();

  const detail = await getAdminTicket(admin.id, ticketId);
  if (!detail) throw new SupportError("That ticket does not exist.", 404);
  return detail;
}

/**
 * Where a ticket lands after Bundleen answers.
 *
 * Answering means the ball is with the customer — except when an admin has
 * deliberately parked it as internal work, which a reply should not undo.
 */
function nextStatusAfterAdminReply(current: SupportTicketStatus): SupportTicketStatus {
  if (current === "pending_internal") return "pending_internal";
  if (current === "resolved" || current === "closed") return "open";
  return "pending_customer";
}

export async function updateAdminTicket(
  admin: { id: string; name: string | null },
  ticketId: string,
  input: AdminTicketUpdateInput,
): Promise<AdminTicketDetail> {
  const ticket = await requireFreshTicket(ticketId, input.expectedUpdatedAt);
  const now = new Date();

  // Assignment must name a real, currently active Bundleen admin — not merely
  // an account whose role column happens to say `admin`.
  if (typeof input.assignedAdminUserId === "string") {
    const assignee = await db.user.findFirst({
      where: {
        id: input.assignedAdminUserId,
        role: "admin",
        adminAccess: { status: "active" },
      },
      select: { id: true },
    });
    if (!assignee) {
      throw new SupportError("That admin cannot be assigned tickets.", 400);
    }
  }

  const data: Prisma.SupportTicketUncheckedUpdateManyInput = { lastActivityAt: now };
  const ops: Prisma.PrismaPromise<unknown>[] = [];
  const notificationIntents: NotificationIntent[] = [];

  if (input.status && input.status !== ticket.status) {
    data.status = input.status;
    Object.assign(data, statusTimestamps(input.status, now));
    ops.push(
      db.supportTicketEvent.create({
        data: {
          id: randomUUID(),
          ticketId,
          actorUserId: admin.id,
          type: "status_changed",
          fromValue: ticket.status,
          toValue: input.status,
        },
      }),
      db.adminAuditLog.create({
        data: buildAuditEntry({
          actorUserId: admin.id,
          action: "support_ticket_status_changed",
          targetType: "support_ticket",
          targetId: ticketId,
          metadata: { previousStatus: ticket.status, nextStatus: input.status },
        }),
      }),
    );
    // Only material moves are worth an email. Shuffling between internal
    // working states is Bundleen's business, not the customer's inbox.
    if (input.status === "resolved" || input.status === "closed") {
      notificationIntents.push(
        customerNotification({
          ticketId,
          ticketNumber: ticket.ticketNumber,
          subject: ticket.subject,
          requesterUserId: ticket.requesterUserId,
          requesterEmail: ticket.requester.email,
          kind: "status",
          detail: STATUS_LABELS[input.status],
          dedupeSuffix: `${input.status}:${now.toISOString().slice(0, 13)}`,
        }),
      );
    }
  }

  if (input.priority && input.priority !== ticket.priority) {
    data.priority = input.priority;
    ops.push(
      db.supportTicketEvent.create({
        data: {
          id: randomUUID(),
          ticketId,
          actorUserId: admin.id,
          type: "priority_changed",
          fromValue: ticket.priority,
          toValue: input.priority,
        },
      }),
      db.adminAuditLog.create({
        data: buildAuditEntry({
          actorUserId: admin.id,
          action: "support_ticket_priority_changed",
          targetType: "support_ticket",
          targetId: ticketId,
          metadata: { previousStatus: ticket.priority, nextStatus: input.priority },
        }),
      }),
    );
  }

  if (
    input.assignedAdminUserId !== undefined &&
    input.assignedAdminUserId !== ticket.assignedAdminUserId
  ) {
    data.assignedAdminUserId = input.assignedAdminUserId;
    ops.push(
      db.supportTicketEvent.create({
        data: {
          id: randomUUID(),
          ticketId,
          actorUserId: admin.id,
          type: input.assignedAdminUserId ? "assigned" : "unassigned",
          fromValue: ticket.assignedAdminUserId,
          toValue: input.assignedAdminUserId,
        },
      }),
      db.adminAuditLog.create({
        data: buildAuditEntry({
          actorUserId: admin.id,
          action: "support_ticket_assigned",
          targetType: "support_ticket",
          targetId: ticketId,
          metadata: { assigneeUserId: input.assignedAdminUserId ?? "unassigned" },
        }),
      }),
    );
  }

  const notificationOps = await buildPreferenceAwareNotificationOps(notificationIntents);

  const results = await db.$transaction([
    db.supportTicket.updateMany({
      where: { id: ticketId, updatedAt: ticket.updatedAt },
      data,
    }),
    ...ops,
    ...(notificationOps as Prisma.PrismaPromise<unknown>[]),
  ]);
  if ((results[0] as { count: number }).count === 0) throw new SupportConflictError();

  if (notificationIntents.length > 0) scheduleOutboxDrain();

  const detail = await getAdminTicket(admin.id, ticketId);
  if (!detail) throw new SupportError("That ticket does not exist.", 404);
  return detail;
}

/** Assignable admins for the queue's assignment control. */
export async function listAssignableAdmins(): Promise<
  { id: string; name: string; email: string }[]
> {
  const rows = await db.user.findMany({
    where: { role: "admin", adminAccess: { status: "active" } },
    orderBy: { fullName: "asc" },
    select: { id: true, fullName: true, email: true },
    take: 100,
  });
  return rows.map((row) => ({ id: row.id, name: row.fullName, email: row.email }));
}

/** Counters for the support module's header. */
export async function getSupportQueueStats(): Promise<{
  open: number;
  unassigned: number;
  awaitingReply: number;
  urgent: number;
}> {
  const openStatuses: SupportTicketStatus[] = [
    "new",
    "open",
    "pending_customer",
    "pending_internal",
  ];
  const [open, unassigned, urgent, awaitingReply] = await Promise.all([
    db.supportTicket.count({ where: { status: { in: openStatuses } } }),
    db.supportTicket.count({
      where: { status: { in: openStatuses }, assignedAdminUserId: null },
    }),
    db.supportTicket.count({ where: { status: { in: openStatuses }, priority: "urgent" } }),
    db.supportTicket.count({
      where: { status: { in: openStatuses }, firstAdminReplyAt: null },
    }),
  ]);
  return { open, unassigned, awaitingReply, urgent };
}
