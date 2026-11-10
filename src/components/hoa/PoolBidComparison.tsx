"use client";

import { useId, useState, type ReactNode } from "react";
import { VerifiedProviderBadge } from "@/components/ui/VerifiedProviderBadge";
import type { BidSummary } from "@/lib/hoa-types";
import { compareBidQuotes } from "@/lib/bid-pricing";
import { POOL_TIER_LABELS, type PoolTemplate, type PoolTier, type PoolTierCounts } from "@/lib/pool-bid-template";

export function poolMoney(cents: number, currency = "usd") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
}
function dateLabel(value: string | null) { return value ? `${value.slice(0, 10)} UTC` : "Not provided"; }
function deadlineLabel(value: string | null) { return value ? `${new Date(value).toISOString().slice(0, 16).replace("T", " ")} UTC` : "Not provided"; }
const ROUTE_LABELS: Record<string, string> = { flexible: "Flexible", mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" };

export function PoolBidComparison({ template, bids, tierCounts, viewerPoolTier, canAward = false, managerView = false, busy = false, onAward }: {
  template: PoolTemplate; bids: BidSummary[]; tierCounts?: PoolTierCounts; viewerPoolTier?: PoolTier | null;
  canAward?: boolean; managerView?: boolean; busy?: boolean; onAward?: (bid: BidSummary) => void;
}) {
  const [sort, setSort] = useState("price");
  const id = useId();
  const now = Date.now();
  const awarded = bids.some((bid) => bid.status === "accepted");
  const masked = template.hideProviderNamesUntilAward && !awarded && !managerView;
  const eligible = bids.filter((bid) => bid.status === "submitted" && bid.providerVerified && (!bid.validUntil || new Date(bid.validUntil).getTime() > now));
  const verifiedCount = new Set(eligible.map((bid) => bid.providerUserId || bid.id)).size;
  const sorted = [...bids].sort((a, b) => {
    const tie = () => compareBidQuotes(a, b);
    if (sort === "rating") return (b.providerRating ?? -1) - (a.providerRating ?? -1) || tie();
    if (sort === "start") return (a.proposedStartDate ? new Date(a.proposedStartDate).getTime() : Infinity) - (b.proposedStartDate ? new Date(b.proposedStartDate).getTime() : Infinity) || tie();
    return tie();
  });
  const cell = "border-t border-[var(--line)] px-3 py-3 text-left align-top text-xs leading-5";
  const row = (label: string, render: (bid: BidSummary) => ReactNode) => <tr key={label}><th scope="row" className={`${cell} font-semibold text-[var(--ink-700)]`}>{label}</th>{sorted.map((bid) => <td key={bid.id} className={cell}>{render(bid)}</td>)}</tr>;
  return <section className="mt-4 min-w-0 space-y-3" aria-labelledby={`${id}-title`}>
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><h4 id={`${id}-title`} className="text-sm font-semibold text-[var(--ink-900)]">Pool bid comparison</h4><p className="mt-1 text-xs text-[var(--muted)]">{template.serviceMonths} calendar months · {template.visitsPerMonth} visits per month · {template.serviceMonths * template.visitsPerMonth} visits per home</p></div>
      <label className="text-xs font-semibold">Sort bids<select className="ml-2 min-h-11 rounded-lg border bg-white px-2" value={sort} onChange={(event) => setSort(event.target.value)}><option value="price">Whole-job price (low to high)</option><option value="rating">Rating (high to low)</option><option value="start">Earliest start</option></select></label>
    </div>
    {!awarded && <p className="text-xs text-[var(--muted)]">{verifiedCount}/3 current verified bids — target for comparison, not an award minimum.</p>}
    {masked && <p className="text-xs text-[var(--muted)]">Provider names are hidden until award. The manager sees the named bids.</p>}
    {viewerPoolTier && <p className="rounded-lg bg-[var(--teal-50)] p-3 text-xs font-semibold text-[var(--teal-800)]">Your selected tier: {POOL_TIER_LABELS[viewerPoolTier]}. Your monthly and full-term prices are shown below.</p>}
    {sorted.length > 0 && <p className="text-xs text-[var(--muted)]">Scroll horizontally to compare every provider.</p>}
    {sorted.length === 0 ? <p className="text-sm text-[var(--muted)]">No provider bids yet.</p> : <div className="max-w-full overflow-x-auto rounded-xl border border-[var(--line)]" role="region" aria-label="Pool bid comparison, scroll horizontally to compare all bids" tabIndex={0}>
      <table className="w-full min-w-[680px] border-collapse bg-[var(--paper)]">
        <caption className="sr-only">Pool bids: monthly prices by tier and the whole-job total for all locked homes and calendar months. Sort order: {sort}.</caption>
        <thead><tr><th scope="col" className="min-w-44 px-3 py-3 text-left text-xs">Terms</th>{sorted.map((bid) => <th scope="col" key={bid.id} className="min-w-56 px-3 py-3 text-left text-sm"><span>{bid.providerCompany || bid.providerName || "Provider"}</span><span className="mt-1 block text-xs font-normal">{bid.status} · version {bid.version}</span></th>)}</tr></thead>
        <tbody>
          {row("Whole-job total", (bid) => bid.pricingBasis === "total" ? <strong>{poolMoney(bid.amountCents, bid.currency)}</strong> : "Legacy unit quote — not a comparable total")}
          {template.tiers.map((tier) => row(`${POOL_TIER_LABELS[tier]} / home / month${tierCounts ? ` (${tierCounts[tier] ?? 0} homes)` : ""}`, (bid) => bid.poolQuote?.monthlyCents[tier] != null ? poolMoney(bid.poolQuote.monthlyCents[tier]!, bid.currency) : "Not quoted"))}
          {viewerPoolTier && row("Your home: monthly → full term", (bid) => { const cents = bid.poolQuote?.monthlyCents[viewerPoolTier]; return cents == null ? "Not quoted" : <strong>{poolMoney(cents, bid.currency)} /month → {poolMoney(cents * template.serviceMonths, bid.currency)} for {template.serviceMonths} months</strong>; })}
          {row("Current credential proof", (bid) => <><VerifiedProviderBadge verified={bid.providerVerified} />{!bid.providerVerified && "Current approval needed"}</>)}
          {row("Published ratings", (bid) => bid.providerRating == null ? "No published reviews" : `${bid.providerRating.toFixed(1)}/5 (${bid.providerReviewCount == null ? "review count unavailable" : `${bid.providerReviewCount} reviews`})`)}
          {row("Years in business (provider reported)", (bid) => bid.providerYearsInBusiness == null ? "Not provided" : String(bid.providerYearsInBusiness))}
          {row("Earliest start", (bid) => dateLabel(bid.poolQuote?.earliestStartDate ?? bid.proposedStartDate))}
          {row("Chemicals", (bid) => bid.poolQuote ? bid.poolQuote.chemicalsIncluded ? "Included" : "Not included; compare exclusions" : "Not provided")}
          {row("Equipment repairs", (bid) => bid.poolQuote?.equipmentRepairsExcluded ? "Excluded" : "Not provided")}
          {row("Route-day preference", (bid) => bid.poolQuote ? ROUTE_LABELS[bid.poolQuote.routeDay] : "Not provided")}
          {row("Cancellation notice", (bid) => bid.poolQuote ? `${bid.poolQuote.cancellationNoticeDays} days` : "Not provided")}
          {row("Valid until", (bid) => <>{deadlineLabel(bid.validUntil)}{bid.validUntil && new Date(bid.validUntil).getTime() <= now && <span className="block font-semibold text-amber-800">Expired — cannot award</span>}</>)}
          {!masked && row("Included work and exclusions", (bid) => <><p className="break-words">{bid.scope}</p>{bid.exclusions && <p className="mt-1 break-words">Excluded: {bid.exclusions}</p>}</>)}
          {row("Bid update history", (bid) => bid.revisions?.length ? <details><summary className="cursor-pointer font-semibold">{bid.revisions.length} recorded {bid.revisions.length === 1 ? "version" : "versions"}</summary><ol className="mt-2 space-y-2">{bid.revisions.map((revision) => <li key={revision.version}>v{revision.version} · {poolMoney(revision.amountCents, bid.currency)} · {dateLabel(revision.submittedAt)}{template.tiers.map((tier) => revision.poolQuote?.monthlyCents[tier] != null && <span className="block" key={tier}>{POOL_TIER_LABELS[tier]}: {poolMoney(revision.poolQuote.monthlyCents[tier]!, bid.currency)}/month</span>)}</li>)}</ol></details> : "No earlier recorded revisions")}
          {canAward && onAward && row("Decision", (bid) => bid.status === "accepted" ? "Accepted" : bid.status !== "submitted" || awarded ? "Not available" : <button type="button" className="min-h-11 rounded-lg bg-[var(--teal-800)] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50" disabled={busy || bid.pricingBasis !== "total" || !bid.providerVerified || !bid.poolQuote || (bid.validUntil != null && new Date(bid.validUntil).getTime() <= now)} onClick={() => onAward(bid)}>Review &amp; accept bid</button>)}
        </tbody>
      </table>
    </div>}
    <p className="text-xs leading-5 text-[var(--muted)]">Monthly prices are per home in the selected tier. The whole-job total covers all locked homes for the full term. Chemicals and repairs may be excluded. Route day is a preference; the provider confirms the actual visit plan.</p>
  </section>;
}
