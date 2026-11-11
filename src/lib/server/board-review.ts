import "server-only";
import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/server/db";
import { HoaWorkflowError } from "@/lib/server/hoa";
import { providerVerificationSelect, providerVerificationState } from "@/lib/provider-verification";
import { parsePoolQuote } from "@/lib/pool-bid-template";
import type { BoardCommunitySummary, BoardMemberSummary, BoardPolicy, BoardProposal, BoardReviewView, BoardRoundSummary, BoardRule } from "@/lib/board-types";
import { boardCommentSchema, boardOpenSchema, boardPolicySchema, boardVoteSchema, type BoardCommentInput, type BoardOpenInput, type BoardPolicyInput, type BoardVoteInput } from "@/lib/validation/board";

export const BOARD_REMINDER_KIND = "board_vote_reminder";
const defaultPolicy: BoardPolicy = { rule: "manager_only", quorumN: null, version: 0 };
type Tx = Prisma.TransactionClient;
export async function requireBoardViewer(actorId: string, communityId: string): Promise<{ canManage: boolean }> {
  const [community, user, membership, manager] = await Promise.all([
    db.community.findUnique({ where: { id: communityId }, select: { type: true, status: true } }),
    db.user.findUnique({ where: { id: actorId }, select: { role: true, email: true, isVerified: true, adminAccess: { select: { email: true, status: true, isStaffAccount: true } } } }),
    db.communityBoardMember.findUnique({ where: { communityId_userId: { communityId, userId: actorId } } }),
    db.communityStaffAssignment.findFirst({ where: { communityId, userId: actorId, role: "hoa_manager", status: "active" }, select: { id: true } }),
  ]);
  if (community?.type !== "hoa" || community.status !== "active" || !user?.isVerified) throw new HoaWorkflowError("Board review is not available to this account.", 403);
  const admin = user.role === "admin" && user.adminAccess?.status === "active" && !user.adminAccess.isStaffAccount && user.adminAccess.email === user.email.toLowerCase();
  const canManage = !!manager || admin;
  if (!canManage && membership?.status !== "active") throw new HoaWorkflowError("Board review is not available to this account.", 403);
  return { canManage };
}
export async function requireBoardManager(actorId: string, communityId: string) {
  if (!(await requireBoardViewer(actorId, communityId)).canManage) throw new HoaWorkflowError("Only the HOA manager can manage board review.", 403);
}
function policyDto(policy: { rule: string; quorumN: number | null; version: number } | null): BoardPolicy {
  return policy ? { rule: policy.rule as BoardRule, quorumN: policy.quorumN, version: policy.version } : { ...defaultPolicy };
}
async function memberRows(communityId: string, client: Pick<Tx, "communityBoardMember"> = db): Promise<BoardMemberSummary[]> {
  const rows = await client.communityBoardMember.findMany({ where: { communityId, status: "active" }, include: { user: { select: { fullName: true, isVerified: true } } }, orderBy: { id: "asc" } });
  return rows.map(row => ({ id: row.id, userId: row.userId, name: row.user.fullName, status: row.status, isVerified: row.user.isVerified, joinedAt: row.joinedAt.toISOString() }));
}
async function audit(tx: Tx, communityId: string, actorUserId: string, kind: string, data: Prisma.InputJsonValue, requestId?: string, roundId?: string) {
  await tx.boardAuditEvent.create({ data: { id: randomUUID(), communityId, actorUserId, kind, data, requestId, roundId } });
}
async function lockCommunity(tx: Tx, communityId: string) { await tx.$queryRaw`SELECT id FROM "Community" WHERE id=${communityId} FOR UPDATE`; }
async function assertManager(tx: Tx, actorId: string, communityId: string) { await tx.$executeRaw`SELECT bundleen_assert_board_manager(${actorId},${communityId})`; }
export async function listBoardCommunities(actorId: string): Promise<BoardCommunitySummary[]> {
  const actor = await db.user.findUnique({ where: { id: actorId }, select: { role: true, email: true, isVerified: true, adminAccess: { select: { email: true, status: true, isStaffAccount: true } } } });
  if (!actor?.isVerified) return [];
  const admin = actor.role === "admin" && actor.adminAccess?.status === "active" && !actor.adminAccess.isStaffAccount && actor.adminAccess.email === actor.email.toLowerCase();
  const communities = await db.community.findMany({ where: { type: "hoa", status: "active", ...(admin ? {} : { OR: [{ boardMembers: { some: { userId: actorId, status: "active" } } }, { staffAssignments: { some: { userId: actorId, role: "hoa_manager", status: "active" } } }] }) },
    include: { boardPolicy: true, hoaRequests: { where: { status: { not: "draft" } }, select: { id: true, title: true, status: true }, orderBy: { createdAt: "desc" }, take: 100 } }, orderBy: { name: "asc" }, take: 100 });
  return Promise.all(communities.map(async community => ({ id: community.id, name: community.name, canManage: (await requireBoardViewer(actorId, community.id)).canManage,
    policy: policyDto(community.boardPolicy), members: await memberRows(community.id), requests: community.hoaRequests })));
}
async function proposalsFor(requestId: string, client: Pick<Tx, "serviceBid" | "review"> = db): Promise<BoardProposal[]> {
  const bids = await client.serviceBid.findMany({ where: { requestId, status: "submitted" }, orderBy: { amountCents: "asc" }, take: 100,
    include: { provider: { select: { fullName: true, providerProfile: { select: { ...providerVerificationSelect, companyName: true, bio: true, businessStartedYear: true, trades: true, insuranceCoverageCents: true, insuranceExpiresAt: true, licenseDocumentId: true, insuranceDocumentId: true } } } } } });
  const reviews = await client.review.groupBy({ by: ["providerUserId"], where: { providerUserId: { in: bids.map(b => b.providerUserId) }, status: "published" }, _avg: { rating: true }, _count: { rating: true } });
  return bids.map(bid => {
    const profile = bid.provider.providerProfile, rating = reviews.find(r => r.providerUserId === bid.providerUserId);
    return { bidId: bid.id, version: bid.version, providerUserId: bid.providerUserId, providerName: profile?.companyName ?? bid.provider.fullName,
      providerBio: profile?.bio ?? null, businessStartedYear: profile?.businessStartedYear ?? null, trades: profile?.trades ?? [],
      amountCents: bid.amountCents, currency: bid.currency, poolQuote: parsePoolQuote(bid.poolQuote), scope: bid.scope, exclusions: bid.exclusions,
      startDate: bid.proposedStartDate?.toISOString() ?? null, validUntil: bid.validUntil?.toISOString() ?? null,
      verified: providerVerificationState(profile).verified, rating: rating?._avg.rating ?? null, reviewCount: rating?._count.rating ?? 0,
      insuranceCoverageCents: profile?.insuranceCoverageCents ?? null, insuranceExpiresAt: profile?.insuranceExpiresAt?.toISOString() ?? null,
      licenseDocumentId: profile?.licenseDocumentId ?? null, insuranceDocumentId: profile?.insuranceDocumentId ?? null };
  });
}
export async function getBoardReview(actorId: string, requestId: string): Promise<BoardReviewView> {
  const request = await db.hoaServiceRequest.findUnique({ where: { id: requestId }, include: { community: { select: { name: true, boardPolicy: true } } } });
  if (!request) throw new HoaWorkflowError("Request not found.", 404);
  const { canManage } = await requireBoardViewer(actorId, request.communityId);
  if (request.status === "draft" && !canManage) throw new HoaWorkflowError("Request not found.", 404);
  const [members, proposals, rounds] = await Promise.all([memberRows(request.communityId), proposalsFor(requestId), db.boardReviewRound.findMany({ where: { requestId }, orderBy: { createdAt: "desc" }, take: 20,
    include: { _count: { select: { comments: true } }, votes: { include: { voter: { select: { fullName: true } } }, orderBy: { createdAt: "asc" } }, comments: { include: { author: { select: { fullName: true } } }, orderBy: { createdAt: "asc" }, take: 200 } } })]);
  const policy = policyDto(request.community.boardPolicy);
  const summaries: BoardRoundSummary[] = rounds.map(round => {
    const electorate = round.electorate as unknown as BoardMemberSummary[], snapshots = round.proposals as unknown as BoardProposal[];
    const staleReason = round.status !== "open" ? null : round.policyVersion !== policy.version ? "The approval policy changed. Open a new review." :
      members.some(m => m.isVerified === false) ? "A board member must verify their account again, or be removed before a new review." :
      JSON.stringify(electorate.map(m => [m.id, m.userId, m.joinedAt])) !== JSON.stringify(members.map(m => [m.id, m.userId, m.joinedAt])) ? "Board membership changed. Open a new review." :
      snapshots.some(s => !proposals.some(p => p.bidId === s.bidId && p.version === s.version)) ? "A shortlisted proposal changed. Open a new review." : null;
    return { id: round.id, status: round.status, rule: round.rule as BoardRule, quorumN: round.quorumN, threshold: round.threshold, deadline: round.deadline.toISOString(), createdAt: round.createdAt.toISOString(),
      electorate, proposals: snapshots, stale: !!staleReason, staleReason, awardedBidId: round.awardedBidId,
      votes: round.votes.map(v => ({ bidId: v.bidId, voterUserId: v.voterUserId, voterName: v.voter.fullName, decision: v.decision as "approve" | "reject", comment: v.comment, createdAt: v.createdAt.toISOString() })),
      commentCount: round._count.comments, commentsTruncated: round._count.comments > round.comments.length,
      comments: round.comments.map(c => ({ id: c.id, authorUserId: c.authorUserId, authorName: c.author.fullName, body: c.body, createdAt: c.createdAt.toISOString() })) };
  });
  return { request: { id: request.id, communityId: request.communityId, communityName: request.community.name, title: request.title, status: request.status }, canManage, viewerUserId: actorId, policy, members, proposals, rounds: summaries };
}
export async function setBoardPolicy(actorId: string, communityId: string, raw: BoardPolicyInput): Promise<BoardPolicy> {
  await requireBoardManager(actorId, communityId);
  const parsed = boardPolicySchema.safeParse(raw); if (!parsed.success) throw new HoaWorkflowError("Check the board approval rule.", 400);
  const input = parsed.data;
  return db.$transaction(async tx => {
    await lockCommunity(tx, communityId); await assertManager(tx, actorId, communityId);
    const existing = await tx.communityBoardPolicy.findUnique({ where: { communityId } });
    if ((existing?.version ?? 0) !== input.expectedVersion) throw new HoaWorkflowError("The board policy changed. Refresh before saving.", 409);
    const policy = await tx.communityBoardPolicy.upsert({ where: { communityId }, create: { communityId, rule: input.rule, quorumN: input.quorumN ?? null, updatedByUserId: actorId },
      update: { rule: input.rule, quorumN: input.quorumN ?? null, version: { increment: 1 }, updatedByUserId: actorId } });
    await audit(tx, communityId, actorId, "policy_changed", { rule: policy.rule, quorumN: policy.quorumN, version: policy.version });
    return policyDto(policy);
  });
}
export async function openBoardReview(actorId: string, requestId: string, raw: BoardOpenInput): Promise<{ roundId: string }> {
  const parsed = boardOpenSchema.safeParse(raw); if (!parsed.success) throw new HoaWorkflowError("Select proposals and a valid vote deadline.", 400);
  const input = parsed.data, request = await db.hoaServiceRequest.findUnique({ where: { id: requestId }, select: { communityId: true } });
  if (!request) throw new HoaWorkflowError("Request not found.", 404);
  await requireBoardManager(actorId, request.communityId);
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "HoaServiceRequest" WHERE id=${requestId} FOR UPDATE`;
    await lockCommunity(tx, request.communityId); await assertManager(tx, actorId, request.communityId);
    const current = await tx.hoaServiceRequest.findUniqueOrThrow({ where: { id: requestId } });
    if (!["open_for_bids", "bidding_closed"].includes(current.status) || !current.participantsLockedAt) throw new HoaWorkflowError("Lock enrollment and collect proposals before board review.", 409);
    const policy = policyDto(await tx.communityBoardPolicy.findUnique({ where: { communityId: current.communityId } }));
    if (policy.rule === "manager_only") throw new HoaWorkflowError("This community does not require a board vote.", 409);
    const members = await memberRows(current.communityId, tx);
    if (!members.length || members.length > 100) throw new HoaWorkflowError("Invite between one and 100 board members before voting.", 409);
    if (members.some(m => m.isVerified === false)) throw new HoaWorkflowError("Every active board member must have a verified account before review opens.", 409);
    const threshold = policy.rule === "board_majority" ? Math.floor(members.length / 2) + 1 : policy.rule === "board_unanimous" ? members.length : policy.quorumN!;
    if (threshold > members.length) throw new HoaWorkflowError("The approval requirement exceeds the active board membership.", 409);
    const all = await proposalsFor(requestId, tx), selected = input.bidIds.map(id => all.find(p => p.bidId === id));
    const deadline = new Date(input.deadline), now = new Date();
    if (deadline <= now || +deadline > +now + 30 * 86400000 || selected.some(p => !p || (p.validUntil && new Date(p.validUntil) <= deadline))) throw new HoaWorkflowError("Choose current proposals that remain valid through a deadline within 30 days.", 400);
    await tx.boardReviewRound.updateMany({ where: { requestId, status: "open" }, data: { status: "cancelled", closedAt: now } });
    const id = randomUUID();
    await tx.boardReviewRound.create({ data: { id, communityId: current.communityId, requestId, openedByUserId: actorId, policyVersion: policy.version,
      rule: policy.rule, quorumN: policy.quorumN, threshold, electorate: members as unknown as Prisma.InputJsonValue, proposals: selected as unknown as Prisma.InputJsonValue, deadline } });
    await audit(tx, current.communityId, actorId, "review_opened", { policyVersion: policy.version, threshold, proposalCount: selected.length, voterCount: members.length }, requestId, id);
    for (const member of members) {
      await tx.notification.createMany({ data: [{ id: randomUUID(), userId: member.userId, kind: "request", title: "Board proposal review opened", body: "Review the shortlisted proposals and vote before the deadline.", linkPath: `/app/board?request=${requestId}`, dedupeKey: `board-open:${id}:${member.userId}` }], skipDuplicates: true });
      const reminderAt = new Date(+deadline - 86400000);
      if (reminderAt > now) await tx.outboxEvent.create({ data: { id: randomUUID(), kind: BOARD_REMINDER_KIND, dedupeKey: `board-reminder:${id}:${member.userId}`, payload: { roundId: id, userId: member.userId }, nextAttemptAt: reminderAt } });
    }
    return { roundId: id };
  });
}
export async function castBoardVote(actorId: string, roundId: string, raw: BoardVoteInput) {
  const parsed = boardVoteSchema.safeParse(raw); if (!parsed.success) throw new HoaWorkflowError("Choose approve or reject for a shortlisted proposal.", 400);
  const round = await db.boardReviewRound.findUnique({ where: { id: roundId } }); if (!round) throw new HoaWorkflowError("Review not found.", 404);
  await requireBoardViewer(actorId, round.communityId);
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "HoaServiceRequest" WHERE id=${round.requestId} FOR UPDATE`;
    await lockCommunity(tx, round.communityId);
    await tx.$executeRaw`SELECT bundleen_assert_board_round(${roundId},true)`;
    const current = await tx.boardReviewRound.findUniqueOrThrow({ where: { id: roundId } });
    if (!(current.electorate as unknown as BoardMemberSummary[]).some(m => m.userId === actorId)) throw new HoaWorkflowError("Only this review's board electorate can vote.", 403);
    if (!(current.proposals as unknown as BoardProposal[]).some(p => p.bidId === parsed.data.bidId)) throw new HoaWorkflowError("Choose a shortlisted proposal.", 400);
    const old = await tx.boardProposalVote.findUnique({ where: { roundId_bidId_voterUserId: { roundId, bidId: parsed.data.bidId, voterUserId: actorId } } });
    if (old) {
      if (old.decision === parsed.data.decision && old.comment === (parsed.data.comment || null)) return { voted: true as const };
      throw new HoaWorkflowError("This final ballot is already recorded. Ask the manager to reopen a review if a correction is needed.", 409);
    }
    await tx.boardProposalVote.create({ data: { id: randomUUID(), roundId, bidId: parsed.data.bidId, voterUserId: actorId, decision: parsed.data.decision, comment: parsed.data.comment || null } });
    await audit(tx, round.communityId, actorId, "vote_cast", { bidId: parsed.data.bidId, decision: parsed.data.decision }, round.requestId, roundId);
    return { voted: true as const };
  });
}
export async function addBoardComment(actorId: string, roundId: string, raw: BoardCommentInput) {
  const parsed = boardCommentSchema.safeParse(raw); if (!parsed.success) throw new HoaWorkflowError("Enter a discussion message.", 400);
  const round = await db.boardReviewRound.findUnique({ where: { id: roundId } }); if (!round) throw new HoaWorkflowError("Review not found.", 404);
  await requireBoardViewer(actorId, round.communityId);
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "HoaServiceRequest" WHERE id=${round.requestId} FOR UPDATE`; await lockCommunity(tx, round.communityId);
    await tx.$executeRaw`SELECT bundleen_assert_board_viewer(${actorId},${round.communityId})`;
    const current = await tx.boardReviewRound.findUniqueOrThrow({ where: { id: roundId } });
    if (current.status !== "open") throw new HoaWorkflowError("This review is closed.", 409);
    const message = await tx.boardDiscussionMessage.create({ data: { id: randomUUID(), roundId, authorUserId: actorId, body: parsed.data.body } });
    await audit(tx, round.communityId, actorId, "discussion_added", { messageId: message.id }, round.requestId, roundId);
    return { messageId: message.id };
  });
}
export async function revokeBoardMember(actorId: string, communityId: string, memberId: string) {
  await requireBoardManager(actorId, communityId);
  await db.$transaction(async tx => { await lockCommunity(tx, communityId); await assertManager(tx, actorId, communityId);
    const member = await tx.communityBoardMember.findFirst({ where: { id: memberId, communityId } }); if (!member) throw new HoaWorkflowError("Board member not found.", 404);
    await tx.communityBoardMember.update({ where: { id: memberId }, data: { status: "revoked", revokedAt: new Date() } });
    await audit(tx, communityId, actorId, "member_revoked", { memberId, memberUserId: member.userId });
  }); return { revoked: true as const };
}
/** Worker returns only an authenticated private destination; never proposal prices or discussion. */
export async function resolveBoardReminder(payload: unknown) {
  const value = payload as { roundId?: unknown; userId?: unknown };
  if (typeof value?.roundId !== "string" || typeof value?.userId !== "string") return { kind: "skipped" as const };
  const { roundId, userId } = value as { roundId: string; userId: string };
  const initial = await db.boardReviewRound.findUnique({ where: { id: roundId }, select: { requestId: true, communityId: true } });
  if (!initial) return { kind: "skipped" as const };
  try {
    return await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "HoaServiceRequest" WHERE id=${initial.requestId} FOR UPDATE`;
      await lockCommunity(tx, initial.communityId);
      await tx.$executeRaw`SELECT bundleen_assert_board_round(${roundId},true)`;
      await tx.$executeRaw`SELECT bundleen_assert_board_viewer(${userId},${initial.communityId})`;
      const round = await tx.boardReviewRound.findUniqueOrThrow({ where: { id: roundId }, include: { votes: true } });
      if (+round.deadline - 86400000 > Date.now() || !(round.electorate as unknown as BoardMemberSummary[]).some(m => m.userId === userId) ||
        (round.proposals as unknown as BoardProposal[]).every(p => round.votes.some(v => v.voterUserId === userId && v.bidId === p.bidId))) return { kind: "skipped" as const };
      await tx.notification.createMany({ data: [{ id: randomUUID(), userId, kind: "request", title: "Board vote closes within 24 hours", body: "Review the remaining proposals before the voting deadline.", linkPath: `/app/board?request=${round.requestId}`, dedupeKey: `board-reminder:${round.id}:${userId}` }], skipDuplicates: true });
      return { kind: "sent" as const };
    });
  } catch (error) {
    // Revoked access, closed/stale rounds and elapsed deadlines are terminal;
    // infrastructure failures remain retryable by the durable outbox worker.
    if (boardWorkflowError(error)) return { kind: "skipped" as const };
    throw error;
  }
}

