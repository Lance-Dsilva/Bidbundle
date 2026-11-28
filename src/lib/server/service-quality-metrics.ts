import "server-only";
import { db } from "@/lib/server/db";
import { HoaWorkflowError } from "@/lib/server/hoa";
import { qualityReviewSignal } from "@/lib/service-quality-metrics";

export async function serviceQualityMetrics(adminId: string, now = new Date()) {
  const actor = await db.user.findUnique({ where: { id: adminId }, include: { adminAccess: true } });
  if (actor?.role !== "admin" || actor.adminAccess?.isStaffAccount || !actor.isVerified || actor.adminAccess?.status !== "active" || actor.adminAccess.email !== actor.email.toLowerCase()) throw new HoaWorkflowError("Administrator access required.", 403);
  const threshold = process.env.SERVICE_QUALITY_FLAG_RATE_BPS ?? "2000";
  const minimum = process.env.SERVICE_QUALITY_FLAG_MIN_VISITS ?? "5";
  if (!/^\d+$/.test(threshold) || Number(threshold) > 10000 || !/^\d+$/.test(minimum) || Number(minimum) < 1 || Number(minimum) > 10000) throw new HoaWorkflowError("Quality review thresholds need configuration.", 503);
  const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  // Numerator and denominator use the same completed-visit cohort, not ticket creation dates.
  const rows = await db.$queryRaw<Array<{ providerUserId: string; providerName: string | null; completedVisits: bigint; claims: bigint }>>`
    SELECT agreement."providerUserId", provider."fullName" AS "providerName",
      count(visit."id") AS "completedVisits", count(claim."id") AS "claims"
    FROM "ServiceVisit" visit
    JOIN "ServiceOccurrence" occurrence ON occurrence."id" = visit."occurrenceId"
    JOIN "ServiceAgreement" agreement ON agreement."id" = occurrence."agreementId"
    JOIN "User" provider ON provider."id" = agreement."providerUserId"
    LEFT JOIN "ServiceQualityClaim" claim ON claim."visitId" = visit."id"
    WHERE visit."status" = 'completed' AND visit."completedAt" >= ${start} AND visit."completedAt" <= ${now}
    GROUP BY agreement."providerUserId", provider."fullName"
    ORDER BY count(claim."id") DESC, agreement."providerUserId" LIMIT 100
  `;
  return { start: start.toISOString(), end: now.toISOString(), thresholdBps: Number(threshold), minimumVisits: Number(minimum), providers: rows.map(row => ({
    providerUserId: row.providerUserId, providerName: row.providerName ?? "Provider", ...qualityReviewSignal(Number(row.claims), Number(row.completedVisits), Number(threshold), Number(minimum)),
  })) };
}
