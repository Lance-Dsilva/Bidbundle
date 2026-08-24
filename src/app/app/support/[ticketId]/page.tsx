import { redirect } from "next/navigation";

import { SupportThread } from "@/components/support/SupportThread";
import { requireUser } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ ticketId: string }> };

/**
 * One customer support thread.
 *
 * The ticket itself is fetched client-side from `/api/support/tickets/[id]`,
 * which answers 404 for a ticket that is not the caller's — so a guessed id
 * reveals nothing, including whether it exists.
 */
export default async function SupportTicketPage({ params }: PageProps) {
  const user = await requireUser("/app/support");
  if (user.role === "admin") redirect("/app/admin/support");

  const { ticketId } = await params;

  return (
    <div className="px-4 py-6 sm:px-6">
      <SupportThread ticketId={ticketId} />
    </div>
  );
}
