"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { roleLine, ViewerIdentity } from "@/components/layout/ViewerIdentity";
import { BundleenAiWidget } from "@/components/ai/BundleenAiWidget";
import { Icon } from "@/components/ui/Icon";
import { NotificationBell } from "@/components/ui/NotificationBell";
import { useHomeownerDashboard } from "@/hooks/useHomeownerDashboard";
import { useViewerContext } from "@/hooks/useViewerContext";
import { useNotifications } from "@/hooks/useNotifications";
import { initialsFromName } from "@/lib/display-name";

const navigation = [
  { label: "Overview", href: "/app/homeowner/dashboard", icon: "home" as const },
  { label: "My Requests", href: "/app/homeowner/request", icon: "clipboard" as const },
  { label: "My Bids", href: "/app/homeowner/bids", icon: "bids" as const },
  { label: "Messages", href: "/app/homeowner/chat", icon: "chat" as const },
];

type HomeownerShellProps = Readonly<{
  children: ReactNode;
  /** Display name from the verified server session, not from client state. */
  userName: string;
}>;

export function HomeownerShell({ children, userName }: HomeownerShellProps) {
  const pathname = usePathname();
  const { dashboard, user } = useHomeownerDashboard();
  const { notifications, loading: notificationsLoading, markRead, dismiss } = useNotifications();
  // Live scoped-role context. The "Community" link below appears from this,
  // but the page behind it re-derives the same assignments server-side — a
  // hidden link is a courtesy, not a permission.
  const { context } = useViewerContext();
  const hasHoaCommunity = context?.communities.some(
    (community) => community.communityType === "hoa" && community.status === "active",
  );

  const displayName = userName || user?.full_name || "Homeowner";
  const initials = initialsFromName(displayName);

  const isActive = (href: string) => pathname === href;

  return (
    <div className="dash-shell">
      <aside className="dash-sidebar" aria-label="Homeowner navigation">
        <Link className="dash-sidebar-brand" href="/app/homeowner/dashboard" aria-label="Bundleen home">
          <img src="/creative/icons/logo-house.svg" alt="" />
          <span>Bundleen</span>
        </Link>

        <nav className="dash-sidebar-nav">
          {navigation.map((item) => (
            <Link className={`dash-nav-item${isActive(item.href) ? " is-active" : ""}`} href={item.href} key={item.label}>
              <Icon name={item.icon} size={20} />
              <span>{item.label}</span>
              {item.label === "Messages" && (dashboard?.unread_messages ?? 0) > 0 ? (
                <b className="dash-nav-badge amber">{dashboard?.unread_messages}</b>
              ) : null}
            </Link>
          ))}
          {context?.canManageCommunity || hasHoaCommunity ? (
            <Link
              className={`dash-nav-item${pathname === "/app/homeowner/community" ? " is-active" : ""}`}
              href="/app/homeowner/community"
            >
              <Icon name="users" size={20} />
              <span>My Community</span>
              {context && context.assignments.length > 0 ? (
                <b className="dash-nav-badge amber">{context.assignments.length}</b>
              ) : null}
            </Link>
          ) : null}
          <span className="dash-nav-item is-disabled">
            <Icon name="shield" size={20} /><span>Saved Providers</span><b className="dash-nav-soon">Soon</b>
          </span>
          <span className="dash-nav-item is-disabled">
            <Icon name="dollar" size={20} /><span>Payments</span><b className="dash-nav-soon">Soon</b>
          </span>
          {/* One cross-role support surface. Same route for homeowners, HOA
              managers, and providers; the layout picks the shell. */}
          <Link className={`dash-nav-item${pathname.startsWith("/app/support") ? " is-active" : ""}`} href="/app/support">
            <Icon name="chat" size={20} /><span>Support</span>
          </Link>
          <Link className={`dash-nav-item${pathname === "/app/homeowner/profile" ? " is-active" : ""}`} href="/app/homeowner/profile">
            <Icon name="sliders" size={20} /><span>Settings</span>
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
          <Link className="dash-avatar" href="/app/homeowner/profile" aria-label={`Open ${displayName}'s profile`}>
            {initials}
          </Link>
          {/* Role label comes from the server, never from the route or local
              storage — an assignment made by staff shows up here on refresh. */}
          <div><strong>{context?.fullName || displayName}</strong><span>{context ? roleLine(context) : "Homeowner"}</span></div>
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
          <NotificationBell notifications={notifications} loading={notificationsLoading} markRead={markRead} dismiss={dismiss} />
          <Link className="dash-avatar" href="/app/homeowner/profile" aria-label={`Open ${displayName}'s profile`}>
            {initials}
          </Link>
        </div>
      </div>

      <div className="dash-content">
        <div className="dash-topbar-actions">
          <NotificationBell notifications={notifications} loading={notificationsLoading} markRead={markRead} dismiss={dismiss} />
          <div className="dash-topbar-identity">
            <ViewerIdentity context={context} fallbackName={displayName} compact />
          </div>
          <Link className="dash-avatar" href="/app/homeowner/profile" aria-label={`Open ${displayName}'s profile`}>
            {initials}
          </Link>
        </div>

        <main className="dash-content-inner homeowner-route-content">{children}</main>
      </div>

      <Link href="/app/homeowner/request" className="dash-floating-action" aria-label="Create a new request">
        <Icon name="plus" size={24} />
      </Link>
      <nav className="dash-mobile-bottom-nav" aria-label="Mobile navigation">
        <Link className={pathname === "/app/homeowner/dashboard" ? "is-active" : ""} href="/app/homeowner/dashboard"><Icon name="home" size={20} /><span>Home</span></Link>
        <Link className={pathname === "/app/homeowner/request" ? "is-active" : ""} href="/app/homeowner/request"><Icon name="clipboard" size={20} /><span>Requests</span></Link>
        <Link href="/app/homeowner/request" className="dash-mobile-create" aria-label="New request"><Icon name="plus" size={22} /></Link>
        <Link className={pathname === "/app/homeowner/bids" ? "is-active" : ""} href="/app/homeowner/bids"><Icon name="bids" size={20} /><span>Bids</span></Link>
        <Link className={pathname === "/app/homeowner/chat" ? "is-active" : ""} href="/app/homeowner/chat"><Icon name="chat" size={20} /><span>Activity</span></Link>
      </nav>

      <BundleenAiWidget />
    </div>
  );
}
