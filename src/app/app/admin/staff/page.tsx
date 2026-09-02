import { BundleenStaffManager } from "@/components/admin/BundleenStaffManager";
import { SectionCard } from "@/components/admin/AdminPrimitives";
import { AppPageHeader } from "@/components/layout/AppPageHeader";
import { hasAdminPermission } from "@/lib/admin-permissions";
import { listAdminAccess } from "@/lib/server/admin-access";
import { requireRole } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export default async function BundleenStaffPage() {
  const user = await requireRole(["admin"], "/app/admin/staff");
  const canManage = hasAdminPermission(
    { level: user.adminAccessLevel, permissions: user.adminPermissions },
    "staff:manage",
  );

  if (!canManage) {
    return (
      <div className="mx-auto max-w-xl px-4 py-10">
        <SectionCard title="Staff management permission required" subtitle="This page does not grant administrator access.">
          <p className="text-[13px]" style={{ color: "var(--muted)" }}>Ask the Bundleen primary owner to grant the Manage Bundleen staff permission.</p>
        </SectionCard>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <AppPageHeader title="Bundleen staff" subtitle="Invite and manage ordinary operations staff" />
      <div className="mx-auto w-full max-w-4xl px-4 py-7 pb-24">
        <SectionCard title="Operations team" subtitle="Standard portal access without authority to create administrators or grant permissions.">
          <BundleenStaffManager initialStaff={await listAdminAccess({ isStaffAccount: true })} />
        </SectionCard>
      </div>
    </div>
  );
}
