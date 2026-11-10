"use client";

import { useId } from "react";
import { POOL_TIERS, POOL_TIER_LABELS } from "@/lib/pool-bid-template";

/** Form fields only: the caller decides whether this request supports a template. */
export function PoolTemplateFields({ enabled, onEnabled }: { enabled: boolean; onEnabled: (enabled: boolean) => void }) {
  const id = useId();
  const inputClass = "mt-1 block min-h-11 w-full rounded-lg border border-[#dce7e4] bg-white px-3 text-sm";
  return <div className="rounded-xl border border-[#dce7e4] bg-[#f6faf9] p-4 md:col-span-2">
    <label className="flex min-h-11 items-start gap-2 text-sm font-semibold text-[#102a43]">
      <input className="mt-1" type="checkbox" checked={enabled} onChange={(event) => onEnabled(event.target.checked)} />
      <span>Use the standard pool-cleaning bid template</span>
    </label>
    <p className="mt-1 text-xs leading-5 text-[#64748b]">Optional requests only. Residents select a pool tier before bidding opens. Describe what standard and large mean for this request in the scope below.</p>
    {enabled && <fieldset className="mt-3 grid gap-4 sm:grid-cols-2">
      <legend className="sr-only">Pool service terms</legend>
      <label className="text-xs font-semibold text-[#334e68]">Service term (calendar months)<input className={inputClass} name="poolServiceMonths" type="number" min={1} max={24} step={1} required /></label>
      <label className="text-xs font-semibold text-[#334e68]">Required visits per month<input className={inputClass} name="poolVisitsPerMonth" type="number" min={1} max={8} step={1} required /></label>
      <fieldset className="space-y-1 sm:col-span-2" aria-describedby={`${id}-help`}>
        <legend className="text-xs font-semibold text-[#334e68]">Applicable pool tiers (choose at least one)</legend>
        {POOL_TIERS.map((tier) => <label className="flex min-h-11 items-center gap-2 text-sm" key={tier}><input type="checkbox" name="poolTier" value={tier} />{POOL_TIER_LABELS[tier]}</label>)}
      </fieldset>
      <p id={`${id}-help`} className="text-xs leading-5 text-[#64748b] sm:col-span-2">The term is limited to 104 visits per home. Visits are planned within calendar-month windows starting on the accepted date. Monthly prices cover the stated visits; no per-visit payment is implied.</p>
      <label className="flex items-start gap-2 text-xs text-[#334e68] sm:col-span-2"><input className="mt-0.5" type="checkbox" name="poolHideNames" defaultChecked /><span>Hide provider names from residents until a bid is awarded. The HOA manager continues to see names.</span></label>
    </fieldset>}
  </div>;
}
