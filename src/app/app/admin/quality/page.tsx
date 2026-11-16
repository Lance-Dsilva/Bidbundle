import { QualityEvidence } from "@/components/hoa/QualityEvidence";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/server/auth";
import { QualityResolutionForm } from "@/components/hoa/QualityResolutionForm";
import { db } from "@/lib/server/db";
export const dynamic = "force-dynamic";
export default async function QualityPage() {
  if (process.env.SERVICE_QUALITY_INTAKE !== "1") notFound();
  const user = await requireRole(["admin"], "/app/admin/quality");
  const claims = await db.serviceQualityClaim.findMany({ orderBy: { createdAt: "desc" }, take: 100, select: { id: true, reason: true, resolution: true, providerResponse: true, ticketId: true } });
  return <div className="space-y-5"><h1 className="bb-page-heading">Service quality reports</h1>
    {claims.length === 0 && <p>No reports are waiting.</p>}
    {claims.map(claim => <section key={claim.id} className="bb-card bb-card-pad space-y-3"><h2 className="bb-card-title">{claim.reason.replaceAll("_", " ")}</h2><p>Status: {claim.resolution.replaceAll("_", " ")}</p>
    <a className="underline" href={`/app/admin/support/${claim.ticketId}`}>Open support ticket</a>
    {claim.providerResponse && <p>Provider response: {claim.providerResponse}</p>}
    {claim.resolution === "reported" && <QualityResolutionForm claimId={claim.id} />}
    <QualityEvidence claimId={claim.id} />
    </section>)}
  </div>;
}
