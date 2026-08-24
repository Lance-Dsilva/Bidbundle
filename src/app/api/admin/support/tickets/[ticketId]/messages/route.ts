import { NextResponse } from "next/server";

import {
  requireAdminMutation,
  validationErrorResponse,
} from "@/lib/server/admin-api";
import { readJsonBody } from "@/lib/server/profile";
import { addAdminMessage } from "@/lib/server/support";
import { supportErrorResponse } from "@/lib/server/support-api";
import { fieldErrors } from "@/lib/validation/profile";
import { adminTicketMessageSchema, MAX_SUPPORT_BODY_BYTES } from "@/lib/validation/support";

/**
 * Posts a customer-visible reply or an internal note.
 *
 * `internal: true` never produces a customer notification and never leaves the
 * admin surface — see `customerMessageWhere` in `lib/server/support.ts`.
 */
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ ticketId: string }> };

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const gate = await requireAdminMutation();
  if (!gate.ok) return gate.response;

  const body = await readJsonBody(request, MAX_SUPPORT_BODY_BYTES);
  if (!body.ok) return body.response;

  const parsed = adminTicketMessageSchema.safeParse(body.value);
  if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));

  const { ticketId } = await context.params;

  try {
    const ticket = await addAdminMessage(
      { id: gate.user.id, name: gate.user.name },
      ticketId,
      parsed.data,
    );
    return NextResponse.json({ ticket }, { status: 201 });
  } catch (error) {
    return supportErrorResponse("admin ticket message", error);
  }
}
