import { notFound } from "next/navigation";

import { AdminPageBody, AdminPageHeader } from "@/components/admin/primitives";
import { AdminTicketWorkspace } from "@/components/admin/support/AdminTicketWorkspace";
import { requireRole } from "@/lib/server/auth";
import { getAdminTicket } from "@/lib/server/support";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ ticketId: string }> };

/**
 * The ticket record.
 *
 * The header is rendered on the server from the real ticket so the page never
 * flashes a placeholder subject; the interactive workspace below re-fetches and
 * owns every mutation.
 */
export default async function AdminTicketPage({ params }: PageProps) {
  const user = await requireRole(["admin"], "/app/admin/support");
  const { ticketId } = await params;

  const ticket = await getAdminTicket(user.id, ticketId);
  if (!ticket) notFound();

  return (
    <>
      <AdminPageHeader
        breadcrumb={{ label: "Ticket queue", href: "/app/admin/support" }}
        eyebrow={ticket.ticketNumber}
        title={ticket.subject}
        description={`Opened by ${ticket.requesterName} · ${ticket.requesterRole}${
          ticket.communityName ? ` · ${ticket.communityName}` : ""
        }`}
      />
      <AdminPageBody>
        <AdminTicketWorkspace ticketId={ticket.id} />
      </AdminPageBody>
    </>
  );
}
