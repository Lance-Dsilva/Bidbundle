"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { roleLine, ViewerIdentity } from "@/components/layout/ViewerIdentity";
import { Icon } from "@/components/ui/Icon";
import { useNotifications } from "@/hooks/useNotifications";
import { useViewerContext } from "@/hooks/useViewerContext";
import { useProviderDashboard } from "@/hooks/useProviderDashboard";
import { useProviderJobFeed } from "@/hooks/useProviderJobFeed";
import { initialsFromName } from "@/lib/display-name";

const providerNavigation = [
  { label: "Overview", href: "/app/provider/dashboard", icon: "home" as const },
  { label: "Job Feed", href: "/app/provider/job-feed", icon: "search" as const },
  { label: "My Bids", href: "/app/provider/bids", icon: "bids" as const },
  { label: "Messages", href: "/app/provider/messages", icon: "chat" as const },
  { label: "Schedule", href: "/app/provider/schedule", icon: "calendar" as const },
  { label: "Earnings", href: "/app/provider/earnings", icon: "dollar" as const },
  { label: "Reviews", href: "/app/provider/reviews", icon: "scale" as const },
];

type ProviderShellProps = Readonly<{
  children: ReactNode;
  /** Display name from the verified server session, not from client state. */
  userName: string;
}>;

