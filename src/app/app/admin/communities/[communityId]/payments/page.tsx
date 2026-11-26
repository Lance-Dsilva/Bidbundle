import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { AdminPaymentRefund } from "@/components/billing/AdminPaymentRefund";
import { PaymentHistory } from "@/components/billing/PaymentHistory";
import { listAdminTestPayments } from "@/lib/server/stripe-test-payment-history";
export const dynamic = "force-dynamic";
export default async function CommunityPayments({ params, searchParams }: { params: Promise<{ communityId: string }>; searchParams: Promise<{ requestId?: string; after?: string }> }) {
  const { communityId } = await params;
  const user = await requireRole(["admin"], `/app/admin/communities/${encodeURIComponent(communityId)}/payments`);
  if (process.env.STRIPE_TEST_PAYMENTS !== "1") notFound();
  const filters = await searchParams;
  const requestId = typeof filters.requestId === "string" && filters.requestId ? filters.requestId : undefined;
  const history = await listAdminTestPayments(user.id, communityId, requestId, typeof filters.after === "string" ? filters.after : undefined);
  const canRefund = process.env.STRIPE_TEST_REFUNDS === "1" && user.adminAccessLevel === "owner";
  const payments = canRefund ? await db.stripeTestPayment.findMany({ where: { communityId, visitId: { in: history.payments.map(row => row.visitId) } }, orderBy: { createdAt: "desc" }, take: 50,
    select: { reconciliationHoldReason: true, visitId: true, status: true, amountCents: true, amountRefundedCents: true, updatedAt: true, refunds: { orderBy: { createdAt: "desc" }, select: { id: true, state: true, amountCents: true } } } }) : [];
  const baseHref = `/app/admin/communities/${encodeURIComponent(communityId)}/payments`;
  return <div className="space-y-5"><Link href={`/app/admin/communities/${encodeURIComponent(communityId)}`}>Back to community</Link>
    <h1 className="bb-page-heading">Test payments and refunds</h1><p>Sandbox only. Shows 50 payments per page. Refunds and provider reversals are tracked separately until both finish.</p>
    <form className="flex flex-wrap items-end gap-3"><label className="flex flex-col gap-1" htmlFor="payment-request-filter">Filter by request ID<input id="payment-request-filter" name="requestId" defaultValue={requestId ?? ""} className="min-h-11 rounded-lg border border-slate-300 px-3" /></label><button className="min-h-11 rounded-lg border border-slate-300 px-4" type="submit">Filter</button>{requestId && <Link className="inline-flex min-h-11 items-center underline" href={baseHref}>All requests</Link>}</form>
    <PaymentHistory history={history} audience="admin" baseHref={requestId ? `${baseHref}?requestId=${encodeURIComponent(requestId)}` : baseHref} />
    {canRefund && payments.length > 0 && <h2 className="text-lg font-semibold">Refund controls</h2>}
    {payments.map(payment => <div key={`${payment.visitId}:${payment.updatedAt.toISOString()}:${payment.refunds.map(r => r.id + r.state).join(":")}`}><p className="font-semibold">Visit {payment.visitId} · {payment.status.replaceAll("_", " ")}</p>
      {payment.reconciliationHoldReason ? <p className="text-sm text-amber-800">Refund controls are paused until billing reconciliation is complete.</p> : <AdminPaymentRefund visitId={payment.visitId} amountCents={payment.amountCents} refundedCents={payment.amountRefundedCents} operations={payment.refunds} eligible={["succeeded", "partially_refunded"].includes(payment.status)} />}</div>)}
  </div>;
}
