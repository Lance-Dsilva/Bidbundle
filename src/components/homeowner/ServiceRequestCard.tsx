import Link from "next/link";
import type { ServiceRequest } from "@/types";

interface ServiceRequestCardProps {
  request: ServiceRequest;
}

/* Category icon SVGs */
function CategoryIcon({ category }: { category: string }) {
  const props = { className: "h-4 w-4", fill: "none", viewBox: "0 0 24 24", stroke: "currentColor", strokeWidth: "1.7" };
  if (category === "Plumbing") return (
    <svg {...props}><path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17 17.25 21A2.652 2.652 0 0 0 21 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 1 1-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 0 0 4.486-6.336l-3.276 3.277a3.004 3.004 0 0 1-2.25-2.25l3.276-3.276a4.5 4.5 0 0 0-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437 1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008Z" /></svg>
  );
  if (category === "Landscaping") return (
    <svg {...props}><path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 0 0 1.5-.189m-1.5.189a6.01 6.01 0 0 1-1.5-.189m3.75 7.478a12.06 12.06 0 0 1-4.5 0m3.75 2.383a14.406 14.406 0 0 1-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 1 0-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" /></svg>
  );
  if (category === "Exterior") return (
    <svg {...props}><path strokeLinecap="round" strokeLinejoin="round" d="m2.25 12 8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" /></svg>
  );
  if (category === "Cleaning") return (
    <svg {...props}><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" /></svg>
  );
  return (
    <svg {...props}><path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17 17.25 21A2.652 2.652 0 0 0 21 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 1 1-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 0 0 4.486-6.336l-3.276 3.277a3.004 3.004 0 0 1-2.25-2.25l3.276-3.276a4.5 4.5 0 0 0-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437 1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008Z" /></svg>
  );
}

const categoryStyle: Record<string, { bg: string; color: string }> = {
  Plumbing:    { bg: "#eff6ff", color: "#2563eb" },
  Landscaping: { bg: "#f0fdf4", color: "#16a34a" },
  Exterior:    { bg: "#fefce8", color: "#ca8a04" },
  Cleaning:    { bg: "#faf5ff", color: "#7c3aed" },
};
const defaultCatStyle = { bg: "#f8fafc", color: "#64748b" };

const statusConfig: Record<ServiceRequest["status"], { label: string; bg: string; color: string; dot?: string }> = {
  live:     { label: "Live bidding", bg: "#fffbeb", color: "#b45309", dot: "#f59e0b" },
  grouping: { label: "Grouping",     bg: "#eff6ff", color: "#1d4ed8", dot: "#3b82f6" },
  draft:    { label: "Draft",        bg: "#f8fafc", color: "#64748b" },
  closed:   { label: "Closed",       bg: "#f8fafc", color: "#94a3b8" },
};

function CardInner({ request }: ServiceRequestCardProps) {
  const cat = categoryStyle[request.category] ?? defaultCatStyle;
  const status = statusConfig[request.status];
  const isClickable = request.status === "live";

  return (
    <article
      className={`group flex items-center gap-3.5 rounded-[10px] bg-white px-4 py-3.5 shadow-card transition-all duration-150 ${
        isClickable ? "hover:shadow-card-hover hover:-translate-y-px cursor-pointer" : ""
      }`}
    >
      {/* Category icon */}
      <div
        className="flex h-9 w-9 flex-none items-center justify-center rounded-lg transition-transform duration-150 group-hover:scale-105"
        style={{ background: cat.bg, color: cat.color }}
      >
        <CategoryIcon category={request.category} />
      </div>

      {/* Text */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold text-[#0f172a]">{request.title}</p>
        <p className="mt-0.5 text-[11px] text-[#64748b]">{request.neighborhood}</p>
      </div>

      {/* Right — price + status */}
      <div className="flex flex-none flex-col items-end gap-1.5">
        <p className="text-[13px] font-semibold text-[#0f172a]">
          ${request.budgetMin}–${request.budgetMax}
        </p>
        <span
          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
          style={{ background: status.bg, color: status.color }}
        >
          {status.dot && (
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: status.dot }} />
          )}
          {status.label}
        </span>
      </div>

      {isClickable && (
        <svg aria-hidden="true" className="h-4 w-4 shrink-0 text-[#cbd5e1]" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="m9 18 6-6-6-6" />
        </svg>
      )}
    </article>
  );
}

export function ServiceRequestCard({ request }: ServiceRequestCardProps) {
  if (request.status === "live") {
    return (
      <Link href="/app/homeowner/bidding-room" className="block">
        <CardInner request={request} />
      </Link>
    );
  }
  return <CardInner request={request} />;
}
