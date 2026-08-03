"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { CSSProperties } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { useProviderBids, type ProviderBid } from "@/hooks/useProviderBids";

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

type FilterKey = "all" | "pending" | "active" | "won" | "lost";
type SortKey = "recent" | "amount_high" | "amount_low" | "oldest";

function IconPlus() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function IconSearch() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  );
}

function StatCard(props: { eyebrow: string; big: string; sub: string; tone: "terracotta" | "sage" | "gold" | "ink"; bar: string }) {
  const color =
    props.tone === "terracotta"
      ? "var(--terracotta-600)"
      : props.tone === "sage"
        ? "var(--sage-700)"
        : props.tone === "gold"
          ? "var(--gold-600)"
          : "var(--ink-900)";

  return (
    <div style={{ ...cardStyle, padding: "18px 18px 14px", position: "relative", overflow: "hidden" }}>
      <div style={eyebrowStyle}>{props.eyebrow}</div>
      <div style={{ ...numeralStyle, fontSize: 32, lineHeight: 1, marginTop: 8, color }}>{props.big}</div>
      <div style={{ marginTop: 6, fontSize: 12, color: "var(--ink-500)" }}>{props.sub}</div>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 4, background: props.bar }} />
    </div>
  );
}

function statusChip(status: "won" | "progress" | "lost" | "pending"): CSSProperties {
  if (status === "won") {
    return { display: "inline-flex", alignItems: "center", gap: 6, height: 24, padding: "0 10px", borderRadius: 999, fontSize: 12, fontWeight: 600, background: "var(--sage-50)", color: "var(--sage-700)" };
  }
  if (status === "progress") {
    return { display: "inline-flex", alignItems: "center", gap: 6, height: 24, padding: "0 10px", borderRadius: 999, fontSize: 12, fontWeight: 600, background: "var(--gold-50)", color: "var(--gold-600)" };
  }
  if (status === "pending") {
    return { display: "inline-flex", alignItems: "center", gap: 6, height: 24, padding: "0 10px", borderRadius: 999, fontSize: 12, fontWeight: 600, background: "var(--terracotta-50)", color: "var(--terracotta-600)" };
  }
  return { display: "inline-flex", alignItems: "center", height: 24, padding: "0 10px", borderRadius: 999, fontSize: 12, fontWeight: 600, background: "var(--cream-100)", color: "var(--ink-700)", border: "1px solid var(--border-warm)" };
}

function StatusBadge(props: { status: "won" | "progress" | "lost" | "pending"; label: string }) {
  return (
    <span style={statusChip(props.status)}>
      {props.status === "won" || props.status === "pending" ? <span style={{ width: 6, height: 6, borderRadius: 3, background: "currentColor" }} /> : null}
      {props.label}
    </span>
  );
}

function isBidVisible(bid: ProviderBid, filter: FilterKey) {
  if (filter === "all") return true;
  if (filter === "pending") return bid.status === "pending";
  if (filter === "active") return bid.status === "accepted" && bid.request_status !== "closed";
  if (filter === "won") return bid.status === "accepted";
  if (filter === "lost") return bid.status === "declined";
  return true;
}

