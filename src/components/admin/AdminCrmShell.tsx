"use client";

import { UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState, type ReactNode } from "react";

import { Icon, type IconName } from "@/components/ui/Icon";

type AdminCrmShellProps = Readonly<{
  children: ReactNode;
  userName: string | null;
  userEmail: string;
  accessLevel: "owner" | "admin" | null;
}>;

type NavItem = {
  label: string;
  href: string;
  icon: IconName;
  match: (pathname: string, search: string) => boolean;
  ownerOnly?: boolean;
};

const workspaceItems: NavItem[] = [
  {
    label: "Overview",
    href: "/app/admin/dashboard",
    icon: "home",
    match: (pathname) => pathname === "/app/admin/dashboard",
  },
  {
    label: "HOA accounts",
    href: "/app/admin/communities?type=hoa",
    icon: "house",
    match: (pathname, search) => pathname.startsWith("/app/admin/communities") && !search.includes("type=neighborhood"),
  },
  {
    label: "Neighborhoods",
    href: "/app/admin/communities?type=neighborhood",
    icon: "map-pin",
    match: (pathname, search) => pathname.startsWith("/app/admin/communities") && search.includes("type=neighborhood"),
  },
  {
    label: "Service providers",
    href: "/app/admin/providers",
    icon: "tools",
    match: (pathname) => pathname.startsWith("/app/admin/providers"),
  },
];

const governanceItems: NavItem[] = [
  {
    label: "Audit trail",
    href: "/app/admin/audit",
    icon: "clipboard",
    match: (pathname) => pathname.startsWith("/app/admin/audit"),
  },
  {
    label: "Admin access",
    href: "/app/admin/access",
    icon: "shield",
    match: (pathname) => pathname.startsWith("/app/admin/access"),
    ownerOnly: true,
  },
];

