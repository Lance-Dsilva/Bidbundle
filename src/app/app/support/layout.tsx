import type { ReactNode } from "react";

import { HoaManagerShell } from "@/components/hoa/HoaManagerShell";
import { HomeownerShell } from "@/components/layout/HomeownerShell";
import { ProviderShell } from "@/components/layout/ProviderShell";
import { requireUser } from "@/lib/server/auth";
import { countUnreadMessages } from "@/lib/server/conversations";
import { getHoaStaffRole, isHoaManager } from "@/lib/server/hoa";
import { getProviderShellIdentity } from "@/lib/server/provider-overview";

/**
 * `/app/support/**` is the one customer surface shared by every non-admin role,
 * so the layout picks the shell rather than duplicating the page three times.
 *
 * Admins have their own queue at `/app/admin/support` and are sent there —
 * a staff member opening this route wants the workspace, not a customer form.
 */
export default async function SupportLayout({ children }: Readonly<{ children: ReactNode }>) {
  const user = await requireUser("/app/support");
  const name = user.name ?? "";

  if (user.role === "provider") {
    // Same server-resolved chrome facts as `/app/provider/**`, so the sidebar
    // shows the same trading name and unread badge on the support route.
    const identity = await getProviderShellIdentity(user.id);
    return (
      <ProviderShell userName={name} identity={identity}>
        {children}
      </ProviderShell>
    );
  }
  if (user.role === "hoa_staff" || (user.role === "homeowner" && (await isHoaManager(user.id)))) {
    const staffRole = await getHoaStaffRole(user.id);
    return (
      <HoaManagerShell userName={name} roleLabel={staffRole === "hoa_team" ? "HOA team" : "HOA manager"}>
        {children}
      </HoaManagerShell>
    );
  }
  // Same server-resolved chrome facts as `/app/homeowner/**`, so the sidebar
  // shows the same unread badge on the support route.
  return (
    <HomeownerShell userName={name} unreadMessages={await countUnreadMessages(user.id)}>
      {children}
    </HomeownerShell>
  );
}
