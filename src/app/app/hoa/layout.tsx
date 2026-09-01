import type { ReactNode } from "react";

import { HoaManagerShell } from "@/components/hoa/HoaManagerShell";
import { requireHoaManager } from "@/lib/server/auth";
import { getHoaStaffRole } from "@/lib/server/hoa";

export default async function HoaLayout({ children }: Readonly<{ children: ReactNode }>) {
  const user = await requireHoaManager();
  const staffRole = await getHoaStaffRole(user.id);
  return (
    <HoaManagerShell
      userName={user.name ?? "HOA staff"}
      roleLabel={staffRole === "hoa_team" ? "HOA team" : "HOA manager"}
    >
      {children}
    </HoaManagerShell>
  );
}
