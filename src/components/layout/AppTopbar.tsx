"use client";

import { UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { isTabActive, tabsByRole, useAppRole } from "@/components/layout/AppBottomNav";
import { roleLine } from "@/components/layout/ViewerIdentity";
import { CreativeIcon } from "@/components/ui/CreativeIcon";
import { useViewerContext } from "@/hooks/useViewerContext";

export function AppTopbar() {
  const pathname = usePathname();
  const role = useAppRole();
  const tabs = tabsByRole[role];
  // Navigation uses the route; the identity label uses the server. Only the
  // second of those is an authorization-adjacent fact, and only it is trusted.
  const { context } = useViewerContext();

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
          {context && (
            <div className="hidden text-right leading-tight sm:block">
              <strong className="block text-[13px]" style={{ color: "var(--ink-900)" }}>
                {context.fullName}
              </strong>
              <span className="block text-[11px]" style={{ color: "var(--muted)" }}>
                {roleLine(context)}
              </span>
            </div>
          )}
          <UserButton
            appearance={{
              elements: { avatarBox: "h-9 w-9" },
            }}
          />
        </div>
      </div>
    </header>
  );
}
