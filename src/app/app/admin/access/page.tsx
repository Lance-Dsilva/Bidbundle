import { AdminAccessManager } from "@/components/admin/AdminAccessManager";
import { SectionCard } from "@/components/admin/AdminPrimitives";
import { AppPageHeader } from "@/components/layout/AppPageHeader";
import { listAdminAccess } from "@/lib/server/admin-access";
import { requireRole } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export default async function AdminAccessPage() {
  const user = await requireRole(["admin"], "/app/admin/access");

  if (user.adminAccessLevel !== "owner") {
    return (
      <div className="mx-auto max-w-xl px-4 py-10">
        <SectionCard title="Primary owner only" subtitle="Shared administrators cannot grant or revoke portal access.">
          <p className="text-[13px]" style={{ color: "var(--muted)" }}>
            Contact the Bundleen primary owner if another staff member needs access.
          </p>
        </SectionCard>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <AppPageHeader title="Admin access" subtitle="Primary-owner controlled · database backed · fully auditable" />
      <div className="mx-auto w-full max-w-3xl px-4 py-7 pb-24">
        <SectionCard title="Portal access" subtitle="Grant or remove access for an existing verified Bundleen account.">
          <AdminAccessManager initialAccess={await listAdminAccess()} />
        </SectionCard>
      </div>
    </div>
  );
}

