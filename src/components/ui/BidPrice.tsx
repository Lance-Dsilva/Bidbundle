import { calculateQuoteBreakdown } from "@/lib/bid-pricing";

type QuotePrice = {
  amountCents: number;
  currency: string;
  pricingBasis: "total" | "per_home" | "per_visit";
  homeCount?: number;
  totalOccurrences?: number;
};

function currencyAmount(cents: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency", currency: currency.toUpperCase(),
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(cents / 100);
}

/** The stored whole-job price is authoritative; averages are display-only. */
export function BidPrice({ bid, homeCount, totalOccurrences }: {
  bid: QuotePrice;
  homeCount?: number;
  totalOccurrences?: number;
}) {
  if (bid.pricingBasis !== "total") {
    return (
      <div className="space-y-1 text-xs" style={{ color: "var(--ink-700, #334e68)" }}>
        <p><strong>{currencyAmount(bid.amountCents, bid.currency)}</strong> {bid.pricingBasis === "per_home" ? "per home" : "per visit"} ({bid.currency.toUpperCase()}, original quote)</p>
        <p className="font-semibold" style={{ color: "#92400e" }}>Legacy unit quote — not comparable to whole-job totals.</p>
      </div>
    );
  }

  const homes = homeCount ?? bid.homeCount;
  const visits = totalOccurrences ?? bid.totalOccurrences;
  const breakdown = calculateQuoteBreakdown(bid.amountCents, homes, visits);
  return (
    <div className="space-y-1 text-xs" style={{ color: "var(--ink-700, #334e68)" }}>
      <p><strong>{currencyAmount(bid.amountCents, bid.currency)}</strong> whole-job total ({bid.currency.toUpperCase()})</p>
      {breakdown.perHomeCents !== null ? (
        <p>≈ {currencyAmount(breakdown.perHomeCents, bid.currency)} per home for the full job</p>
      ) : null}
      {breakdown.perHomeVisitCents !== null ? (
        <p>≈ {currencyAmount(breakdown.perHomeVisitCents, bid.currency)} per home per visit</p>
      ) : null}
      {breakdown.perHomeVisitCents !== null ? (
        <p>{homes} {homes === 1 ? "home" : "homes"} × {visits} {visits === 1 ? "visit" : "visits"} each. Averages are approximate.</p>
      ) : breakdown.perHomeCents !== null ? <p>Average is approximate.</p> : null}
    </div>
  );
}

/** No deadline exceptions: old unit quotes need a fresh whole-job offer. */
export function LegacyBidNotice({ requestStatus }: { requestStatus?: string }) {
  return (
    <p className="mt-2 text-xs leading-relaxed" style={{ color: "#92400e" }}>
      This unit-priced quote cannot be newly awarded.{" "}
      {requestStatus === "open_for_bids"
        ? "The provider must resubmit a whole-job total before bidding closes."
        : requestStatus === "bidding_closed"
          ? "Bidding is closed. The manager must open a new request to obtain a whole-job total."
          : "If bidding is open, the provider must resubmit a whole-job total. If bidding is closed, the manager must open a new request."}
    </p>
  );
}
