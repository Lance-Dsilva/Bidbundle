import "server-only";

import { randomUUID } from "node:crypto";
import { db } from "@/lib/server/db";

export const VISIT_REVIEW_PROMPT_KIND = "visit_review_prompt";
export const VISIT_REVIEW_DELAY_MS = 2 * 60 * 60 * 1000;

/** Queue only an opaque visit identity; the worker resolves live recipients. */
export function buildVisitReviewPromptData(visitId: string, completedAt: Date, recipientUserId: string | null) {
  return {
    id: randomUUID(), kind: VISIT_REVIEW_PROMPT_KIND, dedupeKey: `visit-review-prompt:${visitId}`,
    payload: { visitId, recipientUserId }, nextAttemptAt: new Date(completedAt.getTime() + VISIT_REVIEW_DELAY_MS), updatedAt: completedAt,
  };
}

type Outcome = { kind: "skipped"; reason: string } | { kind: "sent"; email: { to: string; subject: string; text: string } | null };

/** No inbox or email before the two-hour delay; retries retain one logical prompt. */
export async function resolveVisitReviewPrompt(payload: unknown, appUrl: (path: string) => string, now = new Date()): Promise<Outcome> {
  const input = payload as { visitId?: unknown; recipientUserId?: unknown } | null;
  if (typeof input?.visitId !== "string" || !input.visitId || input.visitId.length > 64 ||
    typeof input.recipientUserId !== "string" || !input.recipientUserId || input.recipientUserId.length > 64) return { kind: "skipped", reason: "missing" };
  const visit = await db.serviceVisit.findUnique({
    where: { id: input.visitId },
    select: {
      id: true, status: true, completedAt: true, homeownerUserId: true, unitId: true,
      homeowner: { select: { id: true, role: true, email: true, homeownerProfile: { select: { notifyEmail: true } }, communityMemberships: { where: { status: "active" }, select: { communityId: true, unitId: true } } } },
      unit: { select: { memberships: { where: { status: "active", userId: input.recipientUserId }, select: { user: { select: { id: true, role: true, email: true, homeownerProfile: { select: { notifyEmail: true } } } } }, take: 1 } } },
      reviews: { select: { reviewerUserId: true } },
      occurrence: { select: { agreement: { select: { communityId: true, community: { select: { type: true, status: true } }, request: { select: { title: true } } } } } },
    },
  });
  if (!visit || visit.status !== "completed" || !visit.completedAt || visit.occurrence.agreement.community.status !== "active") return { kind: "skipped", reason: "not_completed" };
  // The row's nextAttemptAt is not trusted as an independent source of timing.
  if (visit.completedAt.getTime() + VISIT_REVIEW_DELAY_MS > now.getTime()) throw new Error("Visit review prompt is not due.");
  const resident = visit.unitId ? visit.unit?.memberships[0]?.user : visit.homeowner;
  if (!resident || resident.id !== input.recipientUserId || resident.role !== "homeowner") return { kind: "skipped", reason: "inactive_recipient" };
  if (!visit.unitId && !visit.homeowner?.communityMemberships.some((membership) => membership.communityId === visit.occurrence.agreement.communityId)) return { kind: "skipped", reason: "inactive_recipient" };
  if (visit.reviews.some((review) => review.reviewerUserId === resident.id)) return { kind: "skipped", reason: "already_reviewed" };
  const path = visit.occurrence.agreement.community.type === "neighborhood" ? "/app/homeowner/neighbourhood" : "/app/homeowner/community";
  const title = "How was your service visit?";
  const body = `Your visit for “${visit.occurrence.agreement.request.title}” is complete. Review the service photos and leave a 1–5 star rating; a comment is optional.`;
  await db.notification.createMany({ data: [{
    id: randomUUID(), userId: resident.id, kind: "review", title, body, linkPath: path,
    dedupeKey: `visit-review-prompt:${visit.id}:${resident.id}`,
  }], skipDuplicates: true });
  return { kind: "sent", email: resident.homeownerProfile?.notifyEmail === false || !resident.email ? null : {
    to: resident.email, subject: title, text: `${body}\n\nOpen Bundleen: ${appUrl(path)}`,
  } };
}
