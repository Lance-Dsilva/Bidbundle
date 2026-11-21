import { notFound } from "next/navigation";
import { requireRole } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { PaymentRecovery } from "@/components/billing/PaymentRecovery";
import Link from "next/link";
export const dynamic = "force-dynamic";
export default async function PaymentRecoveryPage({ params }: { params: Promise<{ visitId: string }> }) {
  if (process.env.STRIPE_TEST_PAYMENTS !== "1") notFound();
  const { visitId } = await params;
  const user = await requireRole(["homeowner"], `/app/homeowner/billing/payments/${encodeURIComponent(visitId)}`);
  const payment = await db.stripeTestPayment.findUnique({ where: { visitId }, select: { residentUserId: true, amountCents: true, currency: true } });
  if (!payment || payment.residentUserId !== user.id) notFound();
  return <div className="space-y-6"><Link href="/app/homeowner/billing">Back to payment history</Link><h1 className="bb-page-heading">Review your test payment</h1>
    <p>Sandbox only. No real payment is collected. This payment belongs to the original payer for the completed visit.</p>
    <PaymentRecovery visitId={visitId} amountCents={payment.amountCents} currency={payment.currency} />
  </div>;
}
