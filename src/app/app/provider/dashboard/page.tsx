"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import { CategoryTile } from "@/components/ui/CategoryArt";
import { useCountUp } from "@/hooks/useCountUp";
import { useProviderDashboard } from "@/hooks/useProviderDashboard";
import { useProviderBids } from "@/hooks/useProviderBids";
import { useProviderJobFeed } from "@/hooks/useProviderJobFeed";
import { useProviderMessages } from "@/hooks/useProviderMessages";
import { useProviderSchedule } from "@/hooks/useProviderSchedule";

const cardStyle: CSSProperties = {
  background: "var(--bg-card)",
  border: "1px solid var(--border-warm)",
  borderRadius: 18,
  boxShadow: "var(--shadow-warm-sm)",
};

const primaryButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  height: 38,
  padding: "0 16px",
  borderRadius: 999,
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
  background: "var(--terracotta-600)",
  color: "white",
  border: 0,
  fontFamily: "var(--font-body)",
  boxShadow: "0 1px 0 rgba(0,0,0,0.05) inset, 0 6px 14px -6px rgba(232,98,63,0.5)",
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

const smallPrimaryButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  height: 30,
  padding: "0 12px",
  borderRadius: 999,
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  background: "var(--terracotta-600)",
  color: "white",
  border: 0,
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

type Tone = "sage" | "terracotta" | "gold";

function toneChipStyle(tone: Tone): CSSProperties {
  if (tone === "sage") {
    return {
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      height: 24,
      padding: "0 10px",
      borderRadius: 999,
      fontSize: 12,
      fontWeight: 600,
      background: "var(--sage-50)",
      color: "var(--sage-700)",
    };
  }
  if (tone === "gold") {
    return {
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      height: 24,
      padding: "0 10px",
      borderRadius: 999,
      fontSize: 12,
      fontWeight: 600,
      background: "var(--gold-50)",
      color: "var(--gold-600)",
    };
  }
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    height: 24,
    padding: "0 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 600,
    background: "var(--terracotta-50)",
    color: "var(--terracotta-600)",
  };
}

function neutralChipStyle(): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    height: 24,
    padding: "0 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 600,
    background: "var(--cream-100)",
    color: "var(--ink-700)",
    border: "1px solid var(--border-warm)",
  };
}

function colorDotStyle(): CSSProperties {
  return { width: 6, height: 6, borderRadius: 3, background: "currentColor" };
}

function avatarGradient(variant: "sage" | "blue" | "plum" | "gold" | "terracotta") {
  const gradients = {
    sage: "linear-gradient(135deg,#7A9A7E,#4A6A4D)",
    blue: "linear-gradient(135deg,#6F8DB8,#3F608E)",
    plum: "linear-gradient(135deg,#B07AA0,#7A4A6E)",
    gold: "linear-gradient(135deg,#D6A23E,#B8862B)",
    terracotta: "linear-gradient(135deg, var(--orange-500), var(--orange-600))",
  };
  return gradients[variant];
}

function PIconInbox() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4h16v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4z" />
      <path d="M4 12h4l2 3h4l2-3h4" />
    </svg>
  );
}

function IconPlus() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function IconArrowR() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M13 5l7 7-7 7" />
    </svg>
  );
}

function IconStar(props: { color?: string; width?: number; height?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={props.width ?? 14} height={props.height ?? 14} fill={props.color ?? "currentColor"} stroke="none">
      <path d="M12 2l3 6.5 7 .9-5.1 4.7 1.3 7-6.2-3.4-6.2 3.4 1.3-7L2 9.4l7-.9z" />
    </svg>
  );
}

function IconLeaf() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 19c0-9 7-14 16-14-1 9-5 16-14 16a4 4 0 0 1-2-2z" />
      <path d="M5 19l8-8" />
    </svg>
  );
}

function IconBroom() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 4l6 6-7 7H6v-7z" />
      <path d="M6 14l-3 6 6-3" />
    </svg>
  );
}

function IconWrench() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 6a4 4 0 0 1 5 5l-9 9-4 1 1-4 9-9z" />
    </svg>
  );
}

