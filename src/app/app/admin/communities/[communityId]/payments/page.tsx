import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { AdminPaymentRefund } from "@/components/billing/AdminPaymentRefund";
export const dynamic = "force-dynamic";
export default async function CommunityPayments({ params }: { params: Promise<{ communityId: string }> }) {
  const { communityId } = await params;
  const user = await requireRole(["admin"], `/app/admin/communities/${encodeURIComponent(communityId)}/payments`);
  if (process.env.STRIPE_TEST_REFUNDS !== "1" || user.adminAccessLevel !== "owner") notFound();
  const payments = await db.stripeTestPayment.findMany({ where: { communityId }, orderBy: { createdAt: "desc" }, take: 50,
    select: { visitId: true, status: true, amountCents: true, amountRefundedCents: true, updatedAt: true, refunds: { orderBy: { createdAt: "desc" }, select: { id: true, state: true, amountCents: true } } } });
  return <div className="space-y-5"><Link href={`/app/admin/communities/${encodeURIComponent(communityId)}`}>Back to community</Link>
    <h1 className="bb-page-heading">Test payments and refunds</h1><p>Sandbox only. Shows the latest 50 payments. Refunds and provider reversals are tracked separately until both finish.</p>
    {!payments.length && <p>No test payments yet.</p>}
    {payments.map(payment => <div key={`${payment.visitId}:${payment.updatedAt.toISOString()}:${payment.refunds.map(r => r.id + r.state).join(":")}`}><p className="font-semibold">Visit {payment.visitId} · {payment.status.replaceAll("_", " ")}</p>
      <AdminPaymentRefund visitId={payment.visitId} amountCents={payment.amountCents} refundedCents={payment.amountRefundedCents} operations={payment.refunds} eligible={["succeeded", "partially_refunded"].includes(payment.status)} /></div>)}
  </div>;
}
