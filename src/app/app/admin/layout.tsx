import type { ReactNode } from "react";

import { requireRole } from "@/lib/server/auth";

/**
 * Server-side gate for `/app/admin/**`.
 *
 * The admin role cannot be obtained through public registration — see
 * `PUBLIC_ROLES` in `@/lib/validation/auth` — so reaching this layout requires
 * an account provisioned deliberately.
 */
export default async function AdminLayout({ children }: Readonly<{ children: ReactNode }>) {
  await requireRole(["admin"], "/app/admin/dashboard");

  return <>{children}</>;
}
