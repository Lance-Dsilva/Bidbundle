"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

import { AppBottomNav } from "@/components/layout/AppBottomNav";
import { AppTopbar } from "@/components/layout/AppTopbar";

export default function AppLayout({ children }: Readonly<{ children: ReactNode }>) {
  const pathname = usePathname();

  if (pathname.startsWith("/app/homeowner") || pathname.startsWith("/app/provider")) {
    return children;
  }

  return (
    <div className="bb-app-shell">
      <AppTopbar />
      <main className="bb-container">{children}</main>
      <AppBottomNav />
    </div>
  );
}
