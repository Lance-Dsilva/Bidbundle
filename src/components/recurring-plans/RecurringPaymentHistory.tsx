export type RecurringPaymentSummary = {
  id: string;
  sourceKind: 'monthly' | 'per_visit';
  localMonth: string;
  status: string;
  amountCents: number;
  currency: string;
  refundedCents: number;
  providerNetCents: number | null;
  holdReason: string | null;
  lines: {visitId: string; localDate: string; grossCents: number; refundedCents: number}[];
};

const money = (cents: number, currency: string) =>
  new Intl.NumberFormat('en-US', {style: 'currency', currency}).format(cents / 100);

const labels: Record<string, string> = {
  pending: 'Payment pending',
  succeeded: 'Paid',
  paid: 'Paid',
  failed: 'Payment unsuccessful',
  requires_action: 'Card verification needed',
  requires_payment_method: 'New payment method needed',
  refunded: 'Refunded',
  partially_refunded: 'Partially refunded',
  disputed: 'Payment disputed',
  canceled: 'Payment canceled',
};

/** Receives an already authorized projection; never renders processor identifiers. */
export function RecurringPaymentHistory({payments}: {payments: RecurringPaymentSummary[]}) {
  return <section className="bb-card bb-card-pad space-y-4" aria-label="Recurring payment history">
    <h2 className="text-xl font-semibold">Payment history</h2>
    {payments.length === 0 && <p>No recurring payments yet. Saving a card does not create a charge.</p>}
    {payments.map(payment => <article key={payment.id} className="rounded-xl border p-4 space-y-3">
      <h3 className="font-semibold">{payment.sourceKind === 'monthly' ? 'Monthly service' : 'Service visit'} · {payment.localMonth}</h3>
      <p>{payment.holdReason ? 'Billing review needed' : labels[payment.status] ?? 'Payment status unavailable'}</p>
      <dl className="grid grid-cols-2 gap-2">
        <dt>Service total</dt><dd>{money(payment.amountCents, payment.currency)}</dd>
        {payment.refundedCents > 0 && <><dt>Refunded</dt><dd>{money(payment.refundedCents, payment.currency)}</dd></>}
        {payment.providerNetCents !== null && <><dt>Provider share after refunds</dt><dd>{money(payment.providerNetCents, payment.currency)}</dd></>}
      </dl>
      {payment.providerNetCents !== null && <p className="text-sm">Provider share is not confirmation that a payout has been sent.</p>}
      {payment.holdReason && <p>This payment needs review before processing can continue.</p>}
      <details><summary className="cursor-pointer min-h-11">Included service visits ({payment.lines.length})</summary>
        <ul className="space-y-2">{payment.lines.map(line => <li key={line.visitId}>
          <time dateTime={line.localDate}>{line.localDate}</time>: {money(line.grossCents, payment.currency)}
          {line.refundedCents > 0 && ` · Refunded ${money(line.refundedCents, payment.currency)}`}
        </li>)}</ul>
      </details>
    </article>)}
  </section>;
}
