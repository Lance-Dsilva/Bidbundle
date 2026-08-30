import "server-only";

import type { AmenityScope } from "@/lib/server/amenity-auth";
import { buildAuditEntry } from "@/lib/server/audit";
import { db } from "@/lib/server/db";
import { getEmailProvider } from "@/lib/server/email";
import { HoaWorkflowError } from "@/lib/server/hoa";
import {
  buildPreferenceAwareNotificationOps,
  contentHash,
  scheduleOutboxDrain,
  type NotificationIntent,
} from "@/lib/server/notifications";
import { formatZonedDateTime } from "@/lib/server/timezone";
import type { AmenityBroadcastInput } from "@/lib/validation/amenities";

/**
 * HOA-scoped amenity communications.
 *
 * ── Why this does not use the `Broadcast` model ──────────────────────────
 *
 * `lib/server/communications.ts` composes a *global* operational broadcast: its
 * audience is named segments over every live Bundleen account, and sending one
 * is gated on the `communications:send_global` admin permission. An HOA manager
 * must never be able to reach that audience, and the most reliable way to
 * guarantee it is not to hand them the machinery at all.
 *
 * What is reused is the part that actually is delivery infrastructure — the
 * preference-aware notification builder, the durable outbox, and Resend behind
 * it. Every audience below is a query that starts from `communityId` and
 * cannot widen: there is no segment parameter, no "all HOAs" option, and no
 * path that omits the community filter.
 */

export type AmenityAudiencePreview = {
  audience: AmenityBroadcastInput["audience"];
  recipientCount: number;
  /** A few names so the manager can sanity-check who they are about to mail. */
  sample: string[];
  /** How many will get email as well as in-app, after preferences. */
  emailCount: number;
};

type Recipient = {
  id: string;
  email: string;
  name: string;
  notifyEmail: boolean;
};

/**
 * Resolves an audience inside one HOA.
 *
 * `amenityId` is required for the two booking-derived audiences; passing one
 * from another HOA resolves to nobody, because the amenity filter carries the
 * community too.
 */
async function resolveAudience(
  scope: AmenityScope,
  audience: AmenityBroadcastInput["audience"],
  amenityId: string | null,
  now: Date,
): Promise<Recipient[]> {
  if (audience === "all_residents") {
    const memberships = await db.communityMembership.findMany({
      where: {
        communityId: scope.communityId,
        status: "active",
        community: { type: "hoa" },
        user: { role: "homeowner" },
      },
      select: {
        user: {
          select: {
            id: true,
            email: true,
            fullName: true,
            homeownerProfile: { select: { notifyEmail: true } },
          },
        },
      },
    });
    return dedupe(
      memberships.map((membership) => ({
        id: membership.user.id,
        email: membership.user.email,
        name: membership.user.fullName,
        notifyEmail: membership.user.homeownerProfile?.notifyEmail !== false,
      })),
    );
  }

  if (!amenityId) {
    throw new HoaWorkflowError(
      "Choose the amenity this message is about.",
      422,
    );
  }

  // `affected_by_closure` is the same population as `upcoming_bookings`,
  // narrowed to the reservations a closure actually cancelled or will affect.
  const bookings = await db.amenityBooking.findMany({
    where: {
      communityId: scope.communityId,
      amenityId,
      startsAt: { gt: now },
      status:
        audience === "upcoming_bookings"
          ? { in: ["pending_approval", "confirmed"] }
          : { in: ["pending_approval", "confirmed", "cancelled_by_manager"] },
    },
    select: {
      user: {
        select: {
          id: true,
          email: true,
          fullName: true,
          homeownerProfile: { select: { notifyEmail: true } },
        },
      },
    },
  });

  return dedupe(
    bookings.map((booking) => ({
      id: booking.user.id,
      email: booking.user.email,
      name: booking.user.fullName,
      notifyEmail: booking.user.homeownerProfile?.notifyEmail !== false,
    })),
  );
}

function dedupe(recipients: Recipient[]): Recipient[] {
  const unique = new Map<string, Recipient>();
  for (const recipient of recipients) unique.set(recipient.id, recipient);
  return [...unique.values()];
}

export async function previewAmenityAudience(
  scope: AmenityScope,
  audience: AmenityBroadcastInput["audience"],
  amenityId: string | null,
  urgent: boolean,
  now = new Date(),
): Promise<AmenityAudiencePreview> {
  requireManager(scope);
  const recipients = await resolveAudience(scope, audience, amenityId, now);
  return {
    audience,
    recipientCount: recipients.length,
    sample: recipients.slice(0, 5).map((recipient) => recipient.name),
    emailCount: urgent
      ? recipients.length
      : recipients.filter((recipient) => recipient.notifyEmail).length,
  };
}

function requireManager(scope: AmenityScope): void {
  if (!scope.canManage) {
    throw new HoaWorkflowError("You do not manage this HOA.", 403);
  }
}

export type AmenityBroadcastResult = {
  mode: AmenityBroadcastInput["mode"];
  recipientCount: number;
  emailCount: number;
  sample: string[];
};