export function ProviderShell({ children, userName }: ProviderShellProps) {
  const pathname = usePathname();
  const { dashboard, profile } = useProviderDashboard();
  const { jobs } = useProviderJobFeed();
  const { notifications, markRead, dismiss } = useNotifications();
  // Account status is server-owned: a suspended provider is told so here, and
  // the provider write endpoints enforce it independently.
  const { context } = useViewerContext();
  const providerName = profile?.company_name || userName || "Service Provider";
  const providerInitials = initialsFromName(providerName, "SP");
  const accountName = userName || providerName;
  const accountInitials = initialsFromName(accountName, "SP");

  const scrollToNotifications = () => {
    document.querySelector<HTMLElement>("#provider-notifications")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  return (
    <div className="dash-shell provider-shell">
      <aside className="dash-sidebar" aria-label="Provider navigation">
        <Link className="dash-sidebar-brand" href="/app/provider/dashboard" aria-label="Bundleen provider home">
          <img src="/creative/icons/logo-house.svg" alt="" />
          <span>Bundleen</span>
        </Link>

        <nav className="dash-sidebar-nav">
          {providerNavigation.map((item) => (
            <Link
              className={`dash-nav-item${pathname === item.href ? " is-active" : ""}`}
              href={item.href}
              key={item.href}
            >
              <Icon name={item.icon} size={20} />
              <span>{item.label}</span>
              {item.label === "Messages" && (dashboard?.unread_messages ?? 0) > 0 ? (
                <b className="dash-nav-badge amber">{dashboard?.unread_messages}</b>
              ) : null}
            </Link>
          ))}
          <Link className={`dash-nav-item${pathname === "/app/provider/profile" ? " is-active" : ""}`} href="/app/provider/profile">
            <Icon name="sliders" size={20} /><span>Settings</span>
          </Link>
        </nav>

        <section className="dash-invite-card provider-growth-card" aria-label="Grow your business">
          <span>Grow your business</span>
          <h3>Find nearby jobs without extra driving.</h3>
          <p>Review neighborhood demand and bid on work that matches your services.</p>
          <Link href="/app/provider/job-feed" className="bb-btn bb-btn-primary" style={{ height: 34, padding: "0 12px", fontSize: 12 }}>
            <Icon name="search" size={14} /> Find jobs
          </Link>
        </section>

        <div className="dash-sidebar-profile">
          <div className="dash-avatar">{providerInitials}</div>
          <div><strong>{providerName}</strong><span>{context ? roleLine(context) : "Service provider"}</span></div>
          <Link href="/app/provider/profile" className="dash-icon-btn" aria-label="Open provider profile">
            <Icon name="chevron-right" size={16} />
          </Link>
        </div>
      </aside>

      <div className="dash-mobile-topbar">
        <Link className="dash-mobile-topbar-brand" href="/app/provider/dashboard">
          <img src="/creative/icons/logo-house.svg" alt="" /><span>Bundleen</span>
        </Link>
        <div className="dash-mobile-topbar-actions">
          <button className="dash-icon-btn" aria-label="Notifications" type="button" onClick={scrollToNotifications}>
            <Icon name="bell" size={18} />
            {notifications.length > 0 ? <span className="dash-notif-dot" /> : null}
          </button>
          <Link className="dash-avatar" href="/app/provider/profile" aria-label={`Open ${accountName}'s profile`}>
            {accountInitials}
          </Link>
        </div>
      </div>

      <div className="dash-content">
        <div className="dash-topbar-actions">
          <button className="dash-icon-btn" aria-label="Notifications" type="button" onClick={scrollToNotifications}>
            <Icon name="bell" size={18} />
            {notifications.length > 0 ? <span className="dash-notif-dot" /> : null}
          </button>
          <div className="dash-topbar-identity">
            <ViewerIdentity context={context} fallbackName={accountName} compact />
          </div>
          <Link className="dash-avatar" href="/app/provider/profile" aria-label={`Open ${accountName}'s profile`}>
            {accountInitials}
          </Link>
        </div>

        <div className="dash-workspace">
          <main className="dash-content-inner provider-route-content">{children}</main>

          <aside className="dash-right-rail" aria-label="Provider updates">
            <section className="bb-card dash-rail-card" id="provider-notifications">
              <div className="dash-rail-heading">
                <div><span className="bb-eyebrow">Inbox</span><h2>Notifications</h2></div>
                <span className="dash-rail-count">{notifications.length}</span>
              </div>
              <div className="dash-rail-list">
                {notifications.length > 0 ? notifications.slice(0, 3).map((notification) => (
                  <div className="dash-rail-item" key={notification.id}>
                    <span className="dash-rail-icon"><Icon name="bell" size={15} /></span>
                    <div>
                      <strong>{notification.title}</strong><p>{notification.body}</p>
                      <div className="dash-rail-item-actions">
                        {notification.action_url ? <Link href={notification.action_url} onClick={() => void markRead(notification.id)}>View</Link> : null}
                        <button type="button" onClick={() => void dismiss(notification.id)}>Dismiss</button>
                      </div>
                    </div>
                  </div>
                )) : (
                  <div className="dash-rail-empty">
                    <span className="dash-rail-icon"><Icon name="check-circle" size={17} /></span>
                    <div><strong>You&rsquo;re all caught up</strong><p>New bid and job updates will appear here.</p></div>
                  </div>
                )}
              </div>
            </section>

            <section className="bb-card dash-rail-card">
              <div className="dash-rail-heading">
                <div><span className="bb-eyebrow">Nearby</span><h2>Job opportunities</h2></div>
                <Link href="/app/provider/job-feed">View all</Link>
              </div>
              <div className="dash-rail-list">
                {jobs.length > 0 ? jobs.slice(0, 3).map((job) => (
                  <Link className="dash-rail-item provider-opportunity-link" href="/app/provider/job-feed" key={job.id}>
                    <span className="dash-rail-icon"><Icon name="tools" size={15} /></span>
                    <div>
                      <strong>{job.title}</strong>
                      <p>{job.neighborhood}{job.distance_mi !== null ? ` · ${job.distance_mi.toFixed(1)} mi` : ""}</p>
                      <time>${Math.round(job.budget_min / 100).toLocaleString()}–${Math.round(job.budget_max / 100).toLocaleString()}</time>
                    </div>
                  </Link>
                )) : (
                  <div className="dash-rail-empty">
                    <span className="dash-rail-icon"><Icon name="search" size={17} /></span>
                    <div><strong>No matching jobs yet</strong><p>New neighborhood opportunities will appear here.</p></div>
                  </div>
                )}
              </div>
            </section>

            <section className="bb-card dash-rail-card dash-quick-card">
              <span className="bb-eyebrow">Quick actions</span><h2>Manage your work</h2>
              <div className="dash-quick-links">
                <Link href="/app/provider/job-feed"><Icon name="search" size={16} /> Find a job</Link>
                <Link href="/app/provider/bids"><Icon name="bids" size={16} /> Manage bids</Link>
                <Link href="/app/provider/schedule"><Icon name="calendar" size={16} /> View schedule</Link>
              </div>
            </section>
          </aside>
        </div>
      </div>

      <nav className="dash-mobile-bottom-nav" aria-label="Provider mobile navigation">
        <Link className={pathname === "/app/provider/dashboard" ? "is-active" : ""} href="/app/provider/dashboard"><Icon name="home" size={20} /><span>Home</span></Link>
        <Link className={pathname === "/app/provider/job-feed" ? "is-active" : ""} href="/app/provider/job-feed"><Icon name="search" size={20} /><span>Jobs</span></Link>
        <Link href="/app/provider/job-feed" className="dash-mobile-create" aria-label="Find jobs"><Icon name="plus" size={22} /></Link>
        <Link className={pathname === "/app/provider/bids" ? "is-active" : ""} href="/app/provider/bids"><Icon name="bids" size={20} /><span>Bids</span></Link>
        <Link className={pathname === "/app/provider/messages" ? "is-active" : ""} href="/app/provider/messages"><Icon name="chat" size={20} /><span>Messages</span></Link>
      </nav>
    </div>
  );
}