export default function ProviderBidsPage() {
  const router = useRouter();
  const { bids: apiBids, loading } = useProviderBids();
  const [activeFilter, setActiveFilter] = useState<FilterKey>("all");
  const [sortBy, setSortBy] = useState<SortKey>("recent");
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);

  const {
    filteredBids,
    pendingCount,
    wonCount,
    activeCount,
    lostCount,
    pendingValue,
    wonValue,
    winRate,
    avgBidValue,
  } = useMemo(() => {
    const lowerSearch = search.trim().toLowerCase();
    const searched = lowerSearch
      ? apiBids.filter((bid) => `${bid.request_title} ${bid.request_neighborhood} ${bid.request_category}`.toLowerCase().includes(lowerSearch))
      : apiBids;

    const visible = searched.filter((bid) => isBidVisible(bid, activeFilter));
    const sorted = [...visible].sort((a, b) => {
      if (sortBy === "amount_high") return b.amount - a.amount;
      if (sortBy === "amount_low") return a.amount - b.amount;
      if (sortBy === "oldest") return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

    const pending = apiBids.filter((bid) => bid.status === "pending");
    const won = apiBids.filter((bid) => bid.status === "accepted");
    const active = apiBids.filter((bid) => bid.status === "accepted" && bid.request_status !== "closed");
    const lost = apiBids.filter((bid) => bid.status === "declined");
    const resolved = won.length + lost.length;

    return {
      filteredBids: sorted,
      pendingCount: pending.length,
      wonCount: won.length,
      activeCount: active.length,
      lostCount: lost.length,
      pendingValue: pending.reduce((sum, bid) => sum + bid.amount, 0),
      wonValue: won.reduce((sum, bid) => sum + bid.amount, 0),
      winRate: resolved > 0 ? Math.round((won.length / resolved) * 100) : 0,
      avgBidValue: apiBids.length > 0 ? Math.round(apiBids.reduce((sum, bid) => sum + bid.amount, 0) / apiBids.length) : 0,
    };
  }, [activeFilter, apiBids, search, sortBy]);

  const tabs = [
    { key: "all" as const, label: "All", count: apiBids.length },
    { key: "pending" as const, label: "Pending", count: pendingCount },
    { key: "active" as const, label: "Active", count: activeCount },
    { key: "won" as const, label: "Won", count: wonCount },
    { key: "lost" as const, label: "Lost", count: lostCount },
  ];

  const sortLabel =
    sortBy === "recent" ? "Sort: Recent ↓"
    : sortBy === "oldest" ? "Sort: Oldest ↓"
    : sortBy === "amount_high" ? "Sort: Highest bid ↓"
    : "Sort: Lowest bid ↓";

  return (
    <div style={{ background: "var(--bg-app)", minHeight: "100vh" }}>
      <div className="flex flex-col gap-4 px-4 pb-4 pt-6 md:flex-row md:items-end md:justify-between md:px-9 md:pb-5 md:pt-7">
        <div>
          <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 500, fontSize: "clamp(24px, 6vw, 30px)", letterSpacing: "-0.02em", margin: "0 0 4px", color: "var(--ink-900)" }}>
            My bids
          </h1>
          <p style={{ margin: 0, color: "var(--ink-500)", fontSize: 14 }}>
            {apiBids.length} bid{apiBids.length !== 1 ? "s" : ""} · ${Math.round(wonValue / 100).toLocaleString()} booked · {winRate}% win rate
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {searchOpen ? (
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search bids…"
              style={{ height: 38, width: 220, maxWidth: "100%", padding: "0 14px", borderRadius: 999, border: "1px solid var(--border-warm-strong)", background: "var(--bg-card)", fontSize: 14, color: "var(--ink-900)", outline: "none", fontFamily: "var(--font-body)" }}
            />
          ) : null}
          <button type="button" onClick={() => setSearchOpen((current) => !current)} style={ghostButtonStyle}>
            <IconSearch />
            {searchOpen ? "Hide search" : "Search"}
          </button>
          <button type="button" onClick={() => router.push("/app/provider/job-feed")} style={primaryButtonStyle}>
            <IconPlus />
            Quick bid
          </button>
        </div>
      </div>

      <div className="px-4 pb-8 md:px-9 md:pb-9">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-3.5" style={{ marginBottom: 22 }}>
          <StatCard eyebrow="Pending" big={String(pendingCount)} sub={pendingCount > 0 ? `$${Math.round(pendingValue / 100).toLocaleString()} awaiting decision` : "No homeowner decisions pending"} tone="terracotta" bar="var(--terracotta-500)" />
          <StatCard eyebrow="Won" big={String(wonCount)} sub={wonCount > 0 ? `$${Math.round(wonValue / 100).toLocaleString()} booked` : "No accepted bids yet"} tone="sage" bar="var(--sage-500)" />
          <StatCard eyebrow="Win rate" big={`${winRate}%`} sub="resolved bids" tone="gold" bar="var(--gold-500)" />
          <StatCard eyebrow="Avg bid value" big={`$${Math.round(avgBidValue / 100).toLocaleString()}`} sub="across all provider bids" tone="ink" bar="var(--ink-200)" />
        </div>

        <div className="flex flex-wrap items-center" style={{ gap: 6, marginBottom: 16, padding: "0 4px" }}>
          {tabs.map((tab) => {
            const isActive = activeFilter === tab.key;
            return (
              <button
                key={tab.label}
                type="button"
                onClick={() => setActiveFilter(tab.key)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  height: 30,
                  padding: "0 12px",
                  borderRadius: 999,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  background: isActive ? "var(--ink-900)" : "transparent",
                  color: isActive ? "white" : "var(--ink-700)",
                  border: isActive ? "1px solid var(--ink-900)" : "1px solid var(--border-warm-strong)",
                  fontFamily: "var(--font-body)",
                }}
              >
                {tab.label}
                <span
                  style={{
                    marginLeft: 4,
                    fontSize: 11,
                    padding: "1px 7px",
                    borderRadius: 9,
                    background: isActive ? "rgba(255,255,255,0.18)" : "var(--cream-200)",
                    color: isActive ? "white" : "var(--ink-500)",
                  }}
                >
                  {tab.count}
                </span>
              </button>
            );
          })}
          <div style={{ flex: 1 }} />
          <button
            type="button"
            onClick={() => setSortBy((current) => current === "recent" ? "amount_high" : current === "amount_high" ? "amount_low" : current === "amount_low" ? "oldest" : "recent")}
            style={smallGhostButtonStyle}
          >
            {sortLabel}
          </button>
        </div>

        {loading ? (
          <div style={{ textAlign: "center", padding: "60px 0", color: "var(--ink-400)", fontSize: 14 }}>Loading bids…</div>
        ) : filteredBids.length === 0 ? (
          apiBids.length === 0 ? (
            <EmptyState
              icon={
                <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="7" width="20" height="14" rx="2" />
                  <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
                  <path d="M12 12v4M10 14h4" />
                </svg>
              }
              title="No bids yet"
              hint="Browse nearby jobs and place your first bid — group deals win the most work."
              ctaLabel="Open job feed"
              ctaHref="/app/provider/job-feed"
            />
          ) : (
            <div style={{ textAlign: "center", padding: "60px 0", color: "var(--ink-400)", fontSize: 14 }}>
              No bids match the current filters.
            </div>
          )
        ) : null}

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {filteredBids.map((bid) => {
            const initials = bid.request_title.charAt(0).toUpperCase();
            const statusMap: Record<string, { status: "won" | "progress" | "lost" | "pending"; label: string }> = {
              accepted: { status: "won", label: bid.request_status === "closed" ? "Won" : "Active booking" },
              pending: { status: "pending", label: "Awaiting decision" },
              declined: { status: "lost", label: "Lost" },
            };
            const mapped = statusMap[bid.status] ?? { status: "pending" as const, label: bid.status };
            const amountDisplay = bid.amount > 0 ? `$${Math.round(bid.amount / 100).toLocaleString()}` : "—";
            const dateDisplay = new Date(bid.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
            return (
              <div key={bid.id} className="flex flex-wrap items-center gap-3.5 p-4 md:px-[22px]" style={cardStyle}>
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 11,
                    background: "linear-gradient(135deg,#7A9A7E,#4A6A4D)",
                    color: "white",
                    display: "grid",
                    placeItems: "center",
                    fontFamily: "var(--font-display)",
                    fontSize: 14,
                  }}
                >
                  {initials}
                </div>
                <div style={{ flex: 1, minWidth: 140 }}>
                  <div style={{ fontWeight: 600, fontSize: 15, color: "var(--ink-900)" }}>{bid.request_title}</div>
                  <div style={{ fontSize: 12, color: "var(--ink-500)", marginTop: 2 }}>{bid.request_neighborhood} · {bid.request_category}</div>
                </div>
                <StatusBadge status={mapped.status} label={mapped.label} />
                <div style={{ textAlign: "right" }}>
                  <div style={{ ...numeralStyle, fontSize: 17, color: bid.status === "declined" ? "var(--ink-400)" : "var(--ink-900)" }}>{amountDisplay}</div>
                  <div style={{ fontSize: 11, color: "var(--ink-500)", marginTop: 2 }}>{dateDisplay}</div>
                </div>
                <button type="button" onClick={() => router.push("/app/provider/job-feed")} style={smallGhostButtonStyle}>
                  Open →
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