/**
 * Previews, test-sends, or delivers one HOA amenity message.
 *
 * ── Idempotency ──────────────────────────────────────────────────────────
 *
 * There is no draft row to key on, so the dedupe key is a hash of the message
 * itself plus a ten-minute bucket. Two clicks on `Send` produce the same key
 * and therefore one notification per resident; a genuine resend ten minutes
 * later is a different key and goes out, which is the behaviour a manager
 * correcting a closure time actually wants.
 *
 * ── The urgent override ──────────────────────────────────────────────────
 *
 * An ordinary announcement honours each resident's email preference. Marking a
 * message urgent bypasses that, so it requires a written justification and
 * writes an audit row naming the manager who claimed it.
 */
export async function sendAmenityBroadcast(
  scope: AmenityScope,
  amenityId: string | null,
  input: AmenityBroadcastInput,
  now = new Date(),
): Promise<AmenityBroadcastResult> {
  requireManager(scope);

  const urgent = input.urgent === true;
  if (urgent && !input.urgentJustification) {
    throw new HoaWorkflowError(
      "An urgent message overrides resident email preferences. Record why it is justified.",
      422,
    );
  }

  const recipients = await resolveAudience(scope, input.audience, amenityId, now);
  const emailCount = urgent
    ? recipients.length
    : recipients.filter((recipient) => recipient.notifyEmail).length;
  const sample = recipients.slice(0, 5).map((recipient) => recipient.name);

  if (input.mode === "preview") {
    return {
      mode: "preview",
      recipientCount: recipients.length,
      emailCount,
      sample,
    };
  }

  const amenity = amenityId
    ? await db.amenity.findFirst({
        where: { id: amenityId, communityId: scope.communityId },
        select: { name: true },
      })
    : null;

  const subject = amenity ? `${amenity.name}: ${input.subject}` : input.subject;
  const footer = urgent
    ? "\n\nYou are receiving this because it is an urgent notice about a shared amenity in your HOA."
    : "\n\nYou are receiving this because you are a resident of this HOA.";
  const bodyText = `${input.body}${footer}`;

  if (input.mode === "test") {
    // A test goes to the requesting manager and nobody else, and creates no
    // resident-facing record at all.
    const self = await db.user.findUnique({
      where: { id: scope.userId },
      select: { email: true },
    });
    if (self?.email) {
      await getEmailProvider().send({
        to: self.email,
        subject: `[Test] ${subject}`,
        text: bodyText,
        idempotencyKey: `amenity-broadcast-test:${scope.userId}:${contentHash([subject, input.body])}`,
      });
    }
    return { mode: "test", recipientCount: recipients.length, emailCount, sample };
  }

  const bucket = Math.floor(now.getTime() / (10 * 60_000));
  const messageKey = contentHash([
    scope.communityId,
    amenityId ?? "none",
    input.audience,
    subject,
    input.body,
    bucket,
  ]);

  const intents: NotificationIntent[] = recipients.map((recipient) => ({
    userId: recipient.id,
    email: recipient.email,
    emailPolicy: urgent ? "required" : "respect_preference",
    kind: "account",
    title: subject.slice(0, 200),
    body: bodyText,
    linkPath: amenityId
      ? `/app/homeowner/amenities/${amenityId}`
      : "/app/homeowner/amenities",
    dedupeKey: `amenity-broadcast:${messageKey}:${recipient.id}`,
  }));

  const ops = await buildPreferenceAwareNotificationOps(intents);
  await db.$transaction([
    ...ops,
    db.adminAuditLog.create({
      data: buildAuditEntry({
        actorUserId: scope.userId,
        action: "amenity_broadcast_sent",
        targetType: amenityId ? "amenity" : "community",
        targetId: amenityId ?? scope.communityId,
        communityId: scope.communityId,
        metadata: {
          via: scope.role,
          // The audience name and counts, never the message text or a
          // resident's address.
          category: input.audience,
          unitCount: recipients.length,
          ...(urgent
            ? { reason: input.urgentJustification ?? "urgent override" }
            : {}),
        },
      }),
    }),
  ]);

  scheduleOutboxDrain();

  return {
    mode: "send",
    recipientCount: recipients.length,
    emailCount,
    sample,
  };
}

/**
 * Convenience wrapper used when a manager closes an amenity: tells everyone
 * holding an affected reservation, in their HOA's own timezone.
 */
export async function notifyClosureAudience(
  scope: AmenityScope,
  amenityId: string,
  window: { start: Date; end: Date },
  reason: string,
  now = new Date(),
): Promise<number> {
  const result = await sendAmenityBroadcast(
    scope,
    amenityId,
    {
      audience: "affected_by_closure",
      subject: "Closure affecting your reservation",
      body: `${reason}\n\nAffected period: ${formatZonedDateTime(window.start, scope.timezone)} to ${formatZonedDateTime(window.end, scope.timezone)}.`,
      urgent: true,
      urgentJustification: "Operational closure affecting confirmed reservations.",
      mode: "send",
    },
    now,
  );
  return result.recipientCount;
}
