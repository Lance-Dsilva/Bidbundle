/** Circular countdown — shows time remaining as a depleting ring instead of a sentence. */
export function CountdownRing({
  hoursRemaining,
  totalHours = 72,
  size = 56,
  tone = "light",
}: {
  hoursRemaining: number;
  totalHours?: number;
  size?: number;
  tone?: "light" | "dark";
}) {
  const clamped = Math.max(0, Math.min(hoursRemaining, totalHours));
  const fraction = clamped / totalHours;
  const radius = (size - 8) / 2;
  const circumference = 2 * Math.PI * radius;
  const track = tone === "dark" ? "rgba(255,255,255,0.16)" : "var(--cream-200)";
  const label =
    clamped <= 0 ? "now" : clamped < 1 ? "<1h" : clamped < 48 ? `${Math.ceil(clamped)}h` : `${Math.round(clamped / 24)}d`;
  const textColor = tone === "dark" ? "#FAF6F0" : "var(--ink-900)";
  const subColor = tone === "dark" ? "rgba(251,247,241,0.6)" : "var(--ink-400)";
  const barColor = fraction < 0.15 ? "var(--terracotta-500)" : fraction < 0.4 ? "var(--gold-500)" : "var(--sage-500)";

  return (
    <div
      role="timer"
      aria-label={`${label} remaining`}
      style={{ position: "relative", width: size, height: size, flexShrink: 0 }}
    >
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={track} strokeWidth="4" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={barColor}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - fraction)}
          style={{ transition: "stroke-dashoffset 0.6s cubic-bezier(0.16,1,0.3,1)" }}
        />
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          lineHeight: 1,
        }}
      >
        <span style={{ fontSize: size * 0.26, fontWeight: 700, color: textColor, fontFamily: "var(--font-display)" }}>
          {label}
        </span>
        <span style={{ fontSize: size * 0.14, color: subColor, marginTop: 2, fontWeight: 600, letterSpacing: "0.04em" }}>
          {clamped <= 0 ? "CLOSING" : "LEFT"}
        </span>
      </div>
    </div>
  );
}
