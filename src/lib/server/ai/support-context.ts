import "server-only";

import { db } from "@/lib/server/db";
import { AiToolError } from "@/lib/server/ai/errors";
import { customerMessageWhere } from "@/lib/server/support";

/**
 * Ticket context retrieval for the admin AI assistance panel.
 *
 * Three rules define this module:
 *
 * 1. **The model never chooses whose data it sees.** Context is assembled here
 *    from the ticket row, using the requester and community ids stored on it —
 *    not from anything the model or the ticket text asks for. There is no
 *    tool that takes a user id.
 * 2. **No SQL reaches the model.** These are fixed, narrow queries. The model
 *    receives their redacted JSON output as data.
 * 3. **Everything sensitive is stripped before it leaves.** No auth data, no
 *    payment credentials, no exact private coordinates, no unrelated users —
 *    see {@link redactedContextFor}.
 */

/** Caps so a chatty ticket cannot push the prompt (and its cost) unbounded. */
const MAX_MESSAGES = 20;
const MAX_MESSAGE_CHARS = 1_500;
const MAX_RELATED_ROWS = 5;

export type TicketAiContext = {
  ticket: {
    id: string;
    number: string;
    subject: string;
    category: string;
    status: string;
    priority: string;
    ageHours: number;
    requesterRole: string;
    /** Given name only — enough to address a reply, not a full identity. */
    requesterFirstName: string;
    communityName: string | null;
    hasBeenAnswered: boolean;
  };
  conversation: { author: "customer" | "support"; text: string; at: string }[];
  account: {
    role: string;
    memberOfCommunities: number;
    /** Provider-only, and only the coarse operational state. */
    providerAccountStatus: string | null;
    providerVerified: boolean | null;
    providerActiveServiceAreas: number | null;
  };
  relatedRequests: {
    id: string;
    title: string;
    category: string;
    status: string;
    community: string;
    biddingClosesAt: string | null;
  }[];
  relatedBids: {
    id: string;
    requestTitle: string;
    status: string;
    amountUsd: number;
    submittedAt: string;
  }[];
  relatedVisits: {
    id: string;
    status: string;
    scheduledDate: string | null;
    unitLabel: string;
    agreementTitle: string;
  }[];
  recentNotifications: { kind: string; title: string; at: string }[];
  /** In-app links an authorized admin can open to verify each claim. */
  evidenceLinks: { label: string; href: string }[];
  /** Named gaps the model must surface rather than paper over. */
  missingData: string[];
};

function truncate(value: string, max = MAX_MESSAGE_CHARS): string {
  return value.length <= max ? value : `${value.slice(0, max)}… [truncated]`;
}

function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? "there";
}

/**
 * Builds the complete, redacted context for one ticket.
 *
 * Called once per generation from the authenticated admin's request. The admin
 * gate lives in the route; this function assumes it has already passed and
 * therefore never accepts a caller-supplied requester or community id.
 */
