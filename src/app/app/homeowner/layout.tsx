"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Icon } from "@/components/ui/Icon";
import { useHomeownerDashboard } from "@/hooks/useHomeownerDashboard";
import { useHomeownerRequests } from "@/hooks/useHomeownerRequests";
import { useNeighbourhoodRequests } from "@/hooks/useNeighbourhoodRequests";
import { useNeighbourhoodSummary } from "@/hooks/useNeighbourhoodSummary";
import { useNotifications } from "@/hooks/useNotifications";

const navigation = [
  { label: "Overview", href: "/app/homeowner/dashboard", icon: "home" as const },
  { label: "My Requests", href: "/app/homeowner/request", icon: "clipboard" as const },
  { label: "My Bids", href: "/app/homeowner/bids#bids", icon: "bids" as const },
  { label: "Groups", href: "/app/homeowner/bids#groups", icon: "users" as const },
  { label: "Messages", href: "/app/homeowner/chat", icon: "chat" as const },
];

export default function HomeownerLayout({ children }: Readonly<{ children: ReactNode }>) {
  const pathname = usePathname();
  const { dashboard, user } = useHomeownerDashboard();
  const { requests } = useHomeownerRequests();
  const { requests: neighbourhoodRequests } = useNeighbourhoodRequests();
  const { otherMembers, neighbourhoodName } = useNeighbourhoodSummary();
  const { notifications, markRead, dismiss } = useNotifications();

  // The overview currently owns this exact shell; the other homeowner routes
  // use the shared version below while the overview content is migrated.
  if (pathname === "/app/homeowner/dashboard") return children;

  const initials = (user?.full_name ?? "NB")
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const groupCount = requests.filter((request) => request.status === "grouping").length;
  const recentActivity = [
    ...otherMembers.slice(0, 2).map((member) => ({
      key: `member-${member.user_id}`,
      initials: member.full_name.split(" ").map((part) => part[0]).slice(0, 2).join("").toUpperCase(),
      who: member.full_name,
      description: `joined ${neighbourhoodName}`,
      when: new Date(member.joined_at).toLocaleDateString([], { month: "short", day: "numeric" }),
    })),
    ...neighbourhoodRequests.filter((request) => !request.is_mine).slice(0, 2).map((request) => ({
      key: `request-${request.id}`,
      initials: request.owner_name.split(" ").map((part) => part[0]).slice(0, 2).join("").toUpperCase(),
      who: request.owner_name,
      description: `posted a ${request.category} request`,
      when: "New",
    })),
  ].slice(0, 3);

  const isActive = (href: string) => {
    const path = href.split("#")[0];
    if (path === "/app/homeowner/bids") return pathname === path;
    return pathname === path;
  };

  const scrollToNotifications = () => {
    document.querySelector<HTMLElement>("#homeowner-notifications")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  return (
    <div className="dash-shell">
      <aside className="dash-sidebar" aria-label="Homeowner navigation">
        <Link className="dash-sidebar-brand" href="/app/homeowner/dashboard" aria-label="BidBundle home">
          <img src="/creative/icons/logo-house.svg" alt="" />
          <span>BidBundle</span>
        </Link>

        <nav className="dash-sidebar-nav">
          {navigation.map((item) => (
            <Link className={`dash-nav-item${isActive(item.href) ? " is-active" : ""}`} href={item.href} key={item.label}>
              <Icon name={item.icon} size={20} />
              <span>{item.label}</span>
              {item.label === "Groups" && groupCount > 0 ? <b className="dash-nav-badge teal">{groupCount}</b> : null}
              {item.label === "Messages" && (dashboard?.unread_messages ?? 0) > 0 ? (
                <b className="dash-nav-badge amber">{dashboard?.unread_messages}</b>
              ) : null}
            </Link>
          ))}
          <span className="dash-nav-item is-disabled">
            <Icon name="shield" size={20} /><span>Saved Providers</span><b className="dash-nav-soon">Soon</b>
          </span>
          <span className="dash-nav-item is-disabled">
            <Icon name="dollar" size={20} /><span>Payments</span><b className="dash-nav-soon">Soon</b>
          </span>
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
          <div className="dash-avatar">{initials}</div>
          <div><strong>{user?.full_name ?? "Homeowner"}</strong><span>Homeowner</span></div>
          <Link href="/app/homeowner/profile" className="dash-icon-btn" aria-label="Open profile">
            <Icon name="chevron-right" size={16} />
          </Link>
        </div>
      </aside>

      <div className="dash-mobile-topbar">
        <Link className="dash-mobile-topbar-brand" href="/app/homeowner/dashboard">
          <img src="/creative/icons/logo-house.svg" alt="" /><span>BidBundle</span>
        </Link>
        <div className="dash-mobile-topbar-actions">
          <button className="dash-icon-btn" aria-label="Notifications" type="button" onClick={scrollToNotifications}>
            <Icon name="bell" size={18} />
            {notifications.length > 0 ? <span className="dash-notif-dot" /> : null}
          </button>
          <div className="dash-avatar">{initials}</div>
        </div>
      </div>

      <div className="dash-content">
        <div className="dash-topbar-actions">
          <button className="dash-icon-btn" aria-label="Notifications" type="button" onClick={scrollToNotifications}>
            <Icon name="bell" size={18} />
            {notifications.length > 0 ? <span className="dash-notif-dot" /> : null}
          </button>
          <div className="dash-avatar">{initials}</div>
        </div>

        <div className="dash-workspace">
          <main className="dash-content-inner homeowner-route-content">{children}</main>

          <aside className="dash-right-rail" aria-label="Homeowner updates">
            <section className="bb-card dash-rail-card" id="homeowner-notifications">
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
                    <div><strong>You&rsquo;re all caught up</strong><p>New bid and group updates will appear here.</p></div>
                  </div>
                )}
              </div>
            </section>

            <section className="bb-card dash-rail-card">
              <div className="dash-rail-heading">
                <div><span className="bb-eyebrow">Nearby</span><h2>Recent activity</h2></div>
                <Link href="/app/homeowner/chat">View all</Link>
              </div>
              <div className="dash-rail-list">
                {recentActivity.length > 0 ? recentActivity.map((activity) => (
                  <div className="dash-rail-item" key={activity.key}>
                    <span className="dash-activity-avatar">{activity.initials}</span>
                    <div><strong>{activity.who}</strong><p>{activity.description}</p><time>{activity.when}</time></div>
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
              <span className="bb-eyebrow">Quick actions</span><h2>What do you need?</h2>
              <div className="dash-quick-links">
                <Link href="/app/homeowner/request"><Icon name="plus" size={16} /> New request</Link>
                <Link href="/app/homeowner/bids"><Icon name="bids" size={16} /> Review bids</Link>
                <Link href="/app/homeowner/chat"><Icon name="sparkle" size={16} /> Ask BidBundle AI</Link>
              </div>
            </section>
          </aside>
        </div>
      </div>

      <Link href="/app/homeowner/request" className="dash-floating-action" aria-label="Create a new request">
        <Icon name="plus" size={24} />
      </Link>
      <nav className="dash-mobile-bottom-nav" aria-label="Mobile navigation">
        <Link href="/app/homeowner/dashboard"><Icon name="home" size={20} /><span>Home</span></Link>
        <Link className={pathname === "/app/homeowner/request" ? "is-active" : ""} href="/app/homeowner/request"><Icon name="clipboard" size={20} /><span>Requests</span></Link>
        <Link href="/app/homeowner/request" className="dash-mobile-create" aria-label="New request"><Icon name="plus" size={22} /></Link>
        <Link className={pathname === "/app/homeowner/bids" ? "is-active" : ""} href="/app/homeowner/bids"><Icon name="bids" size={20} /><span>Bids</span></Link>
        <Link className={pathname === "/app/homeowner/chat" ? "is-active" : ""} href="/app/homeowner/chat"><Icon name="chat" size={20} /><span>Activity</span></Link>
      </nav>
    </div>
  );
}
