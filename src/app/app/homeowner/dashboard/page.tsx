"use client";

import { useEffect, type CSSProperties } from "react";
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
import { initialsFromName } from "@/lib/display-name";

const POPULAR_SERVICES: { label: string; icon: "cleaning" | "plumbing" | "electrical" | "painting"; blurb: string }[] = [
  { label: "Cleaning", icon: "cleaning", blurb: "Home, office" },
  { label: "Plumbing", icon: "plumbing", blurb: "Fix, install" },
  { label: "Electrical", icon: "electrical", blurb: "Repair, install" },
  { label: "Painting", icon: "painting", blurb: "Interior, exterior" },
];

export default function HomeownerDashboard() {
  const { dashboard, user, loading } = useHomeownerDashboard();
  const { requests, refresh: refreshRequests } = useHomeownerRequests();
  const { requests: nbRequests, loading: nbRequestsLoading } = useNeighbourhoodRequests();
  const { notifications, markRead, dismiss } = useNotifications();
  const { otherMembers, neighbourhoodName, neighborCount } = useNeighbourhoodSummary();
  const totalSaved = Math.round((dashboard?.total_saved_cents ?? 0) / 100);
  const animatedSavings = useCountUp(totalSaved);
  const groupCount = requests.filter((r) => r.status === "grouping").length;
  const savingsGoal = totalSaved > 0 ? Math.ceil((totalSaved + 1) / 500) * 500 : 500;
  const savingsProgress = Math.min(100, Math.round((totalSaved / savingsGoal) * 100));
  const totalBidsAcrossRequests = requests.reduce((sum, r) => sum + r.bid_count, 0);

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

  const displayName = user?.full_name ?? "Homeowner";
  const initials = initialsFromName(user?.full_name);

  const scrollToNotifications = () => {
    const target = window.matchMedia("(min-width: 1280px)").matches
      ? document.querySelector<HTMLElement>("#dashboard-notifications")
      : document.querySelector<HTMLElement>(".dash-inline-notifications");
    (target ?? document.querySelector<HTMLElement>(".dash-workspace"))?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  return (
    <div className="dash-shell">
      <aside className="dash-sidebar" aria-label="Primary navigation">
        <Link className="dash-sidebar-brand" href="/app/homeowner/dashboard" aria-label="Bundleen home">
          <img src="/creative/icons/logo-house.svg" alt="" />
          <span>Bundleen</span>
        </Link>

        <nav className="dash-sidebar-nav">
          <Link className="dash-nav-item is-active" href="/app/homeowner/dashboard">
            <Icon name="home" size={20} /> <span>Overview</span>
          </Link>
          <Link className="dash-nav-item" href="/app/homeowner/request">
            <Icon name="clipboard" size={20} /> <span>My Requests</span>
          </Link>
          <Link className="dash-nav-item" href="/app/homeowner/bids">
            <Icon name="bids" size={20} /> <span>My Bids</span>
          </Link>
          <Link className="dash-nav-item" href="/app/homeowner/chat">
            <Icon name="chat" size={20} /> <span>Messages</span>
            {(dashboard?.unread_messages ?? 0) > 0 && <b className="dash-nav-badge amber">{dashboard?.unread_messages}</b>}
          </Link>
          <span className="dash-nav-item is-disabled">
            <Icon name="shield" size={20} /> <span>Saved Providers</span>
            <b className="dash-nav-soon">Soon</b>
          </span>
          <span className="dash-nav-item is-disabled">
            <Icon name="dollar" size={20} /> <span>Payments</span>
            <b className="dash-nav-soon">Soon</b>
          </span>
          <Link className="dash-nav-item" href="/app/homeowner/profile">
            <Icon name="sliders" size={20} /> <span>Settings</span>
          </Link>
        </nav>

        <section className="dash-invite-card" aria-label="Invite neighbors">
          <span>Grow your bundle</span>
          <h3>Invite neighbors, unlock better deals!</h3>
          <p>More people means stronger provider competition and better pricing.</p>
          <Link href="/app/homeowner/request" className="bb-btn bb-btn-primary" style={{ height: 34, padding: "0 12px", fontSize: 12 }}>
            <Icon name="users" size={14} /> Invite now
          </Link>
        </section>

        <div className="dash-sidebar-profile">
          <div className="dash-avatar">{initials}</div>
          <div>
            <strong>{displayName}</strong>
            <span>Homeowner</span>
          </div>
          <Link href="/app/homeowner/profile" className="dash-icon-btn" aria-label="Open profile">
            <Icon name="chevron-right" size={16} />
          </Link>
        </div>
      </aside>

      <div className="dash-mobile-topbar">
        <Link className="dash-mobile-topbar-brand" href="/app/homeowner/dashboard">
          <img src="/creative/icons/logo-house.svg" alt="" /><span>Bundleen</span>
        </Link>
        <div className="dash-mobile-topbar-actions">
          <button className="dash-icon-btn" aria-label="Notifications" type="button" onClick={scrollToNotifications}>
            <Icon name="bell" size={18} />
            {notifications.length > 0 && <span className="dash-notif-dot" />}
          </button>
          <Link className="dash-avatar" href="/app/homeowner/profile" aria-label={`Open ${displayName}'s profile`}>
            {initials}
          </Link>
        </div>
      </div>

      <div className="dash-content" id="overview">
        <div className="dash-topbar-actions">
          <button className="dash-icon-btn" aria-label="Notifications" type="button" onClick={scrollToNotifications}>
            <Icon name="bell" size={18} />
            {notifications.length > 0 && <span className="dash-notif-dot" />}
          </button>
          <Link className="dash-avatar" href="/app/homeowner/profile" aria-label={`Open ${displayName}'s profile`}>
            {initials}
          </Link>
        </div>

      <div className="dash-workspace">
      <div className="dash-content-inner">
        {notifications.length > 0 && (
        <div className="dash-inline-notifications" style={{ flexDirection: "column", gap: 10, marginBottom: 18 }}>
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

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 18 }}>
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
              const chip = statusChip(r.group_status ?? r.status);
              const activityLabel =
                r.group_status === "bidding" ? "Bids live" : r.group_status === "pending_approval" ? "Pending approval" : "Join group";
              return (
                <div key={r.id} className="dash-request-row">
                  <CategoryTile category={r.category} size={38} />
                  <div style={{ minWidth: 0 }}>
                    <strong style={{ display: "block", fontSize: 14, color: "var(--ink-900)" }}>{r.title}</strong>
                    <small style={{ display: "block", marginTop: 4, color: "var(--muted)", fontSize: 12 }}>
                      {r.neighborhood} · by {r.owner_name} · {r.bid_count} bid{r.bid_count !== 1 ? "s" : ""}
                    </small>
                  </div>
                  <span className="dash-request-status" style={{ background: chip.bg, color: chip.color }}>
                    {activityLabel}
                  </span>
                  <Icon name="chevron-right" size={16} style={{ color: "var(--ink-400)" }} />
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
          <div className="dash-request-list" style={{ padding: "0 22px 20px" }}>
            {openRequests.slice(0, 5).map((r) => {
              const chip = statusChip(r.status);
              return (
                <div key={r.id} className="dash-request-row">
                  <CategoryTile category={r.category} size={38} />
                  <div style={{ minWidth: 0 }}>
                    <strong style={{ display: "block", fontSize: 14, color: "var(--ink-900)" }}>{r.title}</strong>
                    <small style={{ display: "block", marginTop: 4, color: "var(--muted)", fontSize: 12 }}>
                      {r.neighborhood} · {r.bid_count} {r.bid_count === 1 ? "bid" : "bids"}
                    </small>
                  </div>
                  <span className="dash-request-status" style={{ background: chip.bg, color: chip.color }}>
                    {r.status.charAt(0).toUpperCase() + r.status.slice(1)}
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
      </div>

      <aside className="dash-right-rail" aria-label="Dashboard updates">
        <section className="bb-card dash-rail-card" id="dashboard-notifications">
          <div className="dash-rail-heading">
            <div>
              <span className="bb-eyebrow">Inbox</span>
              <h2>Notifications</h2>
            </div>
            <span className="dash-rail-count">{notifications.length}</span>
          </div>
          <div className="dash-rail-list">
            {notifications.length > 0 ? notifications.slice(0, 3).map((notification) => (
              <div className="dash-rail-item" key={notification.id}>
                <span className="dash-rail-icon"><Icon name="bell" size={15} /></span>
                <div>
                  <strong>{notification.title}</strong>
                  <p>{notification.body}</p>
                  <div className="dash-rail-item-actions">
                    {notification.action_url ? (
                      <Link href={notification.action_url} onClick={() => void markRead(notification.id)}>View</Link>
                    ) : null}
                    <button type="button" onClick={() => void dismiss(notification.id)}>Dismiss</button>
                  </div>
                </div>
              </div>
            )) : (
              <div className="dash-rail-empty">
                <span className="dash-rail-icon"><Icon name="check-circle" size={17} /></span>
                <div><strong>You&rsquo;re all caught up</strong><p>New bid and group updates will appear here.</p></div>
              </div>
            )}
          </div>
        </section>

        <section className="bb-card dash-rail-card">
          <div className="dash-rail-heading">
            <div>
              <span className="bb-eyebrow">Nearby</span>
              <h2>Recent activity</h2>
            </div>
            <Link href="/app/homeowner/chat">View all</Link>
          </div>
          <div className="dash-rail-list">
            {neighbourhoodPulse.length > 0 ? neighbourhoodPulse.map((activity) => (
              <div className="dash-rail-item" key={activity.key}>
                <span className="dash-activity-avatar">{activity.initials}</span>
                <div>
                  <strong>{activity.who}</strong>
                  <p>{activity.what} <b>{activity.highlight}</b></p>
                  <time>{activity.when}</time>
                </div>
              </div>
            )) : (
              <div className="dash-rail-empty">
                <span className="dash-rail-icon"><Icon name="users" size={17} /></span>
                <div><strong>Your neighborhood is quiet</strong><p>Post a request to start local activity.</p></div>
              </div>
            )}
          </div>
        </section>

        <section className="bb-card dash-rail-card dash-quick-card">
          <span className="bb-eyebrow">Quick actions</span>
          <h2>What do you need?</h2>
          <div className="dash-quick-links">
            <Link href="/app/homeowner/request"><Icon name="plus" size={16} /> New request</Link>
            <Link href="/app/homeowner/bids"><Icon name="bids" size={16} /> Review bids</Link>
            <Link href="/app/homeowner/chat"><Icon name="sparkle" size={16} /> Ask Bundleen AI</Link>
          </div>
        </section>
      </aside>
      </div>
      </div>

      <Link href="/app/homeowner/request" className="dash-floating-action" aria-label="Create a new request">
        <Icon name="plus" size={24} />
      </Link>

      <nav className="dash-mobile-bottom-nav" aria-label="Mobile navigation">
        <Link className="is-active" href="/app/homeowner/dashboard">
          <Icon name="home" size={20} /><span>Home</span>
        </Link>
        <Link href="/app/homeowner/request">
          <Icon name="clipboard" size={20} /><span>Requests</span>
        </Link>
        <Link href="/app/homeowner/request" className="dash-mobile-create" aria-label="New request">
          <Icon name="plus" size={22} />
        </Link>
        <Link href="/app/homeowner/bids">
          <Icon name="bids" size={20} /><span>Bids</span>
        </Link>
        <Link href="/app/homeowner/chat">
          <Icon name="chat" size={20} /><span>Activity</span>
        </Link>
      </nav>
    </div>
  );
}
