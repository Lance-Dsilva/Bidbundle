import { ProviderHoaWorkspaceView } from "@/components/provider/ProviderHoaWorkspace";
import { requireRole } from "@/lib/server/auth";
import { getProviderHoaWorkspace } from "@/lib/server/hoa-market";

export const dynamic = "force-dynamic";

export default async function ProviderHoaPage() {
  const user = await requireRole(["provider"], "/app/provider/hoa");
  const workspace = await getProviderHoaWorkspace(user.id);

  return <ProviderHoaWorkspaceView workspace={workspace} />;
}
