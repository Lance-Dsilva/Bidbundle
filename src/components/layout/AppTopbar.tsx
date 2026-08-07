"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { isTabActive, tabsByRole, useAppRole } from "@/components/layout/AppBottomNav";
import { CreativeIcon } from "@/components/ui/CreativeIcon";
import { useAuth } from "@/hooks/useAuth";

function initials(name?: string | null): string {
  if (!name) return "NB";
  return name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function AppTopbar() {
  const { user } = useAuth();
  const pathname = usePathname();
  const role = useAppRole();
  const tabs = tabsByRole[role];

  if (pathname === "/app/homeowner/dashboard") return null;

  return (
    <header className="bb-topbar">
      <div className="bb-container" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20 }}>
        <Link href={`/app/${role}/dashboard`} className="bb-brand" aria-label="Bundleen home">
          <img src="/creative/icons/logo-house.svg" alt="" width={38} height={38} />
          <span>Bundleen</span>
        </Link>

        <nav className="bb-nav-links" aria-label="Application navigation">
          {tabs.map((tab) => (
            <Link key={tab.href} href={tab.href} className={isTabActive(tab, pathname) ? "active" : ""}>
              {tab.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center" style={{ gap: 12 }}>
          <button className="bb-icon-btn" aria-label="Notifications" type="button">
            <CreativeIcon name="bell" size={20} />
          </button>
          <div className="bb-avatar" aria-label="Profile">
            {initials(user?.full_name)}
          </div>
        </div>
      </div>
    </header>
  );
}
