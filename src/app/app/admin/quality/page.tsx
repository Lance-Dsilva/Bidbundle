import { QualityExecutionForm } from "@/components/hoa/QualityExecutionForm";
import { QualityEvidence } from "@/components/hoa/QualityEvidence";
import { requireRole } from "@/lib/server/auth";
import { QualityResolutionForm } from "@/components/hoa/QualityResolutionForm";
import { serviceQualityMetrics } from "@/lib/server/service-quality-metrics";
import { db } from "@/lib/server/db";
export const dynamic = "force-dynamic";
export default async function QualityPage() {
  const user = await requireRole(["admin"], "/app/admin/quality");
  const metrics = await serviceQualityMetrics(user.id);
  const claims = await db.serviceQualityClaim.findMany({ orderBy: { createdAt: "desc" }, take: 100, select: { id: true, reason: true, resolution: true, providerResponse: true, ticketId: true, refundOperationId: true, redoVisitId: true } });
  const grant = await db.adminAccessGrant.findUnique({ where: { userId: user.id }, select: { level: true, status: true, isStaffAccount: true } });
  const canExecute = grant?.level === "owner" && grant.status === "active" && !grant.isStaffAccount;
  const refunds = await db.stripeTestRefund.findMany({ where: { id: { in: claims.flatMap(claim => claim.refundOperationId ? [claim.refundOperationId] : []) } }, select: { id: true, amountCents: true } });
  return <div className="space-y-5"><h1 className="bb-page-heading">Service quality reports</h1>
    <section className="bb-card bb-card-pad space-y-3"><h2 className="bb-card-title">Quality in the last 30 days</h2><p className="text-sm">Review suggested above {metrics.thresholdBps / 100}% reported visits, with at least {metrics.minimumVisits} completed visits. This does not automatically restrict providers.</p><ul className="space-y-2">{metrics.providers.map(provider => <li key={provider.providerUserId}>{provider.providerName}: {provider.claims} reports / {provider.completedVisits} completed visits ({(provider.claimRateBps / 100).toFixed(1)}%){provider.reviewSuggested && <strong> — Review suggested</strong>}</li>)}</ul></section>
    {claims.length === 0 && <p>No reports are waiting.</p>}
    {claims.map(claim => <section key={claim.id} className="bb-card bb-card-pad space-y-3"><h2 className="bb-card-title">{claim.reason.replaceAll("_", " ")}</h2><p>Status: {claim.resolution.replaceAll("_", " ")}</p>
    <a className="underline" href={`/app/admin/support/${claim.ticketId}`}>Open support ticket</a>
    {claim.providerResponse && <p>Provider response: {claim.providerResponse}</p>}
    {claim.resolution === "reported" && <QualityResolutionForm claimId={claim.id} />}
    {canExecute && (claim.resolution === "refund_pending" || (claim.resolution === "redo_pending" && !claim.redoVisitId)) && <QualityExecutionForm claimId={claim.id} resolution={claim.resolution} operationId={claim.refundOperationId} amountCents={refunds.find(refund => refund.id === claim.refundOperationId)?.amountCents ?? null} />}
    <QualityEvidence claimId={claim.id} />
    </section>)}
  </div>;
}
