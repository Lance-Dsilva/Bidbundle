import type { BidRoomEntry } from "@/data/mock/mockBiddingRoom";

interface BidCardProps {
  bid: BidRoomEntry;
  isSelected: boolean;
  onSelect: () => void;
}

export function BidCard({ bid, isSelected, onSelect }: BidCardProps) {
  return (
    <button
      aria-pressed={isSelected}
      className={`relative w-full rounded-2xl p-4 text-left transition-all duration-200 active:scale-[0.99] ${
        isSelected
          ? "border-2 border-accent-bright bg-card shadow-card-hover"
          : "border border-divider bg-card shadow-card hover:shadow-card-hover hover:-translate-y-0.5"
      }`}
      type="button"
      onClick={onSelect}
    >
      {/* BEST badge — placed in top-left, not overlapping price */}
      {bid.isLeading && (
        <span className="mb-3 inline-flex items-center rounded-full bg-accent-bright px-2.5 py-0.5 text-[10px] font-bold text-white">
          ✦ BEST VALUE
        </span>
      )}

      <div className="flex items-center gap-3">
        <div
          className={`flex h-11 w-11 flex-none items-center justify-center rounded-2xl text-sm font-bold text-white shadow-sm transition-colors ${
            isSelected ? "bg-accent-bright" : "bg-surface"
          }`}
        >
          {bid.providerInitials}
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold tracking-tight text-foreground">{bid.providerName}</p>
          <div className="mt-0.5 flex items-center gap-2">
            <span className="text-[12px] font-semibold text-accent-bright">★ {bid.rating}</span>
            <span className="text-[12px] text-muted">{bid.jobsCompleted} jobs</span>
          </div>
        </div>

        <div className="flex flex-none flex-col items-end gap-0.5">
          <span
            className={`font-display text-[20px] font-bold italic ${
              isSelected ? "text-accent-bright" : "text-foreground"
            }`}
          >
            ${bid.amount}
          </span>
          <span className="text-[11px] text-muted">{bid.estimatedDays}d est.</span>
        </div>
      </div>

      {isSelected && (
        <div className="mt-3 flex items-center gap-1.5 border-t border-divider pt-2.5">
          <svg className="h-3.5 w-3.5 text-accent-bright" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.2">
            <path strokeLinecap="round" strokeLinejoin="round" d="m5 12 5 5L19 8" />
          </svg>
          <span className="text-[12px] font-semibold text-accent-bright">Selected</span>
        </div>
      )}
    </button>
  );
}
