import "server-only";

import { randomBytes } from "node:crypto";

import type { Prisma } from "@/generated/prisma/client";
import type {
  AmenityIssueEventView,
  AmenityIssueMessageView,
  AmenityIssueView,
} from "@/lib/amenity-types";
import { ISSUE_CATEGORY_LABELS, ISSUE_STATUS_LABELS } from "@/lib/amenity-types";
import type { AmenityScope } from "@/lib/server/amenity-auth";
import { listHoaManagerRecipients } from "@/lib/server/amenity-auth";
import { buildAuditEntry } from "@/lib/server/audit";
import { db } from "@/lib/server/db";
import { HoaWorkflowError } from "@/lib/server/hoa";
import { toMediaRef } from "@/lib/server/media";
import {
  buildPreferenceAwareNotificationOps,
  scheduleOutboxDrain,
  type NotificationIntent,
} from "@/lib/server/notifications";
import type { IssueCreateInput, IssueUpdateInput } from "@/lib/validation/amenities";

/**
 * HOA amenity issue tickets.
 *
 * These are **not** Bundleen support tickets. A broken gate is the HOA's
 * problem, routed to that HOA's manager, and it never appears in the global
 * admin support queue, the support CRM, or the AI assistant's context. The
 * separation is structural — a different table, a different notification kind,
 * and no reference from `lib/server/ai/tools/*` — rather than a filter someone
 * could forget to apply.
 *
 * ── The internal-note rule ───────────────────────────────────────────────
 *
 * A manager can write a note the reporter must never see ("third complaint
 * this month, escalate to the board"). That is enforced in exactly one place:
 * {@link serializeIssue} takes an audience and drops `internal_note` rows for
 * anyone who is not staff. No resident-facing reader constructs its own
 * message list, and no notification body ever quotes a message.
 */

const REFERENCE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function newReference(): string {
  const bytes = randomBytes(6);
  let out = "";
  for (const byte of bytes) out += REFERENCE_ALPHABET[byte % REFERENCE_ALPHABET.length];
  return `AI-${out}`;
}

type IssueRow = Prisma.AmenityIssueGetPayload<{
  include: {
    amenity: { select: { id: true; name: true } };
    reporter: { select: { id: true; fullName: true } };
    assignedTo: { select: { id: true; fullName: true } };
    messages: {
      include: { author: { select: { id: true; fullName: true } } };
    };
    events: { include: { actor: { select: { fullName: true } } } };
    media: { select: { id: true; width: true; height: true; status: true } };
  };
}>;

const ISSUE_INCLUDE = {
  amenity: { select: { id: true, name: true } },
  reporter: { select: { id: true, fullName: true } },
  assignedTo: { select: { id: true, fullName: true } },
  messages: {
    orderBy: { createdAt: "asc" },
    include: { author: { select: { id: true, fullName: true } } },
  },
  events: {
    orderBy: { createdAt: "asc" },
    include: { actor: { select: { fullName: true } } },
  },
  media: {
    where: { status: "active" },
    orderBy: { createdAt: "asc" },
    select: { id: true, width: true, height: true, status: true },
  },
} satisfies Prisma.AmenityIssueInclude;

/**
 * Serializes one issue for a specific audience.
 *
 * `audience` is not a hint. For `"reporter"` the internal notes are removed
 * from the array entirely, so there is no client-side filtering to bypass and
 * nothing sensitive in the JSON payload at all.
 */
export function serializeIssue(
  row: IssueRow,
  viewerUserId: string,
  audience: "reporter" | "staff",
): AmenityIssueView {
  const messages: AmenityIssueMessageView[] = row.messages
    .filter((message) => audience === "staff" || message.kind !== "internal_note")
    .map((message) => ({
      id: message.id,
      body: message.body,
      authorName: message.author.fullName,
      kind: message.kind,
      isMine: message.authorUserId === viewerUserId,
      createdAt: message.createdAt.toISOString(),
    }));

  const events: AmenityIssueEventView[] = row.events.map((event) => ({
    id: event.id,
    type: event.type,
    actorName: event.actor?.fullName ?? null,
    fromStatus: event.fromStatus,
    toStatus: event.toStatus,
    createdAt: event.createdAt.toISOString(),
  }));

  const isOpen = row.status !== "closed" && row.status !== "resolved";

  return {
    id: row.id,
    reference: row.reference,
    amenityId: row.amenity.id,
    amenityName: row.amenity.name,
    category: row.category,
    categoryLabel: ISSUE_CATEGORY_LABELS[row.category],
    priority: row.priority,
    status: row.status,
    statusLabel: ISSUE_STATUS_LABELS[row.status],
    subject: row.subject,
    description: row.description,
    reporterName: row.reporter.fullName,
    assignedToName: row.assignedTo?.fullName ?? null,
    resolutionSummary: row.resolutionSummary,
    photos: row.media.map(toMediaRef),
    messages,
    events,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    canWithdraw:
      audience === "reporter" && isOpen && row.withdrawnAt === null,
    canReopen:
      audience === "reporter" && (row.status === "resolved" || row.withdrawnAt !== null),
  };
}

