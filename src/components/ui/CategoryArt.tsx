import type { CSSProperties, ReactNode } from "react";

/* Warm illustrated category tiles — the app's image layer.
   Each category gets a gradient scene + a bold glyph, so list rows,
   hero bands, and pickers all carry a visual anchor instead of text. */

interface CategoryTheme {
  from: string;
  to: string;
  fg: string;
  glyph: ReactNode;
}

function themeFor(category: string): CategoryTheme {
  const c = category.toLowerCase();
  if (c.includes("plumb") || c.includes("pipe"))
    return {
      from: "#6F8DB8", to: "#3F608E", fg: "#EAF1FA",
      glyph: (
        <g fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M7 4v6a3 3 0 0 0 3 3h4a3 3 0 0 1 3 3v4" />
          <path d="M4.5 4h5M14.5 20h5" />
          <path d="M11 7.5c-.9 1.5-.9 2.5 0 3M13.8 6c-1.4 2.2-1.4 3.8 0 6" opacity="0.55" />
        </g>
      ),
    };
  if (c.includes("lawn") || c.includes("landscap") || c.includes("garden"))
    return {
      from: "#7A9A7E", to: "#4A6A4D", fg: "#EDF5EE",
      glyph: (
        <g fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 20c1.5-4 1-8-1-11 4 .5 6.5 3 7.5 7M12 20c0-5 1.5-9 5-12-0.5 5-1.5 9-3 12" />
          <path d="M19 20c.8-2.5 2-4 3.5-5-1 3-1.5 4.5-2 5" opacity="0.6" />
          <path d="M2 20h20" />
        </g>
      ),
    };
  if (c.includes("hvac") || c.includes("air") || c.includes("heat"))
    return {
      from: "#B07AA0", to: "#7A4A6E", fg: "#F6ECF3",
      glyph: (
        <g fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="2.4" />
          <path d="M12 9.6c0-3 1.4-4.6 3.4-4.6 1.8 0 2.6 1.4 2.4 2.6M14.1 13.4c2.6 1.5 4.7 1.3 5.7-.4.9-1.6 0-3-1.2-3.4M9.9 13.4c-2.6 1.5-2.9 3.6-1.9 5.3.9 1.6 2.6 1.6 3.4.8" />
        </g>
      ),
    };
  if (c.includes("clean"))
    return {
      from: "#D6A23E", to: "#B8862B", fg: "#FBF4E3",
      glyph: (
        <g fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="9" cy="10" r="4.2" />
          <circle cx="16" cy="7" r="2" opacity="0.7" />
          <circle cx="16.5" cy="14" r="1.3" opacity="0.5" />
          <path d="M6 19.5c2-1.2 6.5-1.2 9 0" />
        </g>
      ),
    };
  if (c.includes("gutter") || c.includes("roof"))
    return {
      from: "#F7A688", to: "#E8623F", fg: "#FCEFE6",
      glyph: (
        <g fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 10.5 12 4l9 6.5" />
          <path d="M5.5 9.5V13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V9.5" />
          <path d="M8.5 18.5v.01M12 17.5v.01M15.5 18.5v.01" strokeWidth="2.2" opacity="0.7" />
        </g>
      ),
    };
  if (c.includes("electric"))
    return {
      from: "#D6A23E", to: "#9C6F1E", fg: "#FBF4E3",
      glyph: (
        <g fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M13 3 5.5 13.5H11L9.8 21l7.7-10.5H12z" />
        </g>
      ),
    };
  if (c.includes("handy") || c.includes("repair") || c.includes("exterior"))
    return {
      from: "#8A8E96", to: "#5C5344", fg: "#F3F0EA",
      glyph: (
        <g fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M13.5 6.5a4 4 0 0 1 5.6 5L11 19.6 6 21l1.4-5L15.5 7.9z" />
          <path d="M14.5 5.5 18.5 9.5" opacity="0.6" />
        </g>
      ),
    };
  // default / other
  return {
    from: "#F7A688", to: "#E8623F", fg: "#FCEFE6",
    glyph: (
      <g fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 10.5 12 4l8 6.5" />
        <path d="M6.5 9.75V20h11V9.75" />
        <path d="M10 20v-5.5h4V20" />
      </g>
    ),
  };
}

/** Small rounded tile for list rows and pickers. */
export function CategoryTile({ category, size = 42 }: { category: string; size?: number }) {
  const t = themeFor(category);
  return (
    <div
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.28,
        flexShrink: 0,
        background: `linear-gradient(135deg, ${t.from}, ${t.to})`,
        color: t.fg,
        display: "grid",
        placeItems: "center",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.25), 0 2px 6px -2px rgba(31,26,20,0.3)",
      }}
    >
      <svg viewBox="0 0 24 24" width={size * 0.55} height={size * 0.55}>
        {t.glyph}
      </svg>
    </div>
  );
}

/** Wide banner scene for hero cards — gradient, dot texture, oversized glyph. */
export function CategoryBanner({ category, height = 120, style }: { category: string; height?: number; style?: CSSProperties }) {
  const t = themeFor(category);
  return (
    <div
      aria-hidden
      style={{
        height,
        position: "relative",
        overflow: "hidden",
        background: `linear-gradient(120deg, ${t.from}, ${t.to})`,
        color: t.fg,
        ...style,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.16) 1px, transparent 1px)",
          backgroundSize: "18px 18px",
        }}
      />
      <svg
        viewBox="0 0 24 24"
        width={height * 1.3}
        height={height * 1.3}
        style={{ position: "absolute", right: -height * 0.18, top: -height * 0.12, opacity: 0.3, transform: "rotate(-8deg)" }}
      >
        {t.glyph}
      </svg>
      <svg
        viewBox="0 0 24 24"
        width={height * 0.52}
        height={height * 0.52}
        style={{ position: "absolute", left: 24, bottom: height * 0.18 }}
      >
        {t.glyph}
      </svg>
    </div>
  );
}
