import Link from "next/link";
import type { ReactNode } from "react";

/** Standard empty state: visual + one line + one action. Replaces bare grey sentences. */
export function EmptyState({
  icon,
  title,
  hint,
  ctaLabel,
  ctaHref,
  onCta,
}: {
  icon: ReactNode;
  title: string;
  hint?: string;
  ctaLabel?: string;
  ctaHref?: string;
  onCta?: () => void;
}) {
  const cta = ctaLabel ? (
    ctaHref ? (
      <Link
        href={ctaHref}
        style={{
          display: "inline-flex", alignItems: "center", gap: 8, marginTop: 18,
          height: 40, padding: "0 20px", borderRadius: 999,
          fontSize: 14, fontWeight: 600,
          background: "var(--terracotta-600)", color: "white", textDecoration: "none",
          boxShadow: "0 6px 14px -6px rgba(232,98,63,0.5)",
        }}
      >
        {ctaLabel}
      </Link>
    ) : (
      <button
        onClick={onCta}
        style={{
          display: "inline-flex", alignItems: "center", gap: 8, marginTop: 18,
          height: 40, padding: "0 20px", borderRadius: 999,
          fontSize: 14, fontWeight: 600, cursor: "pointer", border: 0,
          background: "var(--terracotta-600)", color: "white",
          boxShadow: "0 6px 14px -6px rgba(232,98,63,0.5)",
          fontFamily: "var(--font-body)",
        }}
      >
        {ctaLabel}
      </button>
    )
  ) : null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
        padding: "44px 24px",
      }}
    >
      <div
        aria-hidden
        style={{
          width: 64,
          height: 64,
          borderRadius: 20,
          background: "linear-gradient(135deg, var(--terracotta-100), var(--cream-200))",
          display: "grid",
          placeItems: "center",
          color: "var(--terracotta-600)",
          marginBottom: 16,
        }}
      >
        {icon}
      </div>
      <div style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 500, color: "var(--ink-900)" }}>
        {title}
      </div>
      {hint ? (
        <div style={{ fontSize: 13, color: "var(--ink-500)", marginTop: 6, maxWidth: 340, lineHeight: 1.5 }}>{hint}</div>
      ) : null}
      {cta}
    </div>
  );
}