/** Opens a ticket against an amenity in the reporter's own HOA. */
export async function createIssue(
  scope: AmenityScope,
  amenityId: string,
  input: IssueCreateInput,
): Promise<{ issueId: string; reference: string }> {
  if (!scope.membershipId) {
    throw new HoaWorkflowError("Only active residents of this HOA can report issues.", 403);
  }

  const amenity = await db.amenity.findFirst({
    where: { id: amenityId, communityId: scope.communityId, status: "published" },
    select: { id: true, name: true },
  });
  if (!amenity) throw new HoaWorkflowError("That amenity is not available.", 404);

  // A linked booking has to be the reporter's own; otherwise the reference is
  // dropped rather than the request failing, since it is only context.
  let bookingId: string | null = null;
  if (input.bookingId) {
    const booking = await db.amenityBooking.findFirst({
      where: {
        id: input.bookingId,
        amenityId,
        userId: scope.userId,
        communityId: scope.communityId,
      },
      select: { id: true },
    });
    bookingId = booking?.id ?? null;
  }

  const reference = newReference();
  const created = await db.amenityIssue.create({
    data: {
      communityId: scope.communityId,
      amenityId,
      reporterUserId: scope.userId,
      bookingId,
      reference,
      category: input.category,
      subject: input.subject,
      description: input.description,
      events: { create: { type: "created", actorUserId: scope.userId, toStatus: "new" } },
    },
    select: { id: true },
  });

  const managers = await listHoaManagerRecipients(scope.communityId);
  const intents: NotificationIntent[] = managers.map((manager) => ({
    userId: manager.id,
    email: manager.email,
    kind: "issue",
    title: `New ${amenity.name} issue — ${input.subject}`,
    // The subject only. The description can contain anything a resident typed
    // and has no business sitting in an email queue.
    body: `A resident reported an issue with ${amenity.name}. Reference ${reference}.`,
    linkPath: "/app/hoa/amenities",
    dedupeKey: `amenity-issue-created:${created.id}:${manager.id}`,
  }));

  const ops = await buildPreferenceAwareNotificationOps(intents);
  if (ops.length > 0) await db.$transaction(ops);
  scheduleOutboxDrain();

  return { issueId: created.id, reference };
}

/**
 * Loads one issue for a caller who is allowed to read it.
 *
 * The reporter sees their own. Scoped staff and Bundleen admins see any in
 * their HOA. A neighbour with an active membership sees nothing — which is why
 * this cannot be a plain "same community" check.
 */
export async function getIssue(
  scope: AmenityScope,
  issueId: string,
): Promise<AmenityIssueView> {
  const row = await db.amenityIssue.findFirst({
    where: {
      id: issueId,
      communityId: scope.communityId,
      ...(scope.canManage ? {} : { reporterUserId: scope.userId }),
    },
    include: ISSUE_INCLUDE,
  });
  if (!row) throw new HoaWorkflowError("That report was not found.", 404);

  return serializeIssue(row, scope.userId, scope.canManage ? "staff" : "reporter");
}

/** The reporter's own tickets. */
export async function listMyIssues(scope: AmenityScope): Promise<AmenityIssueView[]> {
  const rows = await db.amenityIssue.findMany({
    where: { communityId: scope.communityId, reporterUserId: scope.userId },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: ISSUE_INCLUDE,
  });
  return rows.map((row) => serializeIssue(row, scope.userId, "reporter"));
}

