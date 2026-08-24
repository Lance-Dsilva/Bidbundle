import { NextResponse } from "next/server";

import { getTicketForRequester } from "@/lib/server/support";
import { requireSupportUser, supportErrorResponse } from "@/lib/server/support-api";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ ticketId: string }> };

export async function GET(_request: Request, context: RouteContext): Promise<NextResponse> {
  const gate = await requireSupportUser();
  if (!gate.ok) return gate.response;
  const { ticketId } = await context.params;

  try {
    const ticket = await getTicketForRequester(gate.user.id, ticketId);
    // Same answer for "does not exist" and "not yours": a 404 must not confirm
    // that someone else's ticket id is real.
    if (!ticket) {
      return NextResponse.json({ error: "That ticket does not exist." }, { status: 404 });
    }
    return NextResponse.json({ ticket });
  } catch (error) {
    return supportErrorResponse("ticket read", error);
  }
}
