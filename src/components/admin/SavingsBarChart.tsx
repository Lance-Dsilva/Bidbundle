interface SavingsCategory {
  name: string;
  saved: number;
  bids: number;
}

interface SavingsBarChartProps {
  categories: SavingsCategory[];
}

const categoryColors: Record<string, { bar: string; text: string; bg: string }> = {
  Plumbing:    { bar: "#2563eb", text: "#1d4ed8", bg: "rgba(37,99,235,0.08)" },
  Landscaping: { bar: "#16a34a", text: "#15803d", bg: "rgba(22,163,74,0.08)" },
  Exterior:    { bar: "#d97706", text: "#b45309", bg: "rgba(217,119,6,0.08)" },
  Cleaning:    { bar: "#7c3aed", text: "#6d28d9", bg: "rgba(124,58,237,0.08)" },
  Handyman:    { bar: "#0891b2", text: "#0e7490", bg: "rgba(8,145,178,0.08)" },
};

const defaultColor = { bar: "#6b7280", text: "#4b5563", bg: "rgba(107,114,128,0.08)" };

export function SavingsBarChart({ categories }: SavingsBarChartProps) {
  const maxSaved = Math.max(...categories.map((c) => c.saved));

  return (
    <section className="space-y-3.5 rounded-2xl border border-divider bg-card p-5 shadow-card">
      {categories.map((cat) => {
        const pct = Math.round((cat.saved / maxSaved) * 100);
        const color = categoryColors[cat.name] ?? defaultColor;

        return (
          <div key={cat.name}>
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span
                  className="h-2 w-2 rounded-full shrink-0"
                  style={{ background: color.bar }}
                />
                <p className="text-[13px] font-medium text-foreground">{cat.name}</p>
                <span
                  className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                  style={{ background: color.bg, color: color.text }}
                >
                  {cat.bids} bid{cat.bids !== 1 ? "s" : ""}
                </span>
              </div>
              <p className="text-[13px] font-bold text-foreground">${cat.saved}</p>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-foreground/6">
              <div
                className="bar-animated h-full rounded-full"
                style={{
                  width: `${pct}%`,
                  background: `linear-gradient(90deg, ${color.bar}cc, ${color.bar})`,
                  "--bar-w": `${pct}%`,
                } as React.CSSProperties}
              />
            </div>
          </div>
        );
      })}
    </section>
  );
}
