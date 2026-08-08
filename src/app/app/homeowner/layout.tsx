import type { ReactNode } from "react";

import { HomeownerShell } from "@/components/layout/HomeownerShell";
import { requireRole } from "@/lib/server/auth";

/**
 * Server-side gate for `/app/homeowner/**`.
 *
 * This is the real check. Middleware may have already turned the request away,
 * but it runs on an unverified optimistic path, so the session is read again
 * here — where it can be trusted — before any homeowner UI is rendered.
 */
export default async function HomeownerLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const user = await requireRole(["homeowner"], "/app/homeowner/dashboard");

  return <HomeownerShell userName={user.name ?? ""}>{children}</HomeownerShell>;
}
