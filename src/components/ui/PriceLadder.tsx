import { priceLadderProgress, type PriceLadderTier } from "@/lib/price-ladder";

/** Render only a persisted provider commitment, never a speculative discount. */
export function PriceLadder({ tiers, joinedHomes, currency = "usd", guaranteedPerHomeCents }: {
  tiers: PriceLadderTier[]; joinedHomes: number; currency?: string; guaranteedPerHomeCents?: number;
}) {
  const progress = priceLadderProgress(tiers, joinedHomes);
  const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
  return <section aria-label="Group price ladder" className="rounded-xl border border-teal-200 bg-teal-50 p-4 text-sm text-slate-800">
    <p className="font-semibold">{joinedHomes} {joinedHomes === 1 ? "home" : "homes"} joined</p>
    <ol className="my-3 space-y-2">
      {progress.tiers.map((tier, index) => <li key={tier.minHomes} aria-current={index === progress.currentIndex ? "step" : undefined} className={index === progress.currentIndex ? "font-bold text-teal-800" : "text-slate-600"}>
        {tier.minHomes}+ {tier.minHomes === 1 ? "home" : "homes"}: {money(tier.perHomeCents)} per home for the full service term{index === progress.currentIndex ? " — current price" : ""}
      </li>)}
    </ol>
    {guaranteedPerHomeCents != null && guaranteedPerHomeCents < progress.current.perHomeCents ? <p className="font-semibold">Your protected group price: {money(guaranteedPerHomeCents)} per home for the full service term.</p> : null}
    <p role="status">{progress.next ? `${progress.homesToNext} more ${progress.homesToNext === 1 ? "home" : "homes"} to unlock ${money(progress.next.perHomeCents)}` : "Lowest group price unlocked"}</p>
    <p className="mt-2 text-xs">Your final price is set when enrollment closes and will never exceed the price confirmed when you join.</p>
  </section>;
}
