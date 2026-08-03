const PALETTE = ["#F7A688", "#7A9A7E", "#D6A23E", "#B07AA0", "#6F8DB8"];

function initialsOf(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/** Overlapping initial avatars with a +N overflow chip.
    Pass `names` for known people and/or `total` when only a count exists. */
export function AvatarStack({
  names = [],
  total,
  size = 26,
  max = 4,
  ringColor = "var(--bg-card)",
}: {
  names?: string[];
  total?: number;
  size?: number;
  max?: number;
  ringColor?: string;
}) {
  const count = total ?? names.length;
  const shown = names.slice(0, max);
  const placeholders = Math.max(0, Math.min(count, max) - shown.length);
  const overflow = count - Math.min(count, max);

  if (count <= 0) return null;

  const circle = (bg: string, content: string, i: number) => (
    <div
      key={`${content}-${i}`}
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: bg,
        border: `2px solid ${ringColor}`,
        marginLeft: i === 0 ? 0 : -size * 0.32,
        fontSize: size * 0.36,
        color: "white",
        fontWeight: 700,
        display: "grid",
        placeItems: "center",
        flexShrink: 0,
      }}
    >
      {content}
    </div>
  );

  return (
    <div aria-label={`${count} ${count === 1 ? "person" : "people"}`} style={{ display: "flex", alignItems: "center" }}>
      {shown.map((name, i) => circle(PALETTE[i % PALETTE.length], initialsOf(name), i))}
      {Array.from({ length: placeholders }, (_, i) =>
        circle(PALETTE[(shown.length + i) % PALETTE.length], "·", shown.length + i)
      )}
      {overflow > 0 ? (
        <div
          style={{
            height: size,
            minWidth: size,
            padding: "0 6px",
            borderRadius: 999,
            background: "var(--cream-200)",
            border: `2px solid ${ringColor}`,
            marginLeft: -size * 0.32,
            fontSize: size * 0.38,
            color: "var(--ink-700)",
            fontWeight: 700,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          +{overflow}
        </div>
      ) : null}
    </div>
  );
}
