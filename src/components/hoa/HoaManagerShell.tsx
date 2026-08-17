"use client";

import { UserButton } from "@clerk/nextjs";
import Link from "next/link";
import type { ReactNode } from "react";

import { Icon } from "@/components/ui/Icon";

export function HoaManagerShell({
  children,
  userName,
}: Readonly<{ children: ReactNode; userName: string }>) {
  return (
    <div className="min-h-screen bg-[#f4f7f6] lg:grid lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="border-b border-[#dce7e4] bg-white px-5 py-5 lg:min-h-screen lg:border-b-0 lg:border-r lg:px-6 lg:py-7">
        <Link className="flex items-center gap-3 text-xl font-bold text-[#102a43]" href="/app/hoa/dashboard">
          <img src="/creative/icons/logo-house.svg" alt="" width={38} height={38} />
          <span>Bundleen HOA</span>
        </Link>
        <nav className="mt-7 flex gap-2 overflow-x-auto lg:flex-col" aria-label="HOA manager navigation">
          <ManagerLink href="/app/hoa/dashboard" icon="home" label="Overview" />
          <ManagerLink href="/app/hoa/dashboard#residents" icon="users" label="Residents" />
          <ManagerLink href="/app/hoa/dashboard#requests" icon="clipboard" label="Service requests" />
          <ManagerLink href="/app/hoa/dashboard#surveys" icon="bids" label="Monthly surveys" />
        </nav>
        <div className="mt-8 hidden rounded-2xl border border-[#dce7e4] bg-[#f1faf7] p-4 lg:block">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#0f8f83]">Manager account</p>
          <p className="mt-2 text-sm font-semibold text-[#102a43]">Invitation-only access</p>
          <p className="mt-1 text-xs leading-5 text-[#64748b]">Your powers are limited to the HOA assigned by Bundleen.</p>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="flex items-center justify-between border-b border-[#dce7e4] bg-white px-5 py-4 lg:px-8">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#0f8f83]">HOA operations</p>
            <p className="mt-0.5 text-sm text-[#64748b]">Residents, requests, and monthly feedback</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <strong className="block text-sm text-[#102a43]">{userName}</strong>
              <span className="text-xs text-[#64748b]">HOA manager</span>
            </div>
            <UserButton appearance={{ elements: { avatarBox: "h-9 w-9" } }} />
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl px-4 py-7 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}

function ManagerLink({ href, icon, label }: { href: string; icon: "home" | "users" | "clipboard" | "bids"; label: string }) {
  return (
    <Link className="flex shrink-0 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-[#334e68] transition hover:bg-[#edf8f5] hover:text-[#0f8f83]" href={href}>
      <Icon name={icon} size={18} />
      <span>{label}</span>
    </Link>
  );
}
