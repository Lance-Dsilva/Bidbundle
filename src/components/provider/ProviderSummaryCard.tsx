import { mockProviderStats } from "@/data/mock/mockProviderDashboard";

interface ProviderSummaryCardProps {
  stats: typeof mockProviderStats;
}

export function ProviderSummaryCard({ stats }: ProviderSummaryCardProps) {
  const summaryStats = [
    { label: "Revenue", value: `$${stats.revenueEarned.toLocaleString()}` },
    { label: "Jobs", value: stats.jobsCompleted.toString() },
    { label: "Rating", value: `${stats.rating}★` },
  ];

  return (
    <section className="grain rounded-card bg-surface p-5 text-white shadow-surface">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/80 text-sm font-bold text-white shadow-sm ring-2 ring-white/10">
          {stats.initials}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[15px] font-semibold tracking-tight text-white">{stats.businessName}</p>
            <span className="rounded-full bg-success/20 px-2 py-0.5 text-[10px] font-bold text-emerald-300 ring-1 ring-emerald-500/20">
              VERIFIED
            </span>
          </div>
          <p className="mt-0.5 text-[12px] text-white/40">{stats.tagline}</p>
        </div>
      </div>

      <div className="my-4 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

      <div className="grid grid-cols-3 text-center">
        {summaryStats.map((item, i) => (
          <div key={item.label} className={i > 0 ? "border-l border-white/8" : ""}>
            <p className="font-display text-xl font-bold italic text-white">{item.value}</p>
            <p className="mt-0.5 text-[10px] uppercase tracking-[0.12em] text-white/40">{item.label}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
