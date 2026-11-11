import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/server/db";
import { HoaWorkflowError } from "@/lib/server/hoa";
import { normalizeEmail } from "@/lib/validation/auth";
import { buildAuditEntry } from "@/lib/server/audit";

export async function acceptBoardInvitation(input: { invitationId: string; clerkUserId: string; email: string; emailVerified: boolean; fullName: string }): Promise<"board"> {
  if (!input.emailVerified) throw new HoaWorkflowError("Verify the invited email before accepting.", 403);
  const email = normalizeEmail(input.email);
  const initial = await db.communityInvitation.findUnique({ where: { id: input.invitationId }, select: { communityId: true } });
  if (!initial) throw new HoaWorkflowError("This invitation does not exist.", 404);
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Community" WHERE id=${initial.communityId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "CommunityInvitation" WHERE id=${input.invitationId} FOR UPDATE`;
    const invitation = await tx.communityInvitation.findUnique({ where: { id: input.invitationId }, include: { community: true, acceptedBy: true } });
    if (!invitation || invitation.role !== "hoa_board" || invitation.email !== email || invitation.community.type !== "hoa" || invitation.community.status !== "active") throw new HoaWorkflowError("Use the verified email that received this board invitation.", 403);
    if (invitation.status === "accepted") {
      if (invitation.acceptedBy?.clerkUserId !== input.clerkUserId) throw new HoaWorkflowError("This invitation belongs to another account.", 403);
      return "board" as const;
    }
    if (invitation.status !== "pending" || !invitation.expiresAt || invitation.expiresAt <= new Date()) throw new HoaWorkflowError("This board invitation has expired or been revoked.", 410);
    const [byClerk, byEmail] = await Promise.all([
      tx.user.findUnique({ where: { clerkUserId: input.clerkUserId } }),
      tx.user.findUnique({ where: { email } }),
    ]);
    if ((byClerk && normalizeEmail(byClerk.email) !== email) || (byEmail && byEmail.clerkUserId !== input.clerkUserId)) throw new HoaWorkflowError("The invitation does not match this account.", 403);
    const user = await tx.user.upsert({ where: { clerkUserId: input.clerkUserId },
      create: { clerkUserId: input.clerkUserId, email, fullName: invitation.inviteeName || input.fullName || email.split("@")[0], role: "homeowner", isVerified: true, homeownerProfile: { create: {} } },
      update: { isVerified: true }, select: { id: true } });
    const now = new Date();
    await tx.communityInvitation.update({ where: { id: invitation.id, status: "pending" }, data: { status: "accepted", acceptedByUserId: user.id, acceptedAt: now } });
    await tx.communityBoardMember.upsert({ where: { communityId_userId: { communityId: invitation.communityId, userId: user.id } },
      create: { id: randomUUID(), communityId: invitation.communityId, userId: user.id, invitedByUserId: invitation.invitedByUserId, status: "active", joinedAt: now },
      update: { status: "active", joinedAt: now, revokedAt: null, invitedByUserId: invitation.invitedByUserId } });
    await tx.adminAuditLog.create({ data: buildAuditEntry({ actorUserId: user.id, action: "community_invitation_accepted", targetType: "community_invitation", targetId: invitation.id, communityId: invitation.communityId, metadata: { role: "hoa_board", status: "accepted" } }) });
    await tx.notification.createMany({ data: [{ id: randomUUID(), userId: user.id, kind: "invitation", title: "Board invitation accepted", body: "You can review community proposals and vote. Your existing account role is unchanged.", linkPath: "/app/board", dedupeKey: `board-invitation-accepted:${invitation.id}:${user.id}` }], skipDuplicates: true });
    return "board" as const;
  });
}
