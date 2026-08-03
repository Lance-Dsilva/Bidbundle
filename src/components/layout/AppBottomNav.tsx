"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { MobileSheet } from "@/components/layout/MobileSheet";
import { CreativeIcon, type CreativeIconName } from "@/components/ui/CreativeIcon";
import { Icon, type IconName } from "@/components/ui/Icon";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { getRole, type UserRole } from "@/utils/onboardingState";

export interface TabDefinition {
  href: string;
  icon: CreativeIconName | IconName;
  legacyIcon?: boolean;
  label: string;
  badge?: number;
}

export const tabsByRole: Record<UserRole, TabDefinition[]> = {
  homeowner: [
    { href: "/app/homeowner/dashboard", icon: "home", label: "Home" },
    { href: "/app/homeowner/chat", icon: "chat", label: "Chat" },
    { href: "/app/homeowner/bids", icon: "bids", label: "Bids" },
    { href: "/app/homeowner/profile", icon: "profile", label: "Profile" },
  ],
  provider: [
    { href: "/app/provider/dashboard", icon: "home", label: "Home" },
    { href: "/app/provider/job-feed", icon: "search", label: "Job Feed" },
    { href: "/app/provider/bids", icon: "bids", label: "My Bids" },
    { href: "/app/provider/schedule", icon: "calendar", legacyIcon: true, label: "Schedule" },
    { href: "/app/provider/messages", icon: "chat", label: "Messages" },
    { href: "/app/provider/reviews", icon: "tag", label: "Reviews" },
    { href: "/app/provider/earnings", icon: "piggy-bank", label: "Earnings" },
    { href: "/app/provider/profile", icon: "profile", label: "Profile" },
  ],
  admin: [
    { href: "/app/admin/dashboard", icon: "home", label: "Home" },
    { href: "/app/admin/community", icon: "neighbors", label: "Community" },
    { href: "/app/admin/reports", icon: "clipboard", label: "Reports" },
    { href: "/app/admin/profile", icon: "profile", label: "Profile" },
  ],
};

export function TabIcon({ tab, size = 20 }: { tab: TabDefinition; size?: number }) {
  return tab.legacyIcon ? (
    <Icon name={tab.icon as IconName} size={size} />
  ) : (
    <CreativeIcon name={tab.icon as CreativeIconName} size={size} />
  );
}

export function roleFromPathname(pathname: string): UserRole | null {
  if (pathname.startsWith("/app/provider")) return "provider";
  if (pathname.startsWith("/app/admin")) return "admin";
  if (pathname.startsWith("/app/homeowner")) return "homeowner";
  return null;
}

export function useAppRole(): UserRole {
  const pathname = usePathname();
  const [role, setRole] = useState<UserRole>("homeowner");

  useEffect(() => {
    const storedRole = getRole();
    const routeRole = roleFromPathname(pathname);
    setRole(routeRole ?? storedRole ?? "homeowner");
  }, [pathname]);

  return role;
}

export function isTabActive(tab: TabDefinition, pathname: string) {
  return tab.href === "/app/provider/dashboard"
    ? pathname === "/app/provider" || pathname === "/app/provider/dashboard"
    : pathname.startsWith(tab.href);
}

export function AppBottomNav() {
  const pathname = usePathname();
  const role = useAppRole();
  const tabs = tabsByRole[role];

  if (pathname === "/app/homeowner/dashboard") return null;

  return <MobileTabBar tabs={tabs} pathname={pathname} />;
}

const MAX_MOBILE_TABS = 4;

function MobileTabBar({ tabs, pathname }: { tabs: TabDefinition[]; pathname: string }) {
  const [moreOpen, setMoreOpen] = useState(false);

  const needsMore = tabs.length > MAX_MOBILE_TABS;
  const primary = needsMore ? tabs.slice(0, MAX_MOBILE_TABS - 1) : tabs;
  const overflow = needsMore ? tabs.slice(MAX_MOBILE_TABS - 1) : [];

  const overflowActive = overflow.some((tab) => isTabActive(tab, pathname));

  return (
    <>
      <nav aria-label="Application navigation" className="bb-bottom-nav">
        {primary.map((tab) => (
          <Link key={tab.href} href={tab.href} className={`bb-nav-item${isTabActive(tab, pathname) ? " active" : ""}`}>
            <TabIcon tab={tab} />
            <span>{tab.label}</span>
          </Link>
        ))}
        {needsMore ? (
          <button
            onClick={() => setMoreOpen(true)}
            aria-label="More navigation options"
            className={`bb-nav-item${overflowActive ? " active" : ""}`}
          >
            <CreativeIcon name="more" size={20} />
            <span>More</span>
          </button>
        ) : null}
      </nav>

      <MobileSheet open={moreOpen} onClose={() => setMoreOpen(false)} title="More">
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
          <ThemeToggle compact />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {overflow.map((tab) => {
            const active = isTabActive(tab, pathname);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                onClick={() => setMoreOpen(false)}
                className="flex items-center tap-target"
                style={{
                  gap: 14,
                  padding: "12px 10px",
                  borderRadius: 12,
                  background: active ? "var(--teal-50)" : "transparent",
                  color: active ? "var(--teal-800)" : "var(--ink-700)",
                  fontSize: 15,
                  fontWeight: 600,
                }}
              >
                <TabIcon tab={tab} />
                <span style={{ flex: 1 }}>{tab.label}</span>
              </Link>
            );
          })}
        </div>
      </MobileSheet>
    </>
  );
}
