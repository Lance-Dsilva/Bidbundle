"use client";

import type { CSSProperties } from "react";
import { useProviderReviews } from "@/hooks/useProviderReviews";

const cardStyle: CSSProperties = {
  background: "var(--bg-card)",
  border: "1px solid var(--border-warm)",
  borderRadius: 18,
  boxShadow: "var(--shadow-warm-sm)",
};

const cardPadStyle: CSSProperties = {
  ...cardStyle,
  padding: 22,
};

const ghostButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  height: 38,
  padding: "0 16px",
  borderRadius: 999,
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
  background: "transparent",
  color: "var(--ink-700)",
  border: "1px solid var(--border-warm-strong)",
  fontFamily: "var(--font-body)",
};

const smallGhostButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  height: 30,
  padding: "0 12px",
  borderRadius: 999,
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  background: "transparent",
  color: "var(--ink-700)",
  border: "1px solid var(--border-warm-strong)",
  fontFamily: "var(--font-body)",
};

const smallQuietButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  height: 30,
  padding: "0 12px",
  borderRadius: 999,
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  background: "var(--cream-100)",
  color: "var(--ink-900)",
  border: 0,
  fontFamily: "var(--font-body)",
};

const eyebrowStyle: CSSProperties = {
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: "0.10em",
  color: "var(--ink-400)",
  fontWeight: 600,
};

const numeralStyle: CSSProperties = {
  fontFamily: "var(--font-display)",
  fontWeight: 500,
  letterSpacing: "-0.02em",
};

function IconEdit() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 21l3.5-1 11-11-2.5-2.5-11 11z" />
      <path d="M14 5l2.5 2.5" />
    </svg>
  );
}

function IconStar(props: { filled?: boolean; width?: number; height?: number; color?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={props.width ?? 14} height={props.height ?? 14} fill={props.filled === false ? props.color ?? "var(--ink-200)" : props.color ?? "var(--gold-500)"} stroke="none">
      <path d="M12 2l3 6.5 7 .9-5.1 4.7 1.3 7-6.2-3.4-6.2 3.4 1.3-7L2 9.4l7-.9z" />
    </svg>
  );
}

function avatarGradient(variant: "plum" | "blue" | "terracotta" | "gold") {
  const gradients = {
    plum: "linear-gradient(135deg,#B07AA0,#7A4A6E)",
    blue: "linear-gradient(135deg,#6F8DB8,#3F608E)",
    terracotta: "linear-gradient(135deg, var(--orange-500), var(--orange-600))",
    gold: "linear-gradient(135deg,#D6A23E,#B8862B)",
  };
  return gradients[variant];
}

