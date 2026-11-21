import Link from "next/link";
import type { listResidentTestPayments } from "@/lib/server/stripe-test-payment-history";
type History = Awaited<ReturnType<typeof listResidentTestPayments>>;
const labels: Record<string, string> = { pending: "Processing", requires_action: "Bank verification needed", failed: "Payment failed", succeeded: "Paid", refunded: "Refunded", partially_refunded: "Partially refunded", disputed: "Disputed" };
const money = (cents: number, currency: string) => new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
export function PaymentHistory({ history, audience, baseHref }: { history: History; audience: "resident" | "provider" | "admin"; baseHref: string }) {
  return <section className="space-y-3" aria-label="Test payment history">
    {!history.payments.length && <p>No test payments recorded.</p>}
    <ul className="space-y-3">{history.payments.map(payment => <li key={payment.visitId} className="rounded-2xl border border-slate-200 p-4">
      <div className="flex flex-wrap justify-between gap-3"><div><h3 className="font-semibold">{payment.title}</h3><p className="text-sm text-slate-600">{payment.communityName} · Visit {payment.visitNumber} · {new Date(payment.createdAt).toLocaleDateString("en-US", { timeZone: "UTC" })}</p></div>
        <p className="font-semibold">{money(payment.amountCents, payment.currency)} · {labels[payment.status] ?? "Needs review"}</p></div>
      {payment.refundedCents > 0 && <p className="mt-2 text-sm">Refunded: {money(payment.refundedCents, payment.currency)}</p>}
      {audience !== "resident" && <p className="mt-2 text-sm">Provider share: {money(payment.providerCents, payment.currency)} · Original platform fee: {money(payment.feeCents, payment.currency)} · Transferred: {money(payment.transferredCents, payment.currency)} · Reversed: {money(payment.reversedCents, payment.currency)}</p>}
      {audience === "resident" && <div className="mt-3 flex flex-wrap gap-4">
        {["failed", "requires_action", "pending"].includes(payment.status) && <Link className="inline-flex min-h-11 items-center underline" href={`/app/homeowner/billing/payments/${encodeURIComponent(payment.visitId)}`}>Review payment</Link>}
        {payment.receiptAvailable && <a className="inline-flex min-h-11 items-center underline" href={`/api/hoa/payments/${encodeURIComponent(payment.visitId)}/receipt`} target="_blank" rel="noopener noreferrer">View Stripe test receipt</a>}
      </div>}
      {audience === "admin" && <p className="mt-2 break-all text-xs text-slate-600">Request: {payment.requestId} · Visit: {payment.visitId}</p>}
    </li>)}</ul>
    {history.nextCursor && <Link className="inline-flex min-h-11 items-center underline" href={`${baseHref}${baseHref.includes("?") ? "&" : "?"}after=${encodeURIComponent(history.nextCursor)}`}>Older payments</Link>}
  </section>;
}