/** SQL failures are deliberately translated without exposing database detail. */
export function boardWorkflowError(error: unknown): HoaWorkflowError | null {
  // Prisma may expose a PostgreSQL code directly, in P2010 metadata, or in
  // the driver's nested cause. Inspect only structured codes: message text can
  // contain user data, and arbitrary error metadata can be circular.
  const codes = new Set<string>();
  const visited = new Set<object>();
  const inspect = (value: unknown, depth: number) => {
    if (depth > 5 || typeof value !== "object" || value === null || visited.has(value)) return;
    visited.add(value);
    const entry = value as Record<string, unknown>;
    for (const field of ["code", "originalCode"] as const) if (typeof entry[field] === "string") codes.add(entry[field]);
    for (const field of ["meta", "cause", "driverAdapterError"] as const) inspect(entry[field], depth + 1);
  };
  inspect(error, 0);
  if (codes.has("P1761")) return new HoaWorkflowError("Board access changed. Ask your HOA manager to check your membership.", 403);
  if (codes.has("P1762")) return new HoaWorkflowError("The board review, membership or proposal changed, the deadline passed, or the required approvals are missing. Refresh the review before continuing.", 409);
  return null;
}
export async function assertBoardAwardReady(actorId: string, requestId: string, bidId: string, version: number) {
  try {
    await db.$executeRaw`SELECT bundleen_assert_board_award(${requestId},${bidId},${version}::integer)`;
    const round = await db.boardReviewRound.findFirst({ where: { requestId, status: "open" }, select: { communityId: true } });
    if (round) await requireBoardManager(actorId, round.communityId);
  } catch (error) { throw boardWorkflowError(error) ?? error; }
}
export async function cancelBoardReview(actorId: string, roundId: string) {
  const round = await db.boardReviewRound.findUnique({ where: { id: roundId } });
  if (!round) throw new HoaWorkflowError("Review not found.", 404);
  await requireBoardManager(actorId, round.communityId);
  await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "HoaServiceRequest" WHERE id=${round.requestId} FOR UPDATE`;
    await lockCommunity(tx, round.communityId); await assertManager(tx, actorId, round.communityId);
    const current = await tx.boardReviewRound.findUniqueOrThrow({ where: { id: roundId } });
    if (current.status === "cancelled") return;
    if (current.status !== "open") throw new HoaWorkflowError("The award has already been confirmed.", 409);
    await tx.boardReviewRound.update({ where: { id: roundId }, data: { status: "cancelled", closedAt: new Date() } });
    await audit(tx, round.communityId, actorId, "review_cancelled", {}, round.requestId, roundId);
  });
  return { cancelled: true as const };
}
