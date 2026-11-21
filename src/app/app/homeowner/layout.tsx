import Link from "next/link";
import type { ReactNode } from "react";

import { HomeownerShell } from "@/components/layout/HomeownerShell";
import { requireRole } from "@/lib/server/auth";
import { countUnreadMessages } from "@/lib/server/conversations";

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
  // The chrome's one number, read once here rather than by an API call the
  // shell repeats on every route. Page data is loaded by the page that shows it.
  const unreadMessages = await countUnreadMessages(user.id);

  return (
    <HomeownerShell userName={user.name ?? ""} unreadMessages={unreadMessages}>
      {process.env.RECURRING_PLANS === "1" && <div className="px-4 py-2"><Link className="underline" href="/app/recurring-plans">Recurring services</Link></div>}
      {children}
    </HomeownerShell>
  );
}
