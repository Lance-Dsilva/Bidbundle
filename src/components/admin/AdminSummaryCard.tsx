import { mockAdminStats } from "@/data/mock/mockAdminDashboard";

interface AdminSummaryCardProps {
  stats: typeof mockAdminStats;
}

export function AdminSummaryCard({ stats }: AdminSummaryCardProps) {
  const summaryStats = [
    { label: "Members", value: stats.totalMembers.toString() },
    { label: "Active bids", value: stats.activeBids.toString() },
    { label: "Saved/mo", value: `$${stats.monthlySavings}` },
  ];

  return (
    <section className="grain rounded-card bg-surface p-5 text-white shadow-surface">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/80 text-sm font-bold text-white shadow-sm ring-2 ring-white/10">
          {stats.adminInitials}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[15px] font-semibold tracking-tight text-white">{stats.adminName}</p>
            <span className="rounded-full bg-white/8 px-2 py-0.5 text-[10px] font-semibold text-white/50 ring-1 ring-white/10">
              Admin
            </span>
          </div>
          <p className="mt-0.5 text-[12px] text-white/40">{stats.communityName}</p>
        </div>
      </div>

      <div className="my-4 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

      <div className="grid grid-cols-3 text-center">
        {summaryStats.map((stat, i) => (
          <div key={stat.label} className={i > 0 ? "border-l border-white/8" : ""}>
            <p className="font-display text-xl font-bold italic text-white">{stat.value}</p>
            <p className="mt-0.5 text-[10px] uppercase tracking-[0.12em] text-white/40">{stat.label}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
