"use client";

import { useEffect, type CSSProperties } from "react";
import Link from "next/link";

import { CategoryTile } from "@/components/ui/CategoryArt";
import { Icon } from "@/components/ui/Icon";
import { PageSkeleton } from "@/components/ui/Skeleton";
import { useCountUp } from "@/hooks/useCountUp";
import { useHomeownerDashboard } from "@/hooks/useHomeownerDashboard";
import { ACTIVE_REQUEST_STATUSES, useHomeownerRequests } from "@/hooks/useHomeownerRequests";
import { useNeighbourhood } from "@/hooks/useNeighbourhood";
import { useNeighbourhoodSummary } from "@/hooks/useNeighbourhoodSummary";

/** Server lifecycle values, in the words a homeowner would use for them. */
const REQUEST_STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  collecting_interest: "Grouping",
  open_for_bids: "Bids open",
  bidding_closed: "Reviewing",
  awarded: "Awarded",
  scheduled: "Scheduled",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
  failed: "Not filled",
};

const POPULAR_SERVICES: { label: string; icon: "cleaning" | "plumbing" | "electrical" | "painting"; blurb: string }[] = [
  { label: "Cleaning", icon: "cleaning", blurb: "Home, office" },
  { label: "Plumbing", icon: "plumbing", blurb: "Fix, install" },
  { label: "Electrical", icon: "electrical", blurb: "Repair, install" },
  { label: "Painting", icon: "painting", blurb: "Interior, exterior" },
];