export default function ProviderReviewsPage() {
  const { reviews: apiReviews, loading, avgRating, distribution: apiDist } = useProviderReviews();

  const distribution = loading || apiReviews.length === 0
    ? [
        { stars: 5, count: 0, percent: 0 },
        { stars: 4, count: 0, percent: 0 },
        { stars: 3, count: 0, percent: 0 },
        { stars: 2, count: 0, percent: 0 },
        { stars: 1, count: 0, percent: 0 },
      ]
    : apiDist.map((d) => ({ stars: d.star, count: d.count, percent: d.pct }));

  const mentions = [
    ["On time", 92],
    ["Clean work", 78],
    ["Communication", 64],
    ["Fair price", 58],
    ["Coordinated block", 41],
    ["Friendly", 33],
  ] as const;

  const reviews = [
    {
      initials: "SM",
      variant: "plum" as const,
      name: "Sarah M.",
      date: "Apr 20",
      stars: 5,
      tag: "Plumbing · group of 3",
      text: "I shared the group plumbing job for 2 homes on our block and they coordinated perfectly. Saved us both ~$120.",
    },
    {
      initials: "JK",
      variant: "blue" as const,
      name: "James K.",
      date: "Apr 12",
      stars: 4,
      tag: "Inspection · solo",
      text: "Showed up on time and left no mess. Would use through Bundleen again.",
    },
    {
      initials: "PA",
      variant: "terracotta" as const,
      name: "Priya A.",
      date: "Mar 30",
      stars: 5,
      tag: "Plumbing · group of 5",
      text: "Best quote in the group bid. Saved everyone money and did quality work — ProFix was patient with our scheduling.",
    },
    {
      initials: "LO",
      variant: "gold" as const,
      name: "Lulu O.",
      date: "Mar 22",
      stars: 5,
      tag: "Block service · 8 homes",
      text: "Coordinated the whole block. Saved everyone money. Highly recommend for HOA-wide jobs.",
    },
  ];

  return (
    <div style={{ background: "var(--bg-app)", minHeight: "100vh" }}>
      <div className="flex flex-col gap-4 px-4 pb-4 pt-6 md:flex-row md:items-end md:justify-between md:px-9 md:pb-5 md:pt-7">
        <div>
          <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 500, fontSize: "clamp(24px, 6vw, 30px)", letterSpacing: "-0.02em", margin: "0 0 4px", color: "var(--ink-900)" }}>
            Reviews
          </h1>
          <p style={{ margin: 0, color: "var(--ink-500)", fontSize: 14 }}>
            {loading ? "Loading reviews…" : `${apiReviews.length} verified review${apiReviews.length !== 1 ? "s" : ""} from Bundleen neighbors`}
          </p>
        </div>
        <button type="button" style={ghostButtonStyle}>
          <IconEdit />
          Reply settings
        </button>
      </div>

      <div className="px-4 pb-8 md:px-9 md:pb-9">
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.6fr_1fr] lg:gap-[22px]">
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <div style={{ ...cardPadStyle, background: "linear-gradient(160deg, white, var(--cream-100))" }}>
              <div style={eyebrowStyle}>Overall</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 6 }}>
                <div style={{ ...numeralStyle, fontSize: 56, color: "var(--gold-600)", lineHeight: 1 }}>
                  {loading ? "…" : (avgRating ?? "—")}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <div style={{ display: "flex", gap: 2 }}>
                    {[1, 2, 3, 4, 5].map((index) => (
                      <IconStar
                        key={index}
                        width={16}
                        height={16}
                        color={index <= Math.round(Number(avgRating ?? 0)) ? "var(--gold-500)" : "var(--ink-200)"}
                      />
                    ))}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--ink-500)" }}>
                    {loading ? "…" : `${apiReviews.length} reviews`}
                  </div>
                </div>
              </div>
              <div style={{ borderTop: "1px solid var(--border-warm)", marginTop: 18, paddingTop: 14, display: "flex", flexDirection: "column", gap: 6 }}>
                {distribution.map((item) => (
                  <div key={item.stars} style={{ display: "grid", gridTemplateColumns: "20px 1fr 36px", gap: 10, alignItems: "center", fontSize: 12 }}>
                    <span style={{ color: "var(--ink-500)" }}>{item.stars}★</span>
                    <div style={{ height: 6, background: "var(--cream-200)", borderRadius: 999 }}>
                      <div style={{ height: "100%", width: `${item.percent}%`, background: "var(--gold-500)", borderRadius: 999 }} />
                    </div>
                    <span style={{ color: "var(--ink-500)", textAlign: "right" }}>{item.count}</span>
                  </div>
                ))}
              </div>
            </div>

            {apiReviews.length > 0 ? (
              <div style={cardPadStyle}>
                <div style={eyebrowStyle}>What neighbors mention</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                  {mentions.map(([label, count]) => (
                    <span
                      key={label}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        height: 24,
                        padding: "0 10px",
                        borderRadius: 999,
                        fontSize: 12,
                        fontWeight: 600,
                        background: "var(--cream-100)",
                        color: "var(--ink-700)",
                      }}
                    >
                      {label}
                      <span style={{ color: "var(--ink-400)", marginLeft: 4 }}>{count}</span>
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 4px" }}>
              <span style={{ display: "inline-flex", alignItems: "center", height: 24, padding: "0 10px", borderRadius: 999, fontSize: 12, fontWeight: 600, background: "var(--ink-900)", color: "white" }}>
                All
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", height: 24, padding: "0 10px", borderRadius: 999, fontSize: 12, fontWeight: 600, background: "var(--cream-100)", color: "var(--ink-700)", border: "1px solid var(--border-warm)" }}>
                5★ only
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", height: 24, padding: "0 10px", borderRadius: 999, fontSize: 12, fontWeight: 600, background: "var(--cream-100)", color: "var(--ink-700)", border: "1px solid var(--border-warm)" }}>
                Needs reply <span style={{ color: "var(--terracotta-600)", marginLeft: 4 }}>0</span>
              </span>
              <div style={{ flex: 1 }} />
              <button type="button" style={smallGhostButtonStyle}>
                Sort: Recent
              </button>
            </div>

            {loading ? (
              <div style={{ ...cardPadStyle, textAlign: "center", color: "var(--ink-400)", fontSize: 13 }}>Loading reviews…</div>
            ) : apiReviews.length === 0 ? (
              <div style={{ ...cardPadStyle, textAlign: "center", color: "var(--ink-400)", fontSize: 13 }}>No reviews yet — complete your first job to get your first review.</div>
            ) : apiReviews.map((review) => {
              const initials = review.homeowner_name.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase();
              const date = new Date(review.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
              return (
              <div key={review.id} style={cardPadStyle}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
                  <div style={{ width: 40, height: 40, borderRadius: "50%", background: "linear-gradient(135deg,#B07AA0,#7A4A6E)", color: "white", display: "grid", placeItems: "center", fontSize: 12, fontWeight: 600 }}>
                    {initials}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                        <div style={{ fontWeight: 600, fontSize: 14, color: "var(--ink-900)" }}>{review.homeowner_name}</div>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 18, padding: "0 8px", borderRadius: 999, fontSize: 10, fontWeight: 600, background: "var(--sage-50)", color: "var(--sage-700)" }}>
                          <span style={{ width: 6, height: 6, borderRadius: 3, background: "currentColor" }} />
                          Verified neighbor
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: "var(--ink-500)" }}>{date}</div>
                    </div>
                    <div style={{ display: "flex", gap: 2, marginTop: 6, alignItems: "center", flexWrap: "wrap" }}>
                      {[1, 2, 3, 4, 5].map((index) => (
                        <IconStar key={index} filled={index <= review.stars} color={index <= review.stars ? "var(--gold-500)" : "var(--ink-200)"} />
                      ))}
                      {review.tag && <span style={{ marginLeft: 8, fontSize: 11, color: "var(--ink-500)" }}>{review.tag}</span>}
                    </div>
                    {review.comment && <p style={{ margin: "10px 0 0", fontSize: 14, color: "var(--ink-700)", lineHeight: 1.55 }}>{review.comment}</p>}
                    <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
                      <button type="button" style={smallQuietButtonStyle}>Reply publicly</button>
                      <button type="button" style={smallGhostButtonStyle}>Thank privately</button>
                    </div>
                  </div>
                </div>
              </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
