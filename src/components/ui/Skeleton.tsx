import type { CSSProperties } from "react";

export function Skeleton({ style }: { style?: CSSProperties }) {
  return (
    <div
      aria-hidden
      className="skeleton-shimmer"
      style={{ borderRadius: 10, background: "var(--cream-200)", ...style }}
    />
  );
}

/* Full-page skeleton matching the standard app page: header + hero + card rows */
export function PageSkeleton() {
  return (
    <div className="px-4 pb-8 pt-6 md:px-9 md:pt-7" aria-label="Loading" role="status">
      <Skeleton style={{ height: 30, width: "50%", maxWidth: 280 }} />
      <Skeleton style={{ height: 14, width: "70%", maxWidth: 380, marginTop: 10 }} />
      <Skeleton style={{ height: 170, borderRadius: 22, marginTop: 24 }} />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.6fr_1fr]" style={{ marginTop: 22 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Skeleton style={{ height: 76, borderRadius: 18 }} />
          <Skeleton style={{ height: 76, borderRadius: 18 }} />
          <Skeleton style={{ height: 76, borderRadius: 18 }} />
        </div>
        <Skeleton style={{ height: 240, borderRadius: 22 }} />
      </div>
    </div>
  );
}
