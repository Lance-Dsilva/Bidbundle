const GRADIENT = "linear-gradient(90deg,#0F9D8A,#35B7A5)";

export function StepProgress({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center" aria-label={`Step ${current} of ${total}`}>
      {Array.from({ length: total }, (_, i) => i + 1).map((n) => (
        <div key={n} className="flex items-center">
          <span
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white transition-all duration-500 ease-[cubic-bezier(.34,1.56,.64,1)]"
            style={{
              background: n <= current ? GRADIENT : "var(--cream-200)",
              color: n <= current ? "#fff" : "var(--ink-400)",
              transform: n === current ? "scale(1.2)" : "scale(1)",
              boxShadow: n === current ? "0 4px 12px rgba(15,157,138,.35)" : "none",
            }}
          >
            {n < current ? "✓" : ""}
          </span>
          {n < total ? (
            <span
              className="h-[3px] w-8 transition-all duration-500"
              style={{ background: n < current ? GRADIENT : "var(--cream-200)" }}
            />
          ) : null}
        </div>
      ))}
    </div>
  );
}
