"use client";

import type { CSSProperties } from "react";
import { useProviderRatings } from "@/hooks/useProviderRatings";
import { initialsFromName } from "@/lib/display-name";

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

function IconStar(props: { filled?: boolean; width?: number; height?: number; color?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={props.width ?? 14} height={props.height ?? 14} fill={props.filled === false ? props.color ?? "var(--ink-200)" : props.color ?? "var(--gold-500)"} stroke="none">
      <path d="M12 2l3 6.5 7 .9-5.1 4.7 1.3 7-6.2-3.4-6.2 3.4 1.3-7L2 9.4l7-.9z" />
    </svg>
  );
}

export default function ProviderReviewsPage() {
  // One request, and it carries the summary as well as the page: the average
  // and the distribution are the database's, over every published review, not
  // an accumulation over whatever happened to load.
  const { reviews, summary, hasMore, loading, loadingMore, error, refresh, loadMore } =
    useProviderRatings();

  const totalCount = summary?.totalCount ?? 0;
  const averageRating = summary?.averageRating ?? null;
  const distribution =
    summary?.distribution ??
    [5, 4, 3, 2, 1].map((rating) => ({ rating, count: 0, percent: 0 }));

  return (
    <div style={{ background: "var(--bg-app)", minHeight: "100vh" }}>
      <div className="flex flex-col gap-4 px-4 pb-4 pt-6 md:flex-row md:items-end md:justify-between md:px-9 md:pb-5 md:pt-7">
        <div>
          <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 500, fontSize: "clamp(24px, 6vw, 30px)", letterSpacing: "-0.02em", margin: "0 0 4px", color: "var(--ink-900)" }}>
            Reviews
          </h1>
          <p style={{ margin: 0, color: "var(--ink-500)", fontSize: 14 }}>
            {loading
              ? "Loading reviews…"
              : `${totalCount} verified review${totalCount !== 1 ? "s" : ""} from Bundleen neighbours`}
          </p>
        </div>
      </div>

      {/* One actionable message for a genuine server failure, with a retry the
          reader controls. Nothing here retries by itself. */}
      {error ? (
        <div
          role="alert"
          className="mx-4 mb-4 md:mx-9"
          style={{ padding: "12px 16px", borderRadius: 12, background: "rgba(182,68,48,0.08)", color: "var(--danger-600)", fontSize: 13, border: "1px solid rgba(182,68,48,0.24)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}
        >
          <span>{error}</span>
          <button type="button" style={smallGhostButtonStyle} onClick={() => void refresh()}>
            Try again
          </button>
        </div>
      ) : null}

      <div className="px-4 pb-8 md:px-9 md:pb-9">
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.6fr_1fr] lg:gap-[22px]">
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <div style={{ ...cardPadStyle, background: "linear-gradient(160deg, white, var(--cream-100))" }}>
              <div style={eyebrowStyle}>Overall</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 6 }}>
                <div style={{ ...numeralStyle, fontSize: 56, color: "var(--gold-600)", lineHeight: 1 }}>
                  {loading ? "…" : (averageRating ?? "—")}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <div style={{ display: "flex", gap: 2 }}>
                    {[1, 2, 3, 4, 5].map((index) => (
                      <IconStar
                        key={index}
                        width={16}
                        height={16}
                        color={index <= Math.round(averageRating ?? 0) ? "var(--gold-500)" : "var(--ink-200)"}
                      />
                    ))}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--ink-500)" }}>
                    {loading ? "…" : `${totalCount} review${totalCount !== 1 ? "s" : ""}`}
                  </div>
                </div>
              </div>
              <div style={{ borderTop: "1px solid var(--border-warm)", marginTop: 18, paddingTop: 14, display: "flex", flexDirection: "column", gap: 6 }}>
                {distribution.map((item) => (
                  <div key={item.rating} style={{ display: "grid", gridTemplateColumns: "20px 1fr 36px", gap: 10, alignItems: "center", fontSize: 12 }}>
                    <span style={{ color: "var(--ink-500)" }}>{item.rating}★</span>
                    <div style={{ height: 6, background: "var(--cream-200)", borderRadius: 999 }}>
                      <div style={{ height: "100%", width: `${item.percent}%`, background: "var(--gold-500)", borderRadius: 999 }} />
                    </div>
                    <span style={{ color: "var(--ink-500)", textAlign: "right" }}>{item.count}</span>
                  </div>
                ))}
              </div>
            </div>

            <div style={cardPadStyle}>
              <div style={eyebrowStyle}>How reviews work</div>
              <p style={{ margin: "10px 0 0", fontSize: 13, color: "var(--ink-500)", lineHeight: 1.55 }}>
                Only a neighbour whose visit you completed, or the manager of an
                agreement you finished, can leave a review — one each. Nothing on
                this page can be edited or removed by you, which is what makes the
                rating worth showing to customers.
              </p>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {loading ? (
              <div style={{ ...cardPadStyle, textAlign: "center", color: "var(--ink-400)", fontSize: 13 }}>
                Loading reviews…
              </div>
            ) : reviews.length === 0 ? (
              <div style={{ ...cardPadStyle, textAlign: "center", color: "var(--ink-400)", fontSize: 13 }}>
                {error
                  ? "Your reviews could not be loaded."
                  : "No reviews yet — complete your first job to get your first review."}
              </div>
            ) : (
              <>
                {reviews.map((review) => (
                  <div key={review.id} style={cardPadStyle}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
                      <div style={{ width: 40, height: 40, borderRadius: "50%", background: "linear-gradient(135deg,#B07AA0,#7A4A6E)", color: "white", display: "grid", placeItems: "center", fontSize: 12, fontWeight: 600 }}>
                        {initialsFromName(review.reviewerName, "??")}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                            <div style={{ fontWeight: 600, fontSize: 14, color: "var(--ink-900)" }}>{review.reviewerName}</div>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 18, padding: "0 8px", borderRadius: 999, fontSize: 10, fontWeight: 600, background: "var(--sage-50)", color: "var(--sage-700)" }}>
                              <span style={{ width: 6, height: 6, borderRadius: 3, background: "currentColor" }} />
                              Verified customer
                            </span>
                          </div>
                          <div style={{ fontSize: 12, color: "var(--ink-500)" }}>
                            {new Date(review.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: 2, marginTop: 6, alignItems: "center", flexWrap: "wrap" }}>
                          {[1, 2, 3, 4, 5].map((index) => (
                            <IconStar key={index} filled={index <= review.rating} color={index <= review.rating ? "var(--gold-500)" : "var(--ink-200)"} />
                          ))}
                          {review.subjectLabel ? (
                            <span style={{ marginLeft: 8, fontSize: 11, color: "var(--ink-500)" }}>{review.subjectLabel}</span>
                          ) : null}
                        </div>
                        <p style={{ margin: "10px 0 0", fontSize: 14, color: "var(--ink-700)", lineHeight: 1.55 }}>{review.comment}</p>
                      </div>
                    </div>
                  </div>
                ))}

                {hasMore ? (
                  <button
                    type="button"
                    style={{ ...smallGhostButtonStyle, height: 38, justifyContent: "center" }}
                    disabled={loadingMore}
                    onClick={() => void loadMore()}
                  >
                    {loadingMore ? "Loading…" : "Show older reviews"}
                  </button>
                ) : null}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
