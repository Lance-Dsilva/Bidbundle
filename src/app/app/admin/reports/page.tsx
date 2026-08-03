import { AppPageHeader } from "@/components/layout/AppPageHeader";
import { SavingsBarChart } from "@/components/admin/SavingsBarChart";
import {
  mockAdminStats,
  mockSavingsReport,
} from "@/data/mock/mockAdminDashboard";

const overviewStats = [
  { label: "Total saved", value: `$${mockAdminStats.totalSavingsAllTime.toLocaleString()}`, color: "var(--orange-600)", highlight: true },
  { label: "Active bids", value: mockAdminStats.activeBids.toString(), color: "var(--gold-600)", highlight: false },
  { label: "Members", value: mockAdminStats.totalMembers.toString(), color: "var(--teal-800)", highlight: false },
  { label: "Avg win rate", value: "92%", color: "var(--plum-600)", highlight: false },
];

export default function AdminReportsPage() {
  return (
    <div className="flex flex-col">
      <AppPageHeader
        title="Reports"
        subtitle="Oakwood Heights HOA · Savings overview"
      />
    <div className="mx-auto max-w-3xl px-4 py-7 pb-24">

      {/* Stats grid */}
      <div className="mb-5 grid grid-cols-2 gap-3">
        {overviewStats.map((stat) => (
          <div
            key={stat.label}
            className="rounded-2xl border border-divider bg-card p-5 shadow-card transition-all hover:-translate-y-0.5 hover:shadow-card-hover"
          >
            <p
              className="font-display text-[1.9rem] font-bold italic leading-none"
              style={{ color: stat.color }}
            >
              {stat.value}
            </p>
            <p className="mt-2 text-[11px] uppercase tracking-[0.12em] text-muted">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* Chart */}
      <div className="mb-5">
        <h2 className="mb-3 text-[14px] font-semibold text-foreground">Savings by category</h2>
        <SavingsBarChart categories={mockSavingsReport.categories} />
      </div>

      {/* Savings hero callout */}
      <div
        className="grain rounded-2xl p-6 text-center"
        style={{ background: "linear-gradient(135deg, var(--navy-900) 0%, var(--navy-700) 100%)" }}
      >
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/35">
          Community total · 2026
        </p>
        <p className="mt-2 font-display text-[3.5rem] font-bold italic leading-none" style={{ color: "var(--gold-500)" }}>
          ${mockAdminStats.totalSavingsAllTime.toLocaleString()}
        </p>
        <p className="mt-2 text-[13px] text-white/45">
          saved by Oakwood Heights this year
        </p>
        <div className="mt-5 flex items-center justify-center gap-6">
          {[
            { v: "14", l: "Members" },
            { v: "3", l: "Active bids" },
            { v: "92%", l: "Win rate" },
          ].map((s, i) => (
            <div key={s.l} className={`text-center ${i > 0 ? "border-l border-white/10 pl-6" : ""}`}>
              <p className="font-display text-[1.4rem] font-bold italic text-white">{s.v}</p>
              <p className="mt-0.5 text-[10px] uppercase tracking-wider text-white/30">{s.l}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
    </div>
  );
}