function tradeVariant(category: string): "sage" | "blue" | "plum" | "gold" | "terracotta" {
  const value = category.toLowerCase();
  if (value.includes("lawn") || value.includes("landscap") || value.includes("garden")) return "sage";
  if (value.includes("clean") || value.includes("paint")) return "plum";
  if (value.includes("gutter") || value.includes("roof") || value.includes("pest")) return "gold";
  if (value.includes("plumb") || value.includes("elect") || value.includes("hvac")) return "blue";
  return "terracotta";
}

function tradeIcon(category: string) {
  const value = category.toLowerCase();
  if (value.includes("lawn") || value.includes("landscap") || value.includes("garden")) return IconLeaf;
  if (value.includes("clean")) return IconBroom;
  return IconWrench;
}

function formatDateMeta(date: string | null) {
  if (!date) return "Open now";
  return `Ends ${new Date(date).toLocaleDateString([], { month: "short", day: "numeric" })}`;
}

function formatClock(date: string) {
  return new Date(date).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatDistance(distance: number | null | undefined) {
  if (typeof distance !== "number" || !Number.isFinite(distance) || distance <= 0) return "";
  return `${distance} mi away`;
}

function MiniStat(props: { big: string; sub: string; accent?: boolean; noBorder?: boolean }) {
  return (
    <div style={{ paddingRight: 8, borderRight: props.noBorder ? 0 : "1px solid var(--border-warm)" }}>
      <div style={{ ...numeralStyle, fontSize: 18, color: props.accent ? "var(--terracotta-600)" : "var(--ink-900)" }}>{props.big}</div>
      <div style={{ fontSize: 11, color: "var(--ink-500)", marginTop: 2 }}>{props.sub}</div>
    </div>
  );
}

function SmallStatCard(props: { eyebrow: string; big: string; sub: string | JSX.Element; tone: "sage" | "gold" | "ink" }) {
  const color =
    props.tone === "sage" ? "var(--sage-700)" : props.tone === "gold" ? "var(--gold-600)" : "var(--ink-900)";
  const bg =
    props.tone === "sage"
      ? "linear-gradient(160deg, var(--sage-50), white)"
      : props.tone === "gold"
        ? "linear-gradient(160deg, var(--gold-50), white)"
        : "var(--bg-card)";

  return (
    <div style={{ ...cardStyle, padding: 20, background: bg }}>
      <div style={eyebrowStyle}>{props.eyebrow}</div>
      <div style={{ ...numeralStyle, fontSize: 30, marginTop: 6, color }}>{props.big}</div>
      <div style={{ fontSize: 12, color: "var(--ink-500)", marginTop: 2 }}>{props.sub}</div>
    </div>
  );
}

export default function ProviderDashboardPage() {
  const { dashboard, profile, loading } = useProviderDashboard();
  const animatedRevenue = useCountUp(Math.round((dashboard?.revenue_30d_cents ?? 0) / 100));
  const { jobs: liveJobs, loading: jobsLoading } = useProviderJobFeed();
  const { bids: providerBids, loading: bidsLoading } = useProviderBids();
  const { conversations, loading: messagesLoading } = useProviderMessages();
  const { items: scheduleItems, loading: scheduleLoading } = useProviderSchedule();
  const bidByRequestId = new Map(providerBids.map((bid) => [bid.request_id, bid]));
  const rankedJobs = [...liveJobs].sort((a, b) => {
    const distanceA = a.distance_mi ?? Number.POSITIVE_INFINITY;
    const distanceB = b.distance_mi ?? Number.POSITIVE_INFINITY;
    if (distanceA !== distanceB) return distanceA - distanceB;
    if (b.bid_count !== a.bid_count) return b.bid_count - a.bid_count;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
  const unbidJobs = rankedJobs.filter((job) => !bidByRequestId.has(job.id));
  const topJob = (unbidJobs[0] ?? rankedJobs[0]) ?? null;
  const topJobExistingBid = topJob ? bidByRequestId.get(topJob.id) : undefined;
  const visibleJobs = [...unbidJobs, ...rankedJobs.filter((job) => bidByRequestId.has(job.id))].slice(0, 5);
  const upcomingSchedule = [...scheduleItems]
    .filter((item) => new Date(item.scheduled_at).getTime() >= Date.now())
    .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime())
    .slice(0, 3);
  const recentConversations = [...conversations]
    .sort((a, b) => new Date(b.last_message_at ?? 0).getTime() - new Date(a.last_message_at ?? 0).getTime())
    .slice(0, 3);

  if (loading || bidsLoading || messagesLoading || scheduleLoading) {
    return (
      <div style={{ background: "var(--bg-app)", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ color: "var(--ink-400)", fontSize: 14 }}>Loading your dashboard…</div>
      </div>
    );
  }

  return (
    <div style={{ background: "var(--bg-app)", minHeight: "100vh" }}>
      <div className="flex flex-col gap-4 px-4 pb-4 pt-6 md:flex-row md:items-end md:justify-between md:px-9 md:pb-5 md:pt-7">
        <div>
          <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 500, fontSize: "clamp(24px, 6vw, 30px)", letterSpacing: "-0.02em", margin: "0 0 4px", color: "var(--ink-900)" }}>
            Good morning{profile?.company_name ? `, ${profile.company_name}` : ""}
          </h1>
          <p style={{ margin: 0, color: "var(--ink-500)", fontSize: 14 }}>
            {liveJobs.length} nearby group job{liveJobs.length !== 1 ? "s" : ""} in your feed · {dashboard?.unread_messages ?? 0} unread message{(dashboard?.unread_messages ?? 0) !== 1 ? "s" : ""}
          </p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <Link href="/app/provider/messages" style={{ ...ghostButtonStyle, textDecoration: "none" }}>
            <PIconInbox />
            Messages
            <span style={{ ...toneChipStyle("terracotta"), height: 18, padding: "0 8px", marginLeft: 4 }}>{dashboard?.unread_messages ?? 0}</span>
          </Link>
          <Link href="/app/provider/job-feed" style={{ ...primaryButtonStyle, textDecoration: "none" }}>
            <IconPlus />
            Browse jobs
          </Link>
        </div>
      </div>

      <div className="px-4 pb-8 md:px-9 md:pb-9">
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.6fr_1fr] lg:gap-[22px]">
          <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
            <div style={{ ...cardStyle, padding: 0, overflow: "hidden", position: "relative" }}>
              <div
                style={{
                  padding: "24px 28px",
                  background: "linear-gradient(135deg, var(--terracotta-50), white)",
                  borderBottom: "1px solid var(--border-warm)",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  gap: 16,
                }}
              >
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                    <span style={toneChipStyle("terracotta")}>
                      <span style={colorDotStyle()} />
                      {topJob ? `Top nearby · ${topJob.bid_count} bid${topJob.bid_count !== 1 ? "s" : ""}` : "Live locality feed"}
                    </span>
                    <span style={neutralChipStyle()}>{topJob?.category ?? "Job feed"}</span>
                    <span style={{ fontSize: 12, color: "var(--ink-500)" }}>{topJob ? formatDateMeta(topJob.closes_at) : "Waiting for the next request in your area"}</span>
                  </div>
                  <div style={{ fontFamily: "var(--font-display)", fontSize: 26, fontWeight: 500, letterSpacing: "-0.01em", color: "var(--ink-900)" }}>
                    {topJob?.title ?? "No active group jobs in your service area yet"}
                  </div>
                    <div style={{ fontSize: 13, color: "var(--ink-500)", marginTop: 4 }}>
                      {topJob
                        ? `${topJob.neighborhood}${formatDistance(topJob.distance_mi) ? ` · ${formatDistance(topJob.distance_mi)}` : ""} · ${topJob.bid_count} provider bid${topJob.bid_count !== 1 ? "s" : ""} · ${topJob.status === "bidding" ? "Bidding" : topJob.status === "live" ? "Live now" : "Grouping"}`
                        : `Complete your provider profile and Bundleen will keep pulling nearby requests into this dashboard.`}
                    </div>
                    {topJobExistingBid ? (
                      <div style={{ marginTop: 10, fontSize: 12, fontWeight: 600, color: "var(--sage-700)" }}>
                        Your bid is already in: ${Math.round(topJobExistingBid.amount / 100).toLocaleString()} · {topJobExistingBid.estimated_days} day{topJobExistingBid.estimated_days !== 1 ? "s" : ""}
                      </div>
                    ) : null}
                  </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ ...eyebrowStyle, letterSpacing: "0.08em" }}>Bid range</div>
                  <div style={{ ...numeralStyle, fontSize: 30, color: "var(--terracotta-600)", lineHeight: 1, marginTop: 4 }}>
                    {topJob
                      ? `$${Math.round(topJob.budget_min / 100).toLocaleString()}–${Math.round(topJob.budget_max / 100).toLocaleString()}`
                      : "—"}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--sage-700)", fontWeight: 600, marginTop: 4 }}>
                    {topJob
                      ? `Est. $${Math.round(((topJob.budget_min + topJob.budget_max) / 2) / 100).toLocaleString()} revenue`
                      : "Local requests appear here automatically"}
                  </div>
                </div>
              </div>
              <div style={{ padding: "16px 28px 22px", display: "flex", alignItems: "center", gap: 14, justifyContent: "space-between", flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ fontSize: 13, color: "var(--ink-700)" }}>
                    {topJob
                      ? topJobExistingBid
                        ? `You already bid on this request. ${topJob.bid_count} total provider bid${topJob.bid_count !== 1 ? "s" : ""} are now in for ${topJob.neighborhood}${formatDistance(topJob.distance_mi) ? `, ${formatDistance(topJob.distance_mi)} from your base.` : "."}`
                        : `${topJob.bid_count} competing provider bid${topJob.bid_count !== 1 ? "s" : ""} already placed in ${topJob.neighborhood}${formatDistance(topJob.distance_mi) ? `, ${formatDistance(topJob.distance_mi)} from your base.` : "."}`
                      : "As soon as a nearby homeowner group goes live, it will appear here."}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <Link href="/app/provider/job-feed" style={{ ...ghostButtonStyle, textDecoration: "none" }}>
                    View details
                  </Link>
                  <Link href="/app/provider/job-feed" style={{ ...primaryButtonStyle, textDecoration: "none" }}>
                    {topJob ? topJobExistingBid ? "View your bid" : "Submit bid" : "Open job feed"}
                    <IconArrowR />
                  </Link>
                </div>
              </div>
            </div>

            <div>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12, padding: "0 4px", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                  <div style={eyebrowStyle}>Smart job feed</div>
                  <span style={{ fontSize: 12, color: "var(--ink-500)" }}>Closest first</span>
                </div>
                <Link href="/app/provider/job-feed" style={{ background: "transparent", border: 0, color: "var(--terracotta-600)", fontSize: 13, fontWeight: 600, padding: 0, cursor: "pointer", textDecoration: "none" }}>
                  See all {liveJobs.length} →
                </Link>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {jobsLoading ? (
                  <div style={{ ...cardStyle, padding: "18px 22px", fontSize: 13, color: "var(--ink-500)" }}>
                    Loading nearby jobs…
                  </div>
                ) : visibleJobs.length === 0 ? (
                  <div style={{ ...cardStyle, padding: "18px 22px", fontSize: 13, color: "var(--ink-500)" }}>
                    No live group requests are in your selected service area yet.
                  </div>
                ) : visibleJobs.map((job, index) => {
                  const isBidding = job.status === "bidding" || job.status === "live";

                  return (
                    <div
                      key={job.id}
                      className="flex flex-wrap items-center gap-3.5 p-4 md:px-[22px]"
                      style={{
                        ...cardStyle,
                        background: index % 2 === 0 ? "var(--cream-50)" : "var(--bg-card)",
                      }}
                    >
                      <CategoryTile category={job.category} size={40} />
                      <div style={{ flex: 1, minWidth: 160 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <div style={{ fontWeight: 600, fontSize: 15, color: "var(--ink-900)" }}>{job.title}</div>
                          {isBidding ? (
                            <span style={toneChipStyle("sage")}>
                              <span style={colorDotStyle()} />
                              {job.status === "bidding" ? "Bidding" : "Live"}
                            </span>
                          ) : (
                            <span style={toneChipStyle("gold")}>Grouping</span>
                          )}
                          {bidByRequestId.has(job.id) ? (
                            <span style={toneChipStyle("terracotta")}>Your bid placed</span>
                          ) : null}
                        </div>
                        <div style={{ fontSize: 12, color: "var(--ink-500)", marginTop: 2 }}>
                          {job.neighborhood}{formatDistance(job.distance_mi) ? ` · ${formatDistance(job.distance_mi)}` : ""} · {job.bid_count} provider bid{job.bid_count !== 1 ? "s" : ""} · {formatDateMeta(job.closes_at)}
                        </div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ ...numeralStyle, fontSize: 18, color: "var(--ink-900)" }}>
                          ${Math.round(job.budget_min / 100).toLocaleString()}–${Math.round(job.budget_max / 100).toLocaleString()}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--ink-500)", marginTop: 2 }}>
                          {index === 0 ? "Best current fit" : `${job.category} request`}
                        </div>
                      </div>
                      <Link href="/app/provider/job-feed" style={{ ...(isBidding ? smallPrimaryButtonStyle : smallGhostButtonStyle), textDecoration: "none" }}>
                        {bidByRequestId.has(job.id) ? "View bid" : isBidding ? "Bid now" : "View"}
                      </Link>
                    </div>
                  );
                })}
              </div>
            </div>

            <div style={{ ...cardStyle, background: "var(--cream-50)" }}>
              <div style={{ padding: "18px 22px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={eyebrowStyle}>Upcoming schedule</div>
                <Link href="/app/provider/schedule" style={{ background: "transparent", border: 0, color: "var(--terracotta-600)", fontSize: 13, fontWeight: 600, padding: 0, cursor: "pointer", textDecoration: "none" }}>
                  Full schedule →
                </Link>
              </div>
              <div style={{ borderTop: "1px solid var(--border-warm)" }}>
                {upcomingSchedule.length === 0 ? (
                  <div style={{ padding: "18px 22px", fontSize: 13, color: "var(--ink-500)" }}>
                    No scheduled jobs yet. Accepted bookings will appear here.
                  </div>
                ) : upcomingSchedule.map((row, index) => (
                  <div
                    key={row.id}
                    className="flex flex-wrap items-center gap-3 px-4 py-3.5 md:px-[22px]"
                    style={{
                      borderTop: index === 0 ? 0 : "1px solid var(--border-warm)",
                    }}
                  >
                    <div>
                      <div style={{ ...numeralStyle, fontSize: 16, color: "var(--ink-900)" }}>{formatClock(row.scheduled_at)}</div>
                      <div style={{ fontSize: 11, color: "var(--ink-500)" }}>{Math.round((row.duration_minutes / 60) * 10) / 10}h</div>
                    </div>
                    <div style={{ width: 4, height: 36, borderRadius: 2, background: row.status === "completed" ? "var(--sage-500)" : row.status === "scheduled" ? "var(--terracotta-500)" : "var(--gold-500)" }} />
                    <div style={{ flex: 1, minWidth: 140 }}>
                      <div style={{ fontWeight: 600, fontSize: 14, color: "var(--ink-900)" }}>{row.title}</div>
                      <div style={{ fontSize: 12, color: "var(--ink-500)" }}>{row.address ?? "Address to be confirmed"}</div>
                    </div>
                    <span style={toneChipStyle(row.status === "completed" ? "sage" : row.status === "scheduled" ? "terracotta" : "gold")}>{row.status}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <div style={{ ...cardStyle, padding: 22, background: "linear-gradient(160deg, var(--cream-100), var(--cream-200))" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
                <div style={eyebrowStyle}>Revenue · last 30 days</div>
                <span style={toneChipStyle("sage")}>+18% vs last mo</span>
              </div>
              <div style={{ ...numeralStyle, fontSize: 38, marginTop: 8, color: "var(--terracotta-600)" }}>
                ${animatedRevenue.toLocaleString()}
              </div>
              <div style={{ fontSize: 12, color: "var(--ink-500)" }}>
                {dashboard?.jobs_completed ?? 0} jobs completed this period
              </div>
              <div style={{ marginTop: 18, height: 110, position: "relative" }}>
                {(dashboard?.revenue_30d_cents ?? 0) > 0 ? (
                  <svg viewBox="0 0 300 110" width="100%" height="110" preserveAspectRatio="none">
                    <defs>
                      <linearGradient id="ph-grad" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" style={{ stopColor: "var(--orange-500)" }} stopOpacity="0.32" />
                        <stop offset="100%" style={{ stopColor: "var(--orange-500)" }} stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    <path d="M0 80 L25 70 L50 75 L75 55 L100 60 L125 45 L150 50 L175 35 L200 38 L225 25 L250 30 L275 18 L300 22 L300 110 L0 110 Z" fill="url(#ph-grad)" />
                    <path d="M0 80 L25 70 L50 75 L75 55 L100 60 L125 45 L150 50 L175 35 L200 38 L225 25 L250 30 L275 18 L300 22" fill="none" style={{ stroke: "var(--orange-600)" }} strokeWidth="2" strokeLinejoin="round" />
                    <circle cx="300" cy="22" r="4" style={{ fill: "var(--orange-600)" }} />
                    <circle cx="300" cy="22" r="8" style={{ fill: "var(--orange-600)" }} fillOpacity="0.18" />
                  </svg>
                ) : (
                  <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: "100%", paddingTop: 12 }}>
                    {[18, 0, 30, 46, 22, 36].map((h, i) => (
                      <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                        <div style={{ width: "100%", height: Math.max(h, 4), background: h > 0 ? "var(--cream-300)" : "var(--cream-200)", borderRadius: 4 }} />
                        <div style={{ fontSize: 10, color: "var(--ink-300)" }}>{["J","F","M","A","M","J"][i]}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div style={{ borderTop: "1px solid var(--border-warm)", paddingTop: 12, marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                <MiniStat big={`$${Math.round((dashboard?.revenue_total_cents ?? 0) / 100).toLocaleString()}`} sub="Total earned" />
                <MiniStat big={dashboard?.win_rate_pct ? `${dashboard.win_rate_pct}%` : "—"} sub="Win rate" accent />
                <MiniStat big={`${dashboard?.active_bids ?? 0}`} sub="Active bids" noBorder />
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <SmallStatCard eyebrow="Jobs completed" big={String(dashboard?.jobs_completed ?? 0)} sub="all time" tone="sage" />
              <SmallStatCard
                eyebrow="Avg. rating"
                big={dashboard?.avg_rating ? String(dashboard.avg_rating) : "—"}
                sub={
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <IconStar color="var(--gold-500)" />
                    {dashboard?.reviews_count ?? 0} reviews
                  </span>
                }
                tone="gold"
              />
            </div>

            <div style={{ ...cardStyle, background: "linear-gradient(180deg, white, var(--terracotta-50))", borderColor: "var(--terracotta-100)" }}>
              <div style={{ padding: "16px 22px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={eyebrowStyle}>Recent messages</div>
                <span style={toneChipStyle("terracotta")}>{dashboard?.unread_messages ?? 0} unread</span>
              </div>
              <div style={{ borderTop: "1px solid var(--border-warm)" }}>
                {recentConversations.length === 0 ? (
                  <div style={{ padding: "18px 22px", fontSize: 13, color: "var(--ink-500)" }}>
                    Homeowner replies land here after your first bid.
                  </div>
                ) : recentConversations.map((message, index) => (
                  <div
                    key={message.id}
                    style={{
                      padding: "12px 22px",
                      display: "grid",
                      gridTemplateColumns: "auto 1fr auto",
                      gap: 12,
                      alignItems: "center",
                      borderTop: index === 0 ? 0 : "1px solid var(--border-warm)",
                    }}
                  >
                    <div
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: "50%",
                        background: avatarGradient(index % 3 === 0 ? "plum" : index % 3 === 1 ? "blue" : "sage"),
                        color: "white",
                        display: "grid",
                        placeItems: "center",
                        fontSize: 11,
                        fontWeight: 600,
                      }}
                    >
                      {message.other_user_name.split(" ").map((part) => part[0]).slice(0, 2).join("").toUpperCase()}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, color: "var(--ink-900)" }}>{message.other_user_name}</div>
                      <div style={{ fontSize: 12, color: "var(--ink-500)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{message.last_message ?? "No messages yet"}</div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                      <div style={{ fontSize: 11, color: "var(--ink-400)" }}>{message.last_message_at ? formatClock(message.last_message_at) : "—"}</div>
                      {message.unread_count > 0 ? <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--terracotta-500)" }} /> : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