export async function buildTicketAiContext(ticketId: string): Promise<TicketAiContext> {
  const ticket = await db.supportTicket.findUnique({
    where: { id: ticketId },
    select: {
      id: true,
      ticketNumber: true,
      subject: true,
      category: true,
      status: true,
      priority: true,
      createdAt: true,
      requesterUserId: true,
      requesterRole: true,
      communityId: true,
      relatedRequestId: true,
      relatedBidId: true,
      relatedVisitId: true,
      firstAdminReplyAt: true,
      requester: { select: { fullName: true } },
      community: { select: { name: true } },
    },
  });
  if (!ticket) throw new AiToolError("That ticket does not exist.", 404);

  const missingData: string[] = [];

  const [messages, memberships, providerProfile, serviceAreaCount, notifications] =
    await Promise.all([
      db.supportTicketMessage.findMany({
        // Internal notes are excluded: the model drafts a *customer* reply, and
        // feeding it staff-only commentary invites that commentary into the
        // draft. The explanation prompt reads the same customer-visible thread.
        where: { ticketId, ...customerMessageWhere },
        orderBy: { createdAt: "asc" },
        take: MAX_MESSAGES,
        select: { kind: true, body: true, createdAt: true },
      }),
      db.communityMembership.count({
        where: { userId: ticket.requesterUserId, status: "active" },
      }),
      ticket.requesterRole === "provider"
        ? db.providerProfile.findUnique({
            where: { userId: ticket.requesterUserId },
            // Explicitly not licence numbers, policy numbers, or payout fields.
            select: {
              accountStatus: true,
              licenseVerifiedAt: true,
              insuranceVerifiedAt: true,
            },
          })
        : Promise.resolve(null),
      ticket.requesterRole === "provider"
        ? db.providerServiceArea.count({
            where: { providerUserId: ticket.requesterUserId, status: "active" },
          })
        : Promise.resolve(null),
      db.notification.findMany({
        where: { userId: ticket.requesterUserId },
        orderBy: { createdAt: "desc" },
        take: MAX_RELATED_ROWS,
        select: { kind: true, title: true, createdAt: true },
      }),
    ]);

  // Related records: the ones the ticket itself points at, plus the requester's
  // own recent activity. Never another customer's rows.
  const [relatedRequests, relatedBids, relatedVisits] = await Promise.all([
    db.hoaServiceRequest.findMany({
      where: {
        OR: [
          ...(ticket.relatedRequestId ? [{ id: ticket.relatedRequestId }] : []),
          { createdByUserId: ticket.requesterUserId },
          { participations: { some: { userId: ticket.requesterUserId } } },
          { bids: { some: { providerUserId: ticket.requesterUserId } } },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: MAX_RELATED_ROWS,
      select: {
        id: true,
        title: true,
        category: true,
        status: true,
        biddingClosesAt: true,
        community: { select: { name: true } },
      },
    }),
    db.serviceBid.findMany({
      where: {
        OR: [
          ...(ticket.relatedBidId ? [{ id: ticket.relatedBidId }] : []),
          { providerUserId: ticket.requesterUserId },
        ],
      },
      orderBy: { submittedAt: "desc" },
      take: MAX_RELATED_ROWS,
      select: {
        id: true,
        status: true,
        amountCents: true,
        submittedAt: true,
        request: { select: { title: true } },
      },
    }),
    db.serviceVisit.findMany({
      where: {
        OR: [
          ...(ticket.relatedVisitId ? [{ id: ticket.relatedVisitId }] : []),
          {
            unit: {
              memberships: { some: { userId: ticket.requesterUserId, status: "active" } },
            },
          },
          { occurrence: { agreement: { providerUserId: ticket.requesterUserId } } },
        ],
      },
      orderBy: { updatedAt: "desc" },
      take: MAX_RELATED_ROWS,
      select: {
        id: true,
        status: true,
        scheduledDate: true,
        // The unit's *label*, never its street address, access notes, or
        // coordinates — those are the resident's private service location.
        unit: { select: { label: true } },
        occurrence: {
          select: { agreement: { select: { request: { select: { title: true } } } } },
        },
      },
    }),
  ]);

  if (messages.length === 0) missingData.push("The ticket has no customer message yet.");
  if (!ticket.communityId) missingData.push("The ticket is not linked to a specific community.");
  if (relatedRequests.length === 0) {
    missingData.push("No service requests are linked to this requester.");
  }
  if (ticket.requesterRole === "provider" && serviceAreaCount === 0) {
    missingData.push(
      "This provider has no active service areas, so they currently match no opportunities.",
    );
  }

  const evidenceLinks: { label: string; href: string }[] = [
    { label: `Ticket ${ticket.ticketNumber}`, href: `/app/admin/support/${ticket.id}` },
  ];
  if (ticket.communityId) {
    evidenceLinks.push({
      label: ticket.community?.name ?? "Community",
      href: `/app/admin/communities/${ticket.communityId}`,
    });
  }
  if (ticket.requesterRole === "provider") {
    evidenceLinks.push({
      label: "Provider record",
      href: `/app/admin/providers/${ticket.requesterUserId}`,
    });
  }

  return {
    ticket: {
      id: ticket.id,
      number: ticket.ticketNumber,
      subject: truncate(ticket.subject, 200),
      category: ticket.category,
      status: ticket.status,
      priority: ticket.priority,
      ageHours: Math.round((Date.now() - ticket.createdAt.getTime()) / 3_600_000),
      requesterRole: ticket.requesterRole,
      requesterFirstName: firstName(ticket.requester.fullName),
      communityName: ticket.community?.name ?? null,
      hasBeenAnswered: ticket.firstAdminReplyAt !== null,
    },
    conversation: messages.map((message) => ({
      author: message.kind === "customer_reply" ? ("customer" as const) : ("support" as const),
      text: truncate(message.body),
      at: message.createdAt.toISOString(),
    })),
    account: {
      role: ticket.requesterRole,
      memberOfCommunities: memberships,
      providerAccountStatus: providerProfile?.accountStatus ?? null,
      providerVerified: providerProfile
        ? providerProfile.licenseVerifiedAt !== null &&
          providerProfile.insuranceVerifiedAt !== null
        : null,
      providerActiveServiceAreas: serviceAreaCount,
    },
    relatedRequests: relatedRequests.map((request) => ({
      id: request.id,
      title: truncate(request.title, 120),
      category: request.category,
      status: request.status,
      community: request.community.name,
      biddingClosesAt: request.biddingClosesAt?.toISOString() ?? null,
    })),
    relatedBids: relatedBids.map((bid) => ({
      id: bid.id,
      requestTitle: truncate(bid.request.title, 120),
      status: bid.status,
      amountUsd: Math.round(bid.amountCents) / 100,
      submittedAt: bid.submittedAt.toISOString(),
    })),
    relatedVisits: relatedVisits.map((visit) => ({
      id: visit.id,
      status: visit.status,
      scheduledDate: visit.scheduledDate?.toISOString() ?? null,
      unitLabel: visit.unit.label,
      agreementTitle: truncate(visit.occurrence.agreement.request.title, 120),
    })),
    recentNotifications: notifications.map((notification) => ({
      kind: notification.kind,
      title: truncate(notification.title, 120),
      at: notification.createdAt.toISOString(),
    })),
    evidenceLinks,
    missingData,
  };
}

/**
 * Belt-and-braces check that nothing sensitive slipped into the context.
 *
 * The queries above already select field-by-field, so this should always pass;
 * it exists because a future `select` edit is exactly the kind of change that
 * silently widens what a model sees, and a test asserts on it.
 */
export function redactedContextFor(context: TicketAiContext): TicketAiContext {
  const serialized = JSON.stringify(context);
  const forbidden = [
    /"(?:password|token|secret|apiKey|clerkUserId)"/i,
    /"(?:latitude|longitude|centerLatitude|centerLongitude)"/i,
    /"(?:accessNotes|licenseNumber|insurancePolicyNumber|payoutLast4)"/i,
    /"addressLine1"/i,
  ];
  for (const pattern of forbidden) {
    if (pattern.test(serialized)) {
      throw new AiToolError("Ticket context failed its redaction check.", 500);
    }
  }
  return context;
}
