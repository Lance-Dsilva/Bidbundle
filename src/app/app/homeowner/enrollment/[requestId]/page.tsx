import { requireRole } from "@/lib/server/auth";
import { getEnrollmentBillingOffer } from "@/lib/server/enrollment-billing";
import { EnrollmentBilling } from "@/components/billing/EnrollmentBilling";
import { HoaWorkflowError } from "@/lib/server/hoa";
import { notFound } from "next/navigation";
export const dynamic = "force-dynamic";
export default async function EnrollmentPage({ params }: { params: Promise<{ requestId: string }> }) {
  if (process.env.STRIPE_TEST_PAYMENTS !== "1") notFound();
  const { requestId } = await params;
  const user = await requireRole(["homeowner"], `/app/homeowner/enrollment/${encodeURIComponent(requestId)}`);
  try {
    const offer = await getEnrollmentBillingOffer(user.id, requestId);
    return <div className="space-y-6"><h1 className="bb-page-heading">Join {offer.title}</h1><EnrollmentBilling requestId={requestId} offer={offer} /></div>;
  } catch (error) {
    if (error instanceof HoaWorkflowError) return <p role="status">{error.message}</p>;
    throw error;
  }
}
