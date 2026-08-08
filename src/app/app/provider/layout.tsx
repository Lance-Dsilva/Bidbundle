import type { ReactNode } from "react";

import { ProviderShell } from "@/components/layout/ProviderShell";
import { requireRole } from "@/lib/server/auth";

/** Server-side gate for `/app/provider/**`. See the homeowner layout. */
export default async function ProviderLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const user = await requireRole(["provider"], "/app/provider/dashboard");

  return <ProviderShell userName={user.name ?? ""}>{children}</ProviderShell>;
}
