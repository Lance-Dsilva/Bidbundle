import type { BidHistoryItem } from "@/data/mock/mockBidHistory";

interface BidHistoryCardProps {
  item: BidHistoryItem;
}

function getCategoryTile(category: string) {
  switch (category) {
    case "Plumbing":
      return { className: "bg-primary", label: "P" };
    case "Landscaping":
      return { className: "bg-accent", label: "L" };
    case "Cleaning":
      return { className: "bg-primary/70", label: "C" };
    case "Exterior":
      return { className: "bg-foreground", label: "E" };
    default:
      return { className: "bg-muted", label: category.charAt(0).toUpperCase() || "?" };
  }
}

function getStatusBadge(status: BidHistoryItem["status"]) {
  switch (status) {
    case "active":
      return "bg-accent/15 text-accent";
    case "won":
      return "bg-emerald-100 text-emerald-700";
    case "past":
      return "bg-muted/15 text-muted";
    default:
      return "bg-muted/15 text-muted";
  }
}

export function BidHistoryCard({ item }: BidHistoryCardProps) {
  const tile = getCategoryTile(item.category);
  const badgeClassName = getStatusBadge(item.status);

  return (
    <article className="flex items-center gap-3 rounded-card bg-card p-4 shadow-card transition-all duration-150 hover:shadow-card-hover">
      <div
        className={`flex h-10 w-10 flex-none items-center justify-center rounded-xl text-sm font-bold text-white ${tile.className}`}
      >
        {tile.label}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">{item.title}</p>
        <p className="mt-0.5 truncate text-xs text-muted">{item.provider}</p>
        <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${badgeClassName}`}>
          {item.statusLabel}
        </span>
      </div>

      <div className="flex flex-none flex-col items-end gap-1">
        <p className="text-sm font-bold text-foreground">${item.amount}</p>
        <p className="text-xs text-muted">{item.date}</p>
      </div>
    </article>
  );
}
