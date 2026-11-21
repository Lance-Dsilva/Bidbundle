import { notFound } from "next/navigation";
import { requireRole } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { getVisitBillingOffer } from "@/lib/server/visit-billing-consent";
import { HoaWorkflowError } from "@/lib/server/hoa";
import { ResidentBillingCard } from "@/components/billing/ResidentBillingCard";
import { PaymentHistory } from "@/components/billing/PaymentHistory";
import { listResidentTestPayments } from "@/lib/server/stripe-test-payment-history";

export const dynamic = "force-dynamic";

export default async function ResidentBillingPage({ searchParams }: { searchParams: Promise<{ after?: string }> }) {
  const setupEnabled = process.env.STRIPE_TEST_CARD_SETUP === "1";
  const paymentsEnabled = process.env.STRIPE_TEST_PAYMENTS === "1";
  if (!setupEnabled && !paymentsEnabled) notFound();
  const user = await requireRole(["homeowner"], "/app/homeowner/billing");
  const { after } = await searchParams;
  const history = paymentsEnabled ? await listResidentTestPayments(user.id, typeof after === "string" ? after : undefined) : null;
  const visits = setupEnabled ? await db.serviceVisit.findMany({
    where: { billingPayerUserId: user.id, occurrence: { agreement: { status: "active", request: { kind: "optional_group", stripeTestEnrollmentRequired: false } } } },
    select: { occurrence: { select: { agreementId: true, agreement: { select: { request: { select: { title: true } } } } } } },
    distinct: ["occurrenceId"],
  }) : [];
  const agreements = [...new Map(visits.map(({ occurrence }) => [occurrence.agreementId, occurrence])).values()];
  const offers = await Promise.all(agreements.map(async ({ agreementId, agreement }) => {
    try {
      const offer = await getVisitBillingOffer(user.id, agreementId);
      const initialCard = offer.acceptedAt ? await db.stripeTestCard.findFirst({
        where: { agreementId, payerUserId: user.id, consent: { termsToken: offer.termsToken } },
        select: { brand: true, last4: true },
      }) : null;
      return { agreementId, title: agreement.request.title, offer, initialCard };
    } catch (error) {
      if (error instanceof HoaWorkflowError && error.status === 404) return null;
      throw error;
    }
  }));
  return <div className="space-y-6">
    <h1 className="bb-page-heading">Service payments</h1>
    <p className="bb-page-subtitle">Sandbox testing only. Use a Stripe test card. No real payment is collected.</p>
    {history && <><h2 className="text-lg font-semibold">Payment history</h2><PaymentHistory history={history} audience="resident" baseHref="/app/homeowner/billing" /></>}
    {setupEnabled && <h2 className="text-lg font-semibold">Payment setup</h2>}
    {offers.filter((item) => item !== null).map((item) => <ResidentBillingCard key={item.agreementId} {...item} />)}
    {setupEnabled && offers.every((item) => item === null) && <p>No services need payment setup.</p>}
  </div>;
}
