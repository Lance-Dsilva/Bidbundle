import { HoaManagerWorkspace } from "@/components/hoa/HoaManagerWorkspace";
import { requireHoaManager } from "@/lib/server/auth";
import { getHoaManagerDashboard } from "@/lib/server/hoa-market";

export const dynamic = "force-dynamic";

export default async function HoaDashboardPage() {
  const user = await requireHoaManager();
  const dashboard = await getHoaManagerDashboard(user.id);
  return <HoaManagerWorkspace dashboard={dashboard} />;
}
