interface UserSummaryCardProps {
  name: string;
  neighborhood: string;
  address: string;
  activeCount: number;
  savedAmount: number;
  neighborCount: number;
}

function getInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function UserSummaryCard({
  name,
  neighborhood,
  address,
  activeCount,
  savedAmount,
  neighborCount,
}: UserSummaryCardProps) {
  const stats = [
    { label: "Active", value: activeCount.toString() },
    { label: "Saved", value: `$${savedAmount}` },
    { label: "Neighbors", value: neighborCount.toString() },
  ];

  return (
    <section className="grain rounded-card bg-surface p-5 text-white shadow-surface">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/80 text-sm font-bold text-white shadow-sm ring-2 ring-white/10">
          {getInitials(name)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold tracking-tight text-white">{name}</p>
          <p className="truncate text-[12px] text-white/40">
            {address} · {neighborhood}
          </p>
        </div>
        <span className="rounded-full bg-success/20 px-2.5 py-1 text-[10px] font-bold text-emerald-300 ring-1 ring-emerald-500/20">
          HOA ✓
        </span>
      </div>

      <div className="my-4 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

      <div className="grid grid-cols-3 text-center">
        {stats.map((stat, i) => (
          <div key={stat.label} className={i > 0 ? "border-l border-white/8" : ""}>
            <p className="font-display text-xl font-bold italic text-white">{stat.value}</p>
            <p className="mt-0.5 text-[10px] uppercase tracking-[0.12em] text-white/40">{stat.label}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
