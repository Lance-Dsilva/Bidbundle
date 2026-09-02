import type { ReactNode } from "react";

import { ProviderShell } from "@/components/layout/ProviderShell";
import { requireRole } from "@/lib/server/auth";
import { getProviderShellIdentity } from "@/lib/server/provider-overview";

/** Server-side gate for `/app/provider/**`. See the homeowner layout. */
export default async function ProviderLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const user = await requireRole(["provider"], "/app/provider/dashboard");
  // The chrome's own two facts — trading name and unread count — read once
  // here rather than by an API call the shell repeats on every route. Page
  // data is loaded by the page that shows it.
  const identity = await getProviderShellIdentity(user.id);

  return (
    <ProviderShell userName={user.name ?? ""} identity={identity}>
      {children}
    </ProviderShell>
  );
}
