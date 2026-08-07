"use client";

import { useEffect } from "react";
import Link from "next/link";

import { CategoryTile } from "@/components/ui/CategoryArt";
import { Icon } from "@/components/ui/Icon";
import { PageSkeleton } from "@/components/ui/Skeleton";
import { useCountUp } from "@/hooks/useCountUp";
import { useHomeownerDashboard } from "@/hooks/useHomeownerDashboard";
import { useHomeownerRequests } from "@/hooks/useHomeownerRequests";
import { useNeighbourhoodRequests } from "@/hooks/useNeighbourhoodRequests";
import { useNeighbourhoodSummary } from "@/hooks/useNeighbourhoodSummary";
import { useNotifications } from "@/hooks/useNotifications";

const POPULAR_SERVICES: { label: string; icon: "cleaning" | "plumbing" | "electrical" | "painting" }[] = [
  { label: "Cleaning", icon: "cleaning" },
  { label: "Plumbing", icon: "plumbing" },
  { label: "Electrical", icon: "electrical" },
  { label: "Painting", icon: "painting" },
];

export default function HomeownerDashboard() {
  const { dashboard, user, loading } = useHomeownerDashboard();
  const { requests, refresh: refreshRequests } = useHomeownerRequests();
  const { requests: nbRequests, loading: nbRequestsLoading } = useNeighbourhoodRequests();
  const { notifications, markRead, dismiss } = useNotifications();
  const { otherMembers, neighbourhoodName, neighborCount } = useNeighbourhoodSummary();
  const animatedSavings = useCountUp(Math.round((dashboard?.total_saved_cents ?? 0) / 100));

  useEffect(() => {
    const onFocus = () => refreshRequests();
    const onVisibility = () => { if (!document.hidden) refreshRequests(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refreshRequests]);

  const firstName = user?.full_name?.split(" ")[0] ?? "there";
  const openRequests = requests.filter((r) => ["draft", "live", "grouping"].includes(r.status));
  const neighbourhoodOpportunities = nbRequests.filter((request) => !request.is_mine);
  const liveRequest = openRequests.find((r) => r.status === "live") ?? openRequests[0] ?? null;
  const ownRecommendedRequest = openRequests
    .filter((request) => request.bid_count > 0)
    .sort((a, b) => {
      const bestBidA = a.best_bid_cents ?? Number.POSITIVE_INFINITY;
      const bestBidB = b.best_bid_cents ?? Number.POSITIVE_INFINITY;
      if (bestBidA !== bestBidB) return bestBidA - bestBidB;
      return b.bid_count - a.bid_count;
    })[0] ?? null;
  const neighbourhoodRecommendedRequest = nbRequests
    .filter((request) => !request.is_mine && request.bid_count > 0)
    .sort((a, b) => b.bid_count - a.bid_count)[0] ?? null;
  const recommendationTarget = ownRecommendedRequest ?? neighbourhoodRecommendedRequest;
  const hasRecommendation = recommendationTarget !== null;
  const recommendationSavings =
    ownRecommendedRequest && ownRecommendedRequest.best_bid_cents !== null
      ? Math.max(0, ownRecommendedRequest.budget_min - ownRecommendedRequest.best_bid_cents)
      : 0;
  const neighbourhoodPulse = [
    ...otherMembers.slice(0, 2).map((member) => ({
      key: `member-${member.user_id}`,
      who: member.full_name,
      initials: member.full_name.split(" ").map((part) => part[0]).slice(0, 2).join("").toUpperCase(),
      what: "joined your neighbourhood",
      highlight: neighbourhoodName,
      when: new Date(member.joined_at).toLocaleDateString([], { month: "short", day: "numeric" }),
    })),
    ...nbRequests.filter((request) => !request.is_mine).slice(0, 2).map((request) => ({
      key: `request-${request.id}`,
      who: request.owner_name,
      initials: request.owner_name.split(" ").map((part) => part[0]).slice(0, 2).join("").toUpperCase(),
      what: "posted a new",
      highlight: `${request.category} request`,
      when: "New",
    })),
  ].slice(0, 3);

  function statusChip(status: string): { bg: string; color: string } {
    switch (status.toLowerCase()) {
      case "live":     return { bg: "var(--terracotta-50)",  color: "var(--terracotta-600)" };
      case "bidding":  return { bg: "var(--terracotta-50)",  color: "var(--terracotta-600)" };
      case "grouping": return { bg: "var(--sage-50)",        color: "var(--sage-700)"       };
      case "pending_approval": return { bg: "var(--gold-50)", color: "var(--gold-600)"      };
      case "draft":    return { bg: "var(--cream-200)",      color: "var(--ink-700)"        };
      default:         return { bg: "var(--cream-200)",      color: "var(--ink-400)"        };
    }
  }

  if (loading) {
    return <PageSkeleton />;
  }

  return (
    <div className="bb-page">
      {notifications.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 18 }}>
          {notifications.slice(0, 3).map((n) => (
            <div
              key={n.id}
              className="flex flex-wrap items-center"
              style={{ gap: 12, background: "var(--sage-50)", border: "1px solid var(--border-warm)", borderRadius: 14, padding: "14px 18px" }}
            >
              <div style={{ width: 36, height: 36, borderRadius: "50%", background: "var(--sage-100)", display: "grid", placeItems: "center", flexShrink: 0, color: "var(--teal-800)" }}>
                <Icon name="bell" size={16} />
              </div>
              <div style={{ flex: 1, minWidth: 180 }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: "var(--ink-900)" }}>{n.title}</div>
                <div style={{ fontSize: 13, color: "var(--ink-600)", marginTop: 2 }}>{n.body}</div>
              </div>
              {n.action_url && (
                <Link href={n.action_url} onClick={() => void markRead(n.id)} className="bb-btn bb-btn-primary" style={{ height: 30, padding: "0 12px", fontSize: 13 }}>
                  Join group →
                </Link>
              )}
              <button onClick={() => void dismiss(n.id)} style={{ background: "transparent", border: 0, cursor: "pointer", fontSize: 18, color: "var(--ink-400)", lineHeight: 1, padding: 4 }} aria-label="Dismiss">
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Hero */}
      <article className="bb-card bb-card-pad" style={{ background: "linear-gradient(145deg, #fff 0%, #fffaf3 62%, var(--teal-50) 100%)", overflow: "hidden" }}>
        <span className="bb-eyebrow">
          {new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}
        </span>
        <h1 style={{ fontSize: 30, lineHeight: 1.1, margin: "6px 0 0", letterSpacing: "-.03em", color: "var(--ink-900)" }}>
          Good morning, {firstName}
        </h1>
        <p style={{ color: "var(--muted)", lineHeight: 1.55, margin: "8px 0 0" }}>
          {liveRequest
            ? `${liveRequest.title} · ${liveRequest.bid_count} bid${liveRequest.bid_count !== 1 ? "s" : ""} in · ${liveRequest.neighborhood}`
            : "Bundle your home-service request with nearby neighbors and unlock better group pricing."}
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, margin: "20px 0" }}>
          <div style={{ padding: 15, borderRadius: 18, display: "flex", alignItems: "center", gap: 10, background: "var(--teal-50)" }}>
            <Icon name="tag" size={20} style={{ color: "var(--teal-800)" }} />
            <div>
              <strong style={{ display: "block", fontSize: 20, color: "var(--ink-900)" }}>{dashboard?.active_bids ?? 0}</strong>
              <span style={{ color: "var(--muted)", fontSize: 13 }}>bids awaiting your call</span>
            </div>
          </div>
          <div style={{ padding: 15, borderRadius: 18, display: "flex", alignItems: "center", gap: 10, background: "#fff4df" }}>
            <Icon name="clipboard" size={20} style={{ color: "#d59018" }} />
            <div>
              <strong style={{ display: "block", fontSize: 20, color: "var(--ink-900)" }}>{dashboard?.active_requests ?? 0}</strong>
              <span style={{ color: "var(--muted)", fontSize: 13 }}>active requests</span>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link href={liveRequest ? "/app/homeowner/bids" : "/app/homeowner/request"} className="bb-btn bb-btn-primary">
            <Icon name="plus" size={18} /> {liveRequest ? "Review bids" : "New request"}
          </Link>
          <Link href="/app/homeowner/chat" className="bb-btn bb-btn-secondary">
            <Icon name="sparkle" size={18} /> Ask AI
          </Link>
        </div>

        <img
          src="/creative/illustrations/house-hero.svg"
          alt="Neighborhood homes and home-service tools"
          style={{ width: "100%", maxWidth: 320, margin: "18px auto -18px", display: "block" }}
        />
      </article>

      {/* Active requests */}
      <article className="bb-card">
        <div className="bb-card-header" style={{ padding: "20px 22px 14px" }}>
          <div>
            <h2 className="bb-card-title">Active requests</h2>
            <p className="bb-card-copy">
              {openRequests.length > 0
                ? `${openRequests.length} open · group bidding to lower prices`
                : nbRequestsLoading
                  ? "Checking nearby neighbourhood groups…"
                  : neighbourhoodOpportunities.length > 0
                    ? `${neighbourhoodOpportunities.length} active in your neighbourhood — join a group`
                    : "Track your requests and incoming group bids."}
            </p>
          </div>
          <Link href="/app/homeowner/bids" className="bb-link">
            View all <Icon name="arrow-right" size={16} />
          </Link>
        </div>

        {openRequests.length === 0 && neighbourhoodOpportunities.length > 0 ? (
          <div>
            {neighbourhoodOpportunities.slice(0, 5).map((r) => {
              const chip = statusChip(r.group_status ?? r.status);
              const activityLabel =
                r.group_status === "bidding" ? "Bids live" : r.group_status === "pending_approval" ? "Pending approval" : "Join group";
              return (
                <div key={r.id} className="flex items-center" style={{ gap: 14, padding: "14px 22px", borderTop: "1px solid var(--line)" }}>
                  <CategoryTile category={r.category} size={38} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, color: "var(--ink-900)" }}>{r.title}</div>
                    <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                      {r.neighborhood} · by {r.owner_name} · {r.bid_count} bid{r.bid_count !== 1 ? "s" : ""}
                    </div>
                  </div>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 24, padding: "0 10px", borderRadius: 999, fontSize: 12, fontWeight: 600, background: chip.bg, color: chip.color, flexShrink: 0 }}>
                    {activityLabel}
                  </span>
                </div>
              );
            })}
          </div>
        ) : openRequests.length === 0 ? (
          <div className="bb-empty-state">
            <img src="/creative/illustrations/post-request.svg" alt="Empty request clipboard" />
            <h3>No active requests yet</h3>
            <p>Post your first request and invite neighbors to unlock better group pricing.</p>
            <Link href="/app/homeowner/request" className="bb-btn bb-btn-primary bb-btn-block">
              <Icon name="plus" size={18} /> Add a new service request
            </Link>
          </div>
        ) : (
          <div>
            {openRequests.slice(0, 5).map((r) => {
              const chip = statusChip(r.status);
              return (
                <div key={r.id} className="flex items-center" style={{ gap: 14, padding: "14px 22px", borderTop: "1px solid var(--line)" }}>
                  <CategoryTile category={r.category} size={38} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, color: "var(--ink-900)" }}>{r.title}</div>
                    <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                      {r.neighborhood} · {r.bid_count} {r.bid_count === 1 ? "bid" : "bids"}
                    </div>
                  </div>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 24, padding: "0 10px", borderRadius: 999, fontSize: 12, fontWeight: 600, background: chip.bg, color: chip.color, flexShrink: 0 }}>
                    {r.status.charAt(0).toUpperCase() + r.status.slice(1)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </article>

      {/* Neighborhood pulse */}
      {neighbourhoodPulse.length > 0 ? (
        <article className="bb-card bb-card-pad">
          <div className="bb-card-header">
            <div>
              <h2 className="bb-card-title">Neighborhood pulse</h2>
              <p className="bb-card-copy">See what&rsquo;s happening around you.</p>
            </div>
            <span className="bb-live-pill">Live updates</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {neighbourhoodPulse.map((a) => (
              <div key={a.key} style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <div style={{ width: 32, height: 32, borderRadius: "50%", background: "linear-gradient(135deg, var(--teal-800), var(--teal-600))", display: "grid", placeItems: "center", color: "white", fontSize: 11, fontWeight: 600, flexShrink: 0 }}>
                  {a.initials}
                </div>
                <div style={{ flex: 1, fontSize: 13, color: "var(--ink-700)" }}>
                  <strong style={{ color: "var(--ink-900)" }}>{a.who}</strong> {a.what}{" "}
                  <span style={{ color: "var(--orange-600)", fontWeight: 600 }}>{a.highlight}</span>
                </div>
                <div style={{ fontSize: 11, color: "var(--ink-400)" }}>{a.when}</div>
              </div>
            ))}
          </div>
        </article>
      ) : (
        <article
          className="bb-card bb-card-pad"
          style={{ background: "linear-gradient(135deg, var(--navy-900), var(--teal-600))", border: 0, color: "#FAF6F0", overflow: "hidden" }}
        >
          <span
            className="bb-live-pill"
            style={{ background: "rgba(255,255,255,0.12)", color: "#FAF6F0" }}
          >
            <Icon name="map-pin" size={14} /> Your neighborhood
          </span>
          <h2 style={{ fontSize: 22, margin: "12px 0 4px", letterSpacing: "-.02em", color: "#FAF6F0" }}>
            No active groups yet
          </h2>
          <p style={{ color: "rgba(250,246,240,0.65)", fontSize: 14, lineHeight: 1.5, margin: 0 }}>
            Post a request to start receiving bids
          </p>
          <img
            src="/creative/illustrations/join-bundle.svg"
            alt="Toolbox with home-service tools"
            style={{ width: "100%", maxWidth: 220, margin: "14px auto 0", display: "block" }}
          />

          <div
            style={{
              marginTop: 18, padding: 14, borderRadius: 14,
              border: "1.5px dashed rgba(255,255,255,0.22)",
              display: "flex", alignItems: "center", gap: 12,
            }}
          >
            <div style={{ width: 40, height: 40, borderRadius: "50%", background: "rgba(255,255,255,0.1)", display: "grid", placeItems: "center", flexShrink: 0 }}>
              <Icon name="users" size={18} />
            </div>
            <span style={{ fontSize: 13, color: "rgba(250,246,240,0.8)", lineHeight: 1.4 }}>
              Post a request and neighbors can join your group
            </span>
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
            <Link href="/app/homeowner/request" className="bb-btn bb-btn-orange">
              Post a request <Icon name="arrow-right" size={18} />
            </Link>
            <Link
              href="/app/homeowner/chat"
              className="bb-btn"
              style={{ background: "rgba(255,255,255,0.1)", color: "#FAF6F0", border: "1px solid rgba(255,255,255,0.16)" }}
            >
              <Icon name="sparkle" size={18} /> Ask AI
            </Link>
          </div>
        </article>
      )}

      {/* Savings */}
      <article className="bb-card bb-card-pad" style={{ background: "linear-gradient(135deg, #fffaf2, #fffdf9)", borderColor: "#efd8ac" }}>
        <div className="bb-card-header">
          <div>
            <span className="bb-eyebrow">Your savings this year</span>
            <div style={{ fontSize: 48, lineHeight: 1, letterSpacing: "-.04em", margin: "10px 0 6px", color: "var(--ink-900)" }}>
              ${animatedSavings.toLocaleString()}
            </div>
            <p className="bb-card-copy">
              {(dashboard?.total_saved_cents ?? 0) > 0 ? "From accepted group bids · vs. solo booking" : "Accept a group bid and your savings show up here."}
            </p>
          </div>
          <Icon name="info" size={18} style={{ color: "var(--muted)" }} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", borderTop: "1px solid #ecdcc5", marginTop: 18, paddingTop: 18 }}>
          <div style={{ display: "grid", gridTemplateColumns: "42px 1fr", gap: 10, alignItems: "center", padding: "0 10px" }}>
            <div style={{ width: 42, height: 42, borderRadius: "50%", display: "grid", placeItems: "center", background: "var(--teal-50)", color: "var(--teal-800)" }}>
              <Icon name="users" size={18} />
            </div>
            <div>
              <strong style={{ fontSize: 22, display: "block", color: "var(--ink-900)" }}>{neighborCount}</strong>
              <small style={{ color: "var(--muted)" }}>Neighbors<br />in your area</small>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "42px 1fr", gap: 10, alignItems: "center", padding: "0 10px", borderLeft: "1px solid #ecdcc5" }}>
            <div style={{ width: 42, height: 42, borderRadius: "50%", display: "grid", placeItems: "center", background: "#fff1d4", color: "#d08d12" }}>
              <Icon name="tag" size={18} />
            </div>
            <div>
              <strong style={{ fontSize: 22, display: "block", color: "var(--ink-900)" }}>{dashboard?.active_bids ?? 0}</strong>
              <small style={{ color: "var(--muted)" }}>Active bids<br />right now</small>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "42px 1fr", gap: 10, alignItems: "center", padding: "0 10px", borderLeft: "1px solid #ecdcc5" }}>
            <div style={{ width: 42, height: 42, borderRadius: "50%", display: "grid", placeItems: "center", background: "var(--teal-50)", color: "var(--teal-800)" }}>
              <Icon name="dollar" size={18} />
            </div>
            <div>
              <strong style={{ fontSize: 22, display: "block", color: "var(--ink-900)" }}>${animatedSavings.toLocaleString()}</strong>
              <small style={{ color: "var(--muted)" }}>Saved<br />this year</small>
            </div>
          </div>
        </div>
      </article>

      {/* AI recommendation */}
      {hasRecommendation ? (
        <article className="bb-card bb-card-pad" style={{ background: "linear-gradient(135deg, #fff 0%, #fff7ed 100%)", borderColor: "#f4dcc3" }}>
          <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
            <div style={{ width: 58, height: 58, borderRadius: 17, display: "grid", placeItems: "center", color: "white", background: "linear-gradient(135deg, var(--orange-600), #ff8f36)", flex: "0 0 58px" }}>
              <Icon name="sparkle" size={26} />
            </div>
            <div>
              <h3 style={{ margin: "2px 0 5px", fontSize: 20, color: "var(--ink-900)" }}>Bundleen AI</h3>
              <p style={{ color: "var(--muted)", lineHeight: 1.5, margin: "0 0 14px" }}>
                {ownRecommendedRequest
                  ? `${ownRecommendedRequest.title} has ${ownRecommendedRequest.bid_count} provider bid${ownRecommendedRequest.bid_count !== 1 ? "s" : ""}${ownRecommendedRequest.best_bid_cents ? `, with the best at $${Math.round(ownRecommendedRequest.best_bid_cents / 100).toLocaleString()}` : ""}${recommendationSavings > 0 ? ` and about $${Math.round(recommendationSavings / 100).toLocaleString()} under your target.` : "."}`
                  : `${neighbourhoodRecommendedRequest?.owner_name}'s ${neighbourhoodRecommendedRequest?.title} is getting provider interest in ${neighbourhoodRecommendedRequest?.neighborhood} with ${neighbourhoodRecommendedRequest?.bid_count} live bid${neighbourhoodRecommendedRequest && neighbourhoodRecommendedRequest.bid_count !== 1 ? "s" : ""}.`}
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                <Link href="/app/homeowner/bids" className="bb-btn bb-btn-primary" style={{ height: 36, padding: "0 16px", fontSize: 13 }}>
                  Review bids
                </Link>
                <Link href="/app/homeowner/chat" className="bb-btn bb-btn-secondary" style={{ height: 36, padding: "0 16px", fontSize: 13 }}>
                  Ask why
                </Link>
              </div>
            </div>
          </div>
        </article>
      ) : null}

      {/* Popular services */}
      <div className="bb-section-label">Popular services</div>
      <article className="bb-card bb-card-pad">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
          {POPULAR_SERVICES.map((service) => (
            <Link
              key={service.label}
              href="/app/homeowner/request"
              style={{ textAlign: "center", padding: "14px 6px", borderRadius: 17, background: "var(--cream-200)", textDecoration: "none" }}
            >
              <div style={{ width: 52, height: 52, margin: "0 auto 8px", borderRadius: 15, background: "var(--teal-50)", display: "grid", placeItems: "center", color: "var(--teal-800)" }}>
                <Icon name={service.icon} size={24} />
              </div>
              <span style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-900)" }}>{service.label}</span>
            </Link>
          ))}
        </div>
      </article>
    </div>
  );
}