export default function HomeownerDashboard() {
  const { dashboard, user, loading } = useHomeownerDashboard();
  const { requests, refresh: refreshRequests } = useHomeownerRequests();
  // The real neighbourhood, from `/api/homeowner/neighbourhood`. The previous
  // hook called `/neighbourhood/requests`, which had no Route Handler behind
  // it, so this panel had nothing to show even when neighbours were active.
  const { hub, loading: nbRequestsLoading } = useNeighbourhood();
  const nbRequests = hub?.requests ?? [];
  const { otherMembers, neighbourhoodName, neighborCount } = useNeighbourhoodSummary();
  const totalSaved = Math.round((dashboard?.total_saved_cents ?? 0) / 100);
  const animatedSavings = useCountUp(totalSaved);
  const groupCount = requests.filter((r) => r.status === "collecting_interest").length;
  const savingsGoal = totalSaved > 0 ? Math.ceil((totalSaved + 1) / 500) * 500 : 500;
  const savingsProgress = Math.min(100, Math.round((totalSaved / savingsGoal) * 100));
  const totalBidsAcrossRequests = requests.reduce((sum, r) => sum + r.bidCount, 0);

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
  const openRequests = requests.filter((r) => ACTIVE_REQUEST_STATUSES.includes(r.status));
  // Neighbours' requests this account could still join.
  const neighbourhoodOpportunities = nbRequests.filter(
    (request) => !request.isOwner && request.permissions.canRespond,
  );
  const liveRequest = openRequests.find((r) => r.status === "open_for_bids") ?? openRequests[0] ?? null;
  const ownRecommendedRequest = openRequests
    .filter((request) => request.bidCount > 0)
    .sort((a, b) => {
      const bestBidA = a.bestBidCents ?? Number.POSITIVE_INFINITY;
      const bestBidB = b.bestBidCents ?? Number.POSITIVE_INFINITY;
      if (bestBidA !== bestBidB) return bestBidA - bestBidB;
      return b.bidCount - a.bidCount;
    })[0] ?? null;
  const neighbourhoodRecommendedRequest =
    nbRequests
      .filter((request) => !request.isOwner && request.bidCount > 0)
      .sort((a, b) => b.bidCount - a.bidCount)[0] ?? null;
  const recommendationTarget = ownRecommendedRequest ?? neighbourhoodRecommendedRequest;
  const hasRecommendation = recommendationTarget !== null;
  const recommendationSavings =
    ownRecommendedRequest?.bestBidCents != null &&
    ownRecommendedRequest.budgetMaxCents != null
      ? Math.max(0, ownRecommendedRequest.budgetMaxCents - ownRecommendedRequest.bestBidCents)
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
    ...nbRequests.filter((request) => !request.isOwner).slice(0, 2).map((request) => ({
      key: `request-${request.id}`,
      who: request.createdByName,
      initials: request.createdByName.split(" ").map((part) => part[0]).slice(0, 2).join("").toUpperCase(),
      what: "posted a new",
      highlight: `${request.categoryLabel} request`,
      when: new Date(request.createdAt).toLocaleDateString([], { month: "short", day: "numeric" }),
    })),
  ].slice(0, 3);

  function statusChip(status: string): { bg: string; color: string } {
    switch (status.toLowerCase()) {
      // Server lifecycle values from `HoaRequestStatus`.
      case "open_for_bids":
      case "bidding":            return { bg: "var(--terracotta-50)", color: "var(--terracotta-600)" };
      case "collecting_interest":
      case "grouping":           return { bg: "var(--sage-50)",       color: "var(--sage-700)"       };
      case "bidding_closed":
      case "pending_approval":   return { bg: "var(--gold-50)",       color: "var(--gold-600)"       };
      case "awarded":
      case "scheduled":
      case "in_progress":        return { bg: "var(--sage-50)",       color: "var(--sage-700)"       };
      case "draft":              return { bg: "var(--cream-200)",     color: "var(--ink-700)"        };
      default:                   return { bg: "var(--cream-200)",     color: "var(--ink-400)"        };
    }
  }

  if (loading) {
    return <PageSkeleton />;
  }

  return (
    <>
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
            ? `${liveRequest.title} · ${liveRequest.bidCount} bid${liveRequest.bidCount !== 1 ? "s" : ""} in · ${liveRequest.communityName}`
            : "Bundle your home-service request with nearby neighbors and unlock better group pricing."}
        </p>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 18 }}>
          <Link href={liveRequest ? "/app/homeowner/bids" : "/app/homeowner/request"} className="bb-btn bb-btn-primary">
            <Icon name="plus" size={18} /> {liveRequest ? "Review bids" : "New request"}
          </Link>
        </div>

        <img
          src="/creative/illustrations/house-hero.svg"
          alt="Neighborhood homes and home-service tools"
          style={{ width: "100%", maxWidth: 320, margin: "18px auto -18px", display: "block" }}
        />
      </article>

      {/* Stats */}
      <div className="dash-stats-grid" style={{ margin: "18px 0" }}>
        <article className="bb-card dash-stat-card mint">
          <div className="dash-stat-topline">
            <span className="dash-icon-tile"><Icon name="tag" size={20} /></span>
            <span className="dash-trend up">↑ new activity</span>
          </div>
          <p className="dash-stat-label">Active Bids</p>
          <strong className="dash-stat-number">{dashboard?.active_bids ?? 0}</strong>
          <svg className="dash-sparkline" viewBox="0 0 220 58" aria-hidden="true">
            <path className="dash-spark-area" d="M0,48 C20,26 42,50 64,38 C84,29 99,52 121,38 C144,21 157,14 179,32 C195,46 205,26 220,30 L220,58 L0,58 Z" />
            <path className="dash-spark-line" d="M0,48 C20,26 42,50 64,38 C84,29 99,52 121,38 C144,21 157,14 179,32 C195,46 205,26 220,30" />
          </svg>
        </article>

        <article className="bb-card dash-stat-card amber">
          <div className="dash-stat-topline">
            <span className="dash-icon-tile"><Icon name="clipboard" size={20} /></span>
            <span className="dash-trend neutral">In progress</span>
          </div>
          <p className="dash-stat-label">Active Requests</p>
          <strong className="dash-stat-number">{dashboard?.active_requests ?? 0}</strong>
          <svg className="dash-sparkline" viewBox="0 0 220 58" aria-hidden="true">
            <path className="dash-spark-area" d="M0,43 C18,52 27,20 47,36 C70,55 91,49 108,26 C124,8 142,22 158,40 C177,58 195,45 220,42 L220,58 L0,58 Z" />
            <path className="dash-spark-line" d="M0,43 C18,52 27,20 47,36 C70,55 91,49 108,26 C124,8 142,22 158,40 C177,58 195,45 220,42" />
          </svg>
        </article>

        <article className="bb-card dash-stat-card mint">
          <div className="dash-stat-topline">
            <span className="dash-icon-tile"><Icon name="users" size={20} /></span>
            <span className="dash-trend up">forming now</span>
          </div>
          <p className="dash-stat-label">Groups</p>
          <strong className="dash-stat-number">{groupCount}</strong>
          <svg className="dash-sparkline" viewBox="0 0 220 58" aria-hidden="true">
            <path className="dash-spark-area" d="M0,47 C18,41 28,19 46,31 C63,43 78,54 95,36 C112,18 127,23 142,40 C158,58 173,33 190,27 C204,22 211,32 220,30 L220,58 L0,58 Z" />
            <path className="dash-spark-line" d="M0,47 C18,41 28,19 46,31 C63,43 78,54 95,36 C112,18 127,23 142,40 C158,58 173,33 190,27 C204,22 211,32 220,30" />
          </svg>
        </article>

        <article className="bb-card dash-stat-card amber">
          <div className="dash-stat-topline">
            <span className="dash-icon-tile"><Icon name="dollar" size={20} /></span>
            <span className="dash-trend up">this year</span>
          </div>
          <p className="dash-stat-label">Total Savings</p>
          <strong className="dash-stat-number">${animatedSavings.toLocaleString()}</strong>
          <svg className="dash-sparkline" viewBox="0 0 220 58" aria-hidden="true">
            <path className="dash-spark-area" d="M0,48 C20,17 38,36 52,44 C70,54 83,24 98,36 C117,51 130,29 145,27 C163,25 171,18 188,18 C205,18 211,28 220,25 L220,58 L0,58 Z" />
            <path className="dash-spark-line" d="M0,48 C20,17 38,36 52,44 C70,54 83,24 98,36 C117,51 130,29 145,27 C163,25 171,18 188,18 C205,18 211,28 220,25" />
          </svg>
        </article>
      </div>

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
          <div className="dash-request-list" style={{ padding: "0 22px 20px" }}>
            {neighbourhoodOpportunities.slice(0, 5).map((r) => {
              const chip = statusChip(r.status);
              return (
                <Link
                  className="dash-request-row"
                  href="/app/homeowner/neighbourhood"
                  key={r.id}
                >
                  <CategoryTile category={r.category} size={38} />
                  <div style={{ minWidth: 0 }}>
                    <strong style={{ display: "block", fontSize: 14, color: "var(--ink-900)" }}>{r.title}</strong>
                    <small style={{ display: "block", marginTop: 4, color: "var(--muted)", fontSize: 12 }}>
                      {r.communityName} · by {r.createdByName} · {r.joinedCount} home{r.joinedCount !== 1 ? "s" : ""} joined
                    </small>
                  </div>
                  <span className="dash-request-status" style={{ background: chip.bg, color: chip.color }}>
                    Join group
                  </span>
                  <Icon name="chevron-right" size={16} style={{ color: "var(--ink-400)" }} />
                </Link>
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
          <div className="dash-request-list" style={{ padding: "0 22px 20px" }}>
            {openRequests.slice(0, 5).map((r) => {
              const chip = statusChip(r.status);
              return (
                <div key={r.id} className="dash-request-row">
                  <CategoryTile category={r.category} size={38} />
                  <div style={{ minWidth: 0 }}>
                    <strong style={{ display: "block", fontSize: 14, color: "var(--ink-900)" }}>{r.title}</strong>
                    <small style={{ display: "block", marginTop: 4, color: "var(--muted)", fontSize: 12 }}>
                      {r.communityName} · {r.bidCount} {r.bidCount === 1 ? "bid" : "bids"}
                    </small>
                  </div>
                  <span className="dash-request-status" style={{ background: chip.bg, color: chip.color }}>
                    {REQUEST_STATUS_LABELS[r.status] ?? r.status}
                  </span>
                  <Icon name="chevron-right" size={16} style={{ color: "var(--ink-400)" }} />
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
          <ul className="dash-activity-list">
            {neighbourhoodPulse.map((a) => (
              <li key={a.key}>
                <div className="dash-activity-avatar">{a.initials}</div>
                <p>
                  <strong style={{ color: "var(--ink-900)" }}>{a.who}</strong> {a.what}{" "}
                  <span style={{ color: "var(--orange-600)", fontWeight: 600 }}>{a.highlight}</span>
                </p>
                <time>{a.when}</time>
              </li>
            ))}
          </ul>
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
          </div>
        </article>
      )}

      {/* Savings */}
      <article className="bb-card bb-card-pad">
        <div className="bb-card-header">
          <div>
            <span className="bb-eyebrow">Savings goal</span>
            <h2 className="bb-card-title">Your Group Savings Progress</h2>
          </div>
          <Link href="/app/homeowner/bids" className="bb-link">View all</Link>
        </div>

        <div className="dash-savings-layout">
          <div className="dash-progress-ring" style={{ "--p": savingsProgress } as CSSProperties}>
            <div>
              <strong>{savingsProgress}%</strong>
              <span>of goal</span>
            </div>
          </div>
          <div className="dash-goal-copy">
            <h3>
              {totalSaved > 0
                ? <>You&rsquo;re <em>${(savingsGoal - totalSaved).toLocaleString()}</em> away from unlocking your next savings milestone!</>
                : "Accept a group bid and your savings progress starts here."}
            </h3>
            <div className="dash-goal-bar"><span style={{ width: `${savingsProgress}%` }} /></div>
            <div className="dash-goal-labels">
              <span>${animatedSavings.toLocaleString()} saved</span>
              <span>Goal ${savingsGoal.toLocaleString()}</span>
            </div>
          </div>
        </div>

        <div className="dash-mini-stats">
          <div>
            <span className="dash-mini-icon"><Icon name="users" size={18} /></span>
            <div>
              <strong>{neighborCount}</strong>
              <p>Neighbors joined</p>
            </div>
          </div>
          <div>
            <span className="dash-mini-icon amber"><Icon name="tag" size={18} /></span>
            <div>
              <strong>{totalBidsAcrossRequests}</strong>
              <p>Bids received</p>
            </div>
          </div>
          <div>
            <span className="dash-mini-icon"><Icon name="dollar" size={18} /></span>
            <div>
              <strong>${animatedSavings.toLocaleString()}</strong>
              <p>Saved this year</p>
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
                  ? `${ownRecommendedRequest.title} has ${ownRecommendedRequest.bidCount} provider bid${ownRecommendedRequest.bidCount !== 1 ? "s" : ""}${ownRecommendedRequest.bestBidCents ? `, with the best at $${Math.round(ownRecommendedRequest.bestBidCents / 100).toLocaleString()}` : ""}${recommendationSavings > 0 ? ` and about $${Math.round(recommendationSavings / 100).toLocaleString()} under your target.` : "."}`
                  : `${neighbourhoodRecommendedRequest?.createdByName}'s ${neighbourhoodRecommendedRequest?.title} is getting provider interest in ${neighbourhoodRecommendedRequest?.communityName} with ${neighbourhoodRecommendedRequest?.bidCount} live bid${neighbourhoodRecommendedRequest && neighbourhoodRecommendedRequest.bidCount !== 1 ? "s" : ""}.`}
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                <Link href="/app/homeowner/bids" className="bb-btn bb-btn-primary" style={{ height: 36, padding: "0 16px", fontSize: 13 }}>
                  Review bids
                </Link>
              </div>
            </div>
          </div>
        </article>
      ) : null}

      {/* Popular services */}
      <div className="bb-section-label">Popular services</div>
      <article className="bb-card bb-card-pad">
        <div className="dash-service-grid">
          {POPULAR_SERVICES.map((service, index) => (
            <Link
              key={service.label}
              href="/app/homeowner/request"
              className="dash-service-card"
              style={{ background: index % 2 === 0 ? "var(--teal-50)" : "var(--amber-50)" }}
            >
              <Icon name={service.icon} size={26} style={{ color: index % 2 === 0 ? "var(--teal-800)" : "var(--amber-700)" }} />
              <strong>{service.label}</strong>
              <small>{service.blurb}</small>
            </Link>
          ))}
        </div>
      </article>
    </>
  );
}
