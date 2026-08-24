import { NextResponse } from "next/server";

import {
  adminErrorResponse,
  requireAdmin,
  requireAdminMutation,
  validationErrorResponse,
} from "@/lib/server/admin-api";
import { readJsonBody } from "@/lib/server/profile";
import { getAdminTicket, updateAdminTicket } from "@/lib/server/support";
import { supportErrorResponse } from "@/lib/server/support-api";
import { fieldErrors } from "@/lib/validation/profile";
import { adminTicketUpdateSchema, MAX_SUPPORT_BODY_BYTES } from "@/lib/validation/support";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ ticketId: string }> };

export async function GET(_request: Request, context: RouteContext): Promise<NextResponse> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;
  const { ticketId } = await context.params;

  try {
    const ticket = await getAdminTicket(gate.user.id, ticketId);
    if (!ticket) {
      return NextResponse.json({ error: "That ticket does not exist." }, { status: 404 });
    }
    return NextResponse.json({ ticket });
  } catch (error) {
    return adminErrorResponse("support ticket read", error);
  }
}

export async function PATCH(request: Request, context: RouteContext): Promise<NextResponse> {
  const gate = await requireAdminMutation();
  if (!gate.ok) return gate.response;

  const body = await readJsonBody(request, MAX_SUPPORT_BODY_BYTES);
  if (!body.ok) return body.response;

  const parsed = adminTicketUpdateSchema.safeParse(body.value);
  if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));

  const { ticketId } = await context.params;

  try {
    const ticket = await updateAdminTicket(
      { id: gate.user.id, name: gate.user.name },
      ticketId,
      parsed.data,
    );
    return NextResponse.json({ ticket });
  } catch (error) {
    return supportErrorResponse("support ticket update", error);
  }
}
