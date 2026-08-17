import type { ReactNode } from "react";

import { HoaManagerShell } from "@/components/hoa/HoaManagerShell";
import { requireHoaManager } from "@/lib/server/auth";

export default async function HoaLayout({ children }: Readonly<{ children: ReactNode }>) {
  const user = await requireHoaManager();
  return <HoaManagerShell userName={user.name ?? "HOA manager"}>{children}</HoaManagerShell>;
}
