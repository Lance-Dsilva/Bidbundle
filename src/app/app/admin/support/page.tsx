import { AdminPageBody, AdminPageHeader } from "@/components/admin/primitives";
import { AdminSupportQueue } from "@/components/admin/support/AdminSupportQueue";

export const dynamic = "force-dynamic";

export const metadata = { title: "Support · Bundleen operations" };

/**
 * The support module's queue. The `/app/admin/**` layout has already required
 * an active admin grant, and every query the client makes is re-authorized in
 * `/api/admin/support/**`.
 */
export default function AdminSupportPage() {
  return (
    <>
      <AdminPageHeader
        eyebrow="Support"
        title="Ticket queue"
        description="Everything homeowners, HOA managers, and providers have asked for help with."
      />
      <AdminPageBody>
        <AdminSupportQueue />
      </AdminPageBody>
    </>
  );
}
