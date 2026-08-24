import { NextResponse } from "next/server";

import { adminErrorResponse, requireAdmin } from "@/lib/server/admin-api";
import {
  getSupportQueueStats,
  listAdminTickets,
  listAssignableAdmins,
} from "@/lib/server/support";
import { adminTicketQuerySchema } from "@/lib/validation/support";

/**
 * The admin ticket queue. Filtering, sorting, and pagination are all applied in
 * the database rather than in the browser — the queue is expected to grow well
 * past what a single page can hold.
 */
export const runtime = "nodejs";

export async function GET(request: Request): Promise<NextResponse> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const raw = Object.fromEntries(
    // Blank query parameters mean "no filter", not "filter on empty".
    [...url.searchParams.entries()].filter(([, value]) => value.trim() !== ""),
  );
  const parsed = adminTicketQuerySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Unsupported queue filters." }, { status: 400 });
  }

  try {
    const [page, stats, assignees] = await Promise.all([
      listAdminTickets(parsed.data),
      getSupportQueueStats(),
      listAssignableAdmins(),
    ]);
    return NextResponse.json({ ...page, stats, assignees });
  } catch (error) {
    return adminErrorResponse("support queue", error);
  }
}
