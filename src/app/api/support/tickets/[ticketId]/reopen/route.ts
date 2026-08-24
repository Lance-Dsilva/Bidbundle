import { NextResponse } from "next/server";

import { reopenTicket } from "@/lib/server/support";
import {
  readSupportBody,
  requireSupportMutation,
  supportErrorResponse,
  validationErrorResponse,
} from "@/lib/server/support-api";
import { fieldErrors } from "@/lib/validation/profile";
import { customerReplySchema } from "@/lib/validation/support";

/**
 * Reopens a recently resolved ticket, or opens a linked follow-up when the
 * reopen window has passed. The service decides which; the customer always
 * ends up in a thread that references the original.
 */
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ ticketId: string }> };

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const gate = await requireSupportMutation();
  if (!gate.ok) return gate.response;

  const body = await readSupportBody(request);
  if (!body.ok) return body.response;

  const parsed = customerReplySchema.safeParse(body.value);
  if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));

  const { ticketId } = await context.params;

  try {
    const ticket = await reopenTicket(
      { id: gate.user.id, role: gate.user.role, email: gate.user.email, name: gate.user.name },
      ticketId,
      parsed.data.message,
    );
    return NextResponse.json({ ticket });
  } catch (error) {
    return supportErrorResponse("ticket reopen", error);
  }
}
