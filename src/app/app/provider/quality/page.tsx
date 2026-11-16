import { QualityEvidence } from "@/components/hoa/QualityEvidence";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/server/auth";
import { QualityResolutionForm } from "@/components/hoa/QualityResolutionForm";
import { listProviderQualityClaims } from "@/lib/server/service-quality";
export const dynamic = "force-dynamic";
export default async function QualityPage() {
  if (process.env.SERVICE_QUALITY_INTAKE !== "1") notFound();
  const user = await requireRole(["provider"], "/app/provider/quality");
  const claims = await listProviderQualityClaims(user.id);
  return <div className="space-y-5"><h1 className="bb-page-heading">Service quality reports</h1>
    {claims.length === 0 && <p>No reports are waiting.</p>}
    {claims.map(claim => <section key={claim.id} className="bb-card bb-card-pad space-y-3"><h2 className="bb-card-title">{claim.reason.replaceAll("_", " ")}</h2><p>Status: {claim.resolution.replaceAll("_", " ")}</p>
    <p>{claim.ticket.messages[0]?.body}</p>
    {claim.providerResponse && <p>Provider response: {claim.providerResponse}</p>}
    {!claim.providerResponse && <QualityResolutionForm claimId={claim.id} provider />}
    <QualityEvidence claimId={claim.id} />
    </section>)}
  </div>;
}