/** The manager's queue for one HOA. */
export async function listHoaIssues(
  scope: AmenityScope,
  options: { status?: AmenityIssueView["status"]; amenityId?: string } = {},
): Promise<AmenityIssueView[]> {
  if (!scope.canManage) {
    throw new HoaWorkflowError("You do not manage this HOA.", 403);
  }

  const rows = await db.amenityIssue.findMany({
    where: {
      communityId: scope.communityId,
      ...(options.status ? { status: options.status } : {}),
      ...(options.amenityId ? { amenityId: options.amenityId } : {}),
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 100,
    include: ISSUE_INCLUDE,
  });
  return rows.map((row) => serializeIssue(row, scope.userId, "staff"));
}

/** Adds a customer-visible reply or a staff-only internal note. */
export async function addIssueMessage(
  scope: AmenityScope,
  issueId: string,
  body: string,
  internal: boolean,
): Promise<void> {
  const issue = await db.amenityIssue.findFirst({
    where: {
      id: issueId,
      communityId: scope.communityId,
      ...(scope.canManage ? {} : { reporterUserId: scope.userId }),
    },
    select: {
      id: true,
      status: true,
      reporterUserId: true,
      amenity: { select: { name: true } },
      reporter: { select: { id: true, email: true } },
    },
  });
  if (!issue) throw new HoaWorkflowError("That report was not found.", 404);

  // Only staff can write an internal note, whatever the client sends.
  const kind = scope.canManage
    ? internal
      ? "internal_note"
      : "manager_reply"
    : "resident_message";

  if (issue.status === "closed") {
    throw new HoaWorkflowError("This report is closed. Reopen it to add a message.", 409);
  }

  await db.amenityIssueMessage.create({
    data: { issueId, authorUserId: scope.userId, kind, body },
  });

  // An internal note notifies nobody: notifying the reporter about a note they
  // cannot read would leak its existence, which is the whole point of it.
  if (kind === "internal_note") return;

  const intents: NotificationIntent[] = [];
  if (kind === "manager_reply") {
    intents.push({
      userId: issue.reporter.id,
      email: issue.reporter.email,
      kind: "issue",
      title: `Update on your ${issue.amenity.name} report`,
      body: "Your HOA manager replied. Open Bundleen to read it.",
      linkPath: "/app/homeowner/amenities/issues",
      dedupeKey: `amenity-issue-reply:${issueId}:${Date.now()}`,
    });
  } else {
    const managers = await listHoaManagerRecipients(scope.communityId);
    for (const manager of managers) {
      intents.push({
        userId: manager.id,
        email: manager.email,
        kind: "issue",
        title: `Reply on a ${issue.amenity.name} report`,
        body: "A resident replied to an open amenity report.",
        linkPath: "/app/hoa/amenities",
        dedupeKey: `amenity-issue-resident-reply:${issueId}:${manager.id}:${Date.now()}`,
      });
    }
  }

  const ops = await buildPreferenceAwareNotificationOps(intents);
  if (ops.length > 0) await db.$transaction(ops);
  scheduleOutboxDrain();
}

const TERMINAL_STATUSES = new Set(["resolved", "closed"]);

/**
 * Manager-only: status, priority, assignment, and the resolution summary.
 *
 * An absent field means "leave it alone"; an explicit `null` means "clear it".
 */
export async function updateIssue(
  scope: AmenityScope,
  issueId: string,
  input: IssueUpdateInput,
  now = new Date(),
): Promise<void> {
  if (!scope.canManage) {
    throw new HoaWorkflowError("You do not manage this HOA.", 403);
  }

  const issue = await db.amenityIssue.findFirst({
    where: { id: issueId, communityId: scope.communityId },
    select: {
      id: true,
      status: true,
      amenity: { select: { name: true } },
      reporter: { select: { id: true, email: true } },
    },
  });
  if (!issue) throw new HoaWorkflowError("That report was not found.", 404);

  // An assignee has to actually staff this HOA; otherwise assignment would be
  // a way to hand a private thread to an outsider.
  if (input.assignedToUserId) {
    const staffs = await db.communityStaffAssignment.findFirst({
      where: {
        userId: input.assignedToUserId,
        communityId: scope.communityId,
        status: "active",
        role: { in: ["hoa_manager", "hoa_team"] },
      },
      select: { id: true },
    });
    if (!staffs) {
      throw new HoaWorkflowError("That person does not staff this HOA.", 422);
    }
  }

  const data: Prisma.AmenityIssueUpdateInput = {};
  if (input.priority) data.priority = input.priority;
  if (input.resolutionSummary !== undefined) {
    data.resolutionSummary = input.resolutionSummary;
  }
  if (input.assignedToUserId !== undefined) {
    data.assignedTo = input.assignedToUserId
      ? { connect: { id: input.assignedToUserId } }
      : { disconnect: true };
  }
  if (input.status) {
    data.status = input.status;
    if (input.status === "resolved") data.resolvedAt = now;
    if (input.status === "closed") data.closedAt = now;
  }

  await db.$transaction([
    db.amenityIssue.update({ where: { id: issueId }, data }),
    ...(input.status
      ? [
          db.amenityIssueEvent.create({
            data: {
              issueId,
              type: `status_${input.status}`,
              actorUserId: scope.userId,
              fromStatus: issue.status,
              toStatus: input.status,
            },
          }),
        ]
      : []),
    ...(input.assignedToUserId !== undefined
      ? [
          db.amenityIssueEvent.create({
            data: {
              issueId,
              type: input.assignedToUserId ? "assigned" : "unassigned",
              actorUserId: scope.userId,
            },
          }),
        ]
      : []),
    db.adminAuditLog.create({
      data: buildAuditEntry({
        actorUserId: scope.userId,
        action: input.assignedToUserId
          ? "amenity_issue_assigned"
          : "amenity_issue_status_changed",
        targetType: "amenity_issue",
        targetId: issueId,
        communityId: scope.communityId,
        metadata: {
          via: scope.role,
          previousStatus: issue.status,
          nextStatus: input.status ?? issue.status,
          ...(input.assignedToUserId
            ? { assigneeUserId: input.assignedToUserId }
            : {}),
        },
      }),
    }),
  ]);

  if (input.status && TERMINAL_STATUSES.has(input.status)) {
    const ops = await buildPreferenceAwareNotificationOps([
      {
        userId: issue.reporter.id,
        email: issue.reporter.email,
        kind: "issue",
        title: `Your ${issue.amenity.name} report was ${input.status}`,
        body:
          input.resolutionSummary ??
          "Your HOA manager updated your report. Open Bundleen for details.",
        linkPath: "/app/homeowner/amenities/issues",
        dedupeKey: `amenity-issue-status:${issueId}:${input.status}`,
      },
    ]);
    if (ops.length > 0) await db.$transaction(ops);
    scheduleOutboxDrain();
  } else if (input.status === "acknowledged") {
    const ops = await buildPreferenceAwareNotificationOps([
      {
        userId: issue.reporter.id,
        email: issue.reporter.email,
        kind: "issue",
        title: `Your ${issue.amenity.name} report was acknowledged`,
        body: "Your HOA manager has seen your report and is looking into it.",
        linkPath: "/app/homeowner/amenities/issues",
        dedupeKey: `amenity-issue-status:${issueId}:acknowledged`,
      },
    ]);
    if (ops.length > 0) await db.$transaction(ops);
    scheduleOutboxDrain();
  }
}

/** Reporter-only: withdraw an open report, or reopen a resolved one. */
export async function setIssueWithdrawal(
  scope: AmenityScope,
  issueId: string,
  action: "withdraw" | "reopen",
  now = new Date(),
): Promise<void> {
  const issue = await db.amenityIssue.findFirst({
    where: { id: issueId, communityId: scope.communityId, reporterUserId: scope.userId },
    select: { id: true, status: true, withdrawnAt: true },
  });
  if (!issue) throw new HoaWorkflowError("That report was not found.", 404);

  if (action === "withdraw") {
    if (issue.status === "closed") return;
    await db.$transaction([
      db.amenityIssue.update({
        where: { id: issueId },
        data: { withdrawnAt: now, status: "closed", closedAt: now },
      }),
      db.amenityIssueEvent.create({
        data: {
          issueId,
          type: "withdrawn",
          actorUserId: scope.userId,
          fromStatus: issue.status,
          toStatus: "closed",
        },
      }),
    ]);
    return;
  }

  await db.$transaction([
    db.amenityIssue.update({
      where: { id: issueId },
      data: { withdrawnAt: null, status: "acknowledged", closedAt: null, resolvedAt: null },
    }),
    db.amenityIssueEvent.create({
      data: {
        issueId,
        type: "reopened",
        actorUserId: scope.userId,
        fromStatus: issue.status,
        toStatus: "acknowledged",
      },
    }),
  ]);
}