function NavGroup({
  title,
  items,
  pathname,
  search,
  accessLevel,
  onNavigate,
}: Readonly<{
  title: string;
  items: NavItem[];
  pathname: string;
  search: string;
  accessLevel: "owner" | "admin" | null;
  onNavigate?: () => void;
}>) {
  return (
    <div>
      <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
        {title}
      </p>
      <nav className="space-y-1" aria-label={title}>
        {items.map((item) => {
          if (item.ownerOnly && accessLevel !== "owner") return null;
          const active = item.match(pathname, search);
          return (
            <Link
              key={item.label}
              href={item.href}
              onClick={onNavigate}
              className={`group flex h-11 items-center gap-3 rounded-lg px-3 text-[13px] font-semibold transition-colors ${
                active
                  ? "bg-emerald-500/14 text-emerald-300 ring-1 ring-inset ring-emerald-400/20"
                  : "text-slate-300 hover:bg-white/[0.06] hover:text-white"
              }`}
            >
              <Icon name={item.icon} size={18} className={active ? "text-emerald-400" : "text-slate-500 group-hover:text-slate-300"} />
              <span>{item.label}</span>
              {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-emerald-400" />}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

function SidebarContent(props: Readonly<AdminCrmShellProps & { pathname: string; search: string; onNavigate?: () => void }>) {
  const displayName = props.userName?.trim() || props.userEmail.split("@")[0];
  return (
    <div className="flex h-full flex-col bg-[#0b1728] px-4 py-5 text-white">
      <Link href="/app/admin/dashboard" onClick={props.onNavigate} className="flex items-center gap-3 px-2">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-emerald-400 to-teal-600 text-white shadow-lg shadow-emerald-950/30">
          <Icon name="logo-mark" size={25} />
        </span>
        <span>
          <span className="block text-[17px] font-extrabold tracking-[-0.02em]">Bundleen</span>
          <span className="block text-[9px] font-bold uppercase tracking-[0.2em] text-emerald-400">Operations CRM</span>
        </span>
      </Link>

      <div className="mt-8 rounded-xl border border-white/[0.08] bg-white/[0.04] p-3">
        <div className="flex items-center gap-2 text-[11px] font-semibold text-slate-300">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-50" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
          </span>
          Live operations
        </div>
        <p className="mt-1 text-[10px] leading-4 text-slate-500">Customer, provider, and service data</p>
      </div>

      <div className="mt-7 space-y-7">
        <NavGroup title="Customer operations" items={workspaceItems} {...props} />
        <NavGroup title="Governance" items={governanceItems} {...props} />
      </div>

      <div className="mt-auto border-t border-white/[0.08] pt-4">
        <Link
          href="/app/admin/profile"
          onClick={props.onNavigate}
          className={`flex items-center gap-3 rounded-lg p-2 transition-colors hover:bg-white/[0.06] ${
            props.pathname.startsWith("/app/admin/profile") ? "bg-white/[0.06]" : ""
          }`}
        >
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-slate-700 text-[12px] font-bold text-white">
            {displayName
              .split(/\s+/)
              .slice(0, 2)
              .map((part) => part[0]?.toUpperCase())
              .join("")}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[12px] font-semibold text-slate-200">{displayName}</span>
            <span className="block truncate text-[10px] capitalize text-slate-500">{props.accessLevel || "admin"} account</span>
          </span>
          <Icon name="chevron-right" size={14} className="ml-auto text-slate-600" />
        </Link>
      </div>
    </div>
  );
}

function pageContext(pathname: string) {
  if (pathname.startsWith("/app/admin/communities")) return { section: "Customers", title: "Community accounts" };
  if (pathname.startsWith("/app/admin/providers")) return { section: "Network", title: "Service providers" };
  if (pathname.startsWith("/app/admin/audit")) return { section: "Governance", title: "Audit trail" };
  if (pathname.startsWith("/app/admin/access")) return { section: "Governance", title: "Admin access" };
  if (pathname.startsWith("/app/admin/profile")) return { section: "Account", title: "Your profile" };
  return { section: "Workspace", title: "Operations overview" };
}

export function AdminCrmShell(props: AdminCrmShellProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [mobileOpen, setMobileOpen] = useState(false);
  const search = searchParams.toString();
  const context = pageContext(pathname);

  return (
    <div className="min-h-screen bg-[#f3f5f8] text-slate-900">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[258px] lg:block">
        <SidebarContent {...props} pathname={pathname} search={search} />
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button aria-label="Close navigation" className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <aside className="relative h-full w-[286px] max-w-[86vw] shadow-2xl">
            <SidebarContent {...props} pathname={pathname} search={search} onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <div className="lg:pl-[258px]">
        <header className="sticky top-0 z-30 flex h-16 items-center border-b border-slate-200 bg-white/95 px-4 backdrop-blur md:px-6 xl:px-8">
          <button
            type="button"
            aria-label="Open navigation"
            onClick={() => setMobileOpen(true)}
            className="mr-3 grid h-9 w-9 place-items-center rounded-lg border border-slate-200 text-slate-600 lg:hidden"
          >
            <Icon name="more-grid" size={18} />
          </button>
          <div className="min-w-0">
            <p className="hidden text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400 sm:block">{context.section}</p>
            <p className="truncate text-[14px] font-bold text-slate-800">{context.title}</p>
          </div>

          <form action="/app/admin/communities" className="mx-auto hidden w-full max-w-md px-8 md:block">
            <label className="flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 text-slate-400 transition focus-within:border-emerald-500 focus-within:bg-white focus-within:ring-2 focus-within:ring-emerald-100">
              <Icon name="search" size={15} />
              <input
                name="search"
                type="search"
                placeholder="Search accounts, managers, or locations"
                className="min-w-0 flex-1 bg-transparent text-[12px] text-slate-800 outline-none placeholder:text-slate-400"
              />
              <span className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[9px] font-semibold text-slate-400">CRM</span>
            </label>
          </form>

          <div className="ml-auto flex items-center gap-2">
            <Link
              href="/app/admin/communities#new-account"
              className="hidden h-9 items-center gap-2 rounded-lg bg-emerald-600 px-3.5 text-[12px] font-bold text-white shadow-sm transition hover:bg-emerald-700 sm:inline-flex"
            >
              <Icon name="plus" size={15} />
              New HOA account
            </Link>
            <span className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 bg-white text-slate-600">
              <Icon name="bell" size={17} />
            </span>
            <UserButton appearance={{ elements: { avatarBox: "h-9 w-9 rounded-lg" } }} />
          </div>
        </header>

        <main className="min-h-[calc(100vh-4rem)]">{props.children}</main>
      </div>
    </div>
  );
}
