import type { ProviderBidItem } from "@/data/mock/mockProviderBidHistory";

interface ProviderBidCardProps {
  bid: ProviderBidItem;
}

function getStatusStyles(status: ProviderBidItem["status"]) {
  switch (status) {
    case "won":
      return {
        iconClassName: "bg-emerald-500",
        badgeClassName: "bg-emerald-100 text-emerald-700",
      };
    case "active":
      return {
        iconClassName: "bg-primary",
        badgeClassName: "bg-accent/15 text-accent",
      };
    case "lost":
      return {
        iconClassName: "bg-muted",
        badgeClassName: "bg-red-50 text-red-500",
      };
  }
}

export function ProviderBidCard({ bid }: ProviderBidCardProps) {
  const styles = getStatusStyles(bid.status);
  const amountLabel = bid.amount === 0 ? "—" : `$${bid.amount.toLocaleString()}`;

  return (
    <article className="flex items-center gap-3 rounded-card bg-card p-4 shadow-card">
      <div
        className={`flex h-10 w-10 flex-none items-center justify-center rounded-xl text-sm font-bold text-white ${styles.iconClassName}`}
      >
        {bid.title.charAt(0).toUpperCase()}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">
          {bid.title}
        </p>
        <p className="mt-0.5 text-xs text-muted">{bid.neighborhood}</p>
        <span
          className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${styles.badgeClassName}`}
        >
          {bid.statusLabel}
        </span>
      </div>

      <div className="flex flex-none flex-col items-end gap-1">
        <p className="text-sm font-semibold text-foreground">{amountLabel}</p>
        <p className="text-xs text-muted">{bid.date}</p>
      </div>
    </article>
  );
}
