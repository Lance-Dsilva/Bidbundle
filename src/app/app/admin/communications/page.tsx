import Link from "next/link";

import { AdminPageBody, AdminPageHeader } from "@/components/admin/primitives";
import { BroadcastWorkspace } from "@/components/admin/communications/BroadcastWorkspace";
import { hasAdminPermission } from "@/lib/admin-permissions";
import { requireRole } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export const metadata = { title: "Communications · Bundleen operations" };

/**
 * The Communications module.
 *
 * Gated twice on purpose: this page refuses to render the composer without the
 * drafting capability, and every endpoint behind it re-checks the same
 * permission — plus the stronger send permission — from the database.
 */
export default async function AdminCommunicationsPage() {
  const user = await requireRole(["admin"], "/app/admin/communications");
  const canDraft = hasAdminPermission(
    { level: user.adminAccessLevel, permissions: user.adminPermissions },
    "communications:draft",
  );

  return (
    <>
      <AdminPageHeader
        eyebrow="Communications"
        title="Operational broadcasts"
        description="Platform-wide messages for outages, degraded service, security notices, and required maintenance."
      />
      <AdminPageBody>
        {canDraft ? (
          <BroadcastWorkspace />
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
            <p className="text-[14px] font-bold text-slate-900">
              You do not have broadcast access
            </p>
            <p className="mx-auto mt-2 max-w-md text-[12px] leading-5 text-slate-500">
              Composing and sending platform-wide messages is a separate permission from portal
              access. Ask the Bundleen owner to grant it from{" "}
              <Link className="font-semibold text-emerald-700 underline" href="/app/admin/access">
                Admin access
              </Link>
              .
            </p>
          </div>
        )}
      </AdminPageBody>
    </>
  );
}
