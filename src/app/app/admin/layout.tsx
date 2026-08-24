import type { ReactNode } from "react";

import { AdminCrmShell } from "@/components/admin/AdminCrmShell";
import { requireRole } from "@/lib/server/auth";
import { getSupportQueueStats } from "@/lib/server/support";

/**
 * Server-side gate for `/app/admin/**`.
 *
 * The admin role cannot be obtained through public registration — see
 * `PUBLIC_ROLES` in `@/lib/validation/auth` — so reaching this layout requires
 * an account provisioned deliberately.
 */
export default async function AdminLayout({ children }: Readonly<{ children: ReactNode }>) {
  const user = await requireRole(["admin"], "/app/admin/dashboard");

  // The nav badge is a small count, not a page of data, so it is read here
  // once per navigation rather than polled from the client. A failure must not
  // take the whole portal down with it.
  const stats = await getSupportQueueStats().catch(() => null);

  return (
    <AdminCrmShell
      userName={user.name}
      userEmail={user.email}
      accessLevel={user.adminAccessLevel}
      permissions={user.adminPermissions}
      openTicketCount={stats?.awaitingReply ?? 0}
    >
      {children}
    </AdminCrmShell>
  );
}
