import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/server/auth";
import { listProviderTestPayments } from "@/lib/server/stripe-test-payment-history";
import { PaymentHistory } from "@/components/billing/PaymentHistory";
export const dynamic = "force-dynamic";
export default async function ProviderPaymentHistory({ searchParams }: { searchParams: Promise<{ after?: string }> }) {
  if (process.env.STRIPE_TEST_PAYMENTS !== "1") notFound();
  const user = await requireRole(["provider"], "/app/provider/earnings/payments");
  const { after } = await searchParams;
  const history = await listProviderTestPayments(user.id, typeof after === "string" ? after : undefined);
  return <div className="space-y-5"><Link href="/app/provider/earnings">Back to earnings</Link><h1 className="bb-page-heading">Test payment history</h1>
    <p>Sandbox only. Transfers are movements to your test Stripe account, not deposits into a bank account. Refunds and transfer reversals can settle separately.</p>
    <PaymentHistory history={history} audience="provider" baseHref="/app/provider/earnings/payments" /></div>;
}
