import { NextResponse } from "next/server";

import {
  readSupportBody,
  requireSupportMutation,
  requireSupportUser,
  supportErrorResponse,
  validationErrorResponse,
} from "@/lib/server/support-api";
import { createSupportTicket, listTicketsForRequester } from "@/lib/server/support";
import { fieldErrors } from "@/lib/validation/profile";
import { createTicketSchema } from "@/lib/validation/support";

/**
 * The customer support centre.
 *
 * Every read is scoped to the caller's own tickets (plus the tickets of
 * communities they actively manage) inside `lib/server/support.ts`. There is no
 * query parameter here that can widen that.
 */
export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  const gate = await requireSupportUser();
  if (!gate.ok) return gate.response;

  try {
    return NextResponse.json({ tickets: await listTicketsForRequester(gate.user.id) });
  } catch (error) {
    return supportErrorResponse("ticket list", error);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const gate = await requireSupportMutation();
  if (!gate.ok) return gate.response;

  const body = await readSupportBody(request);
  if (!body.ok) return body.response;

  const parsed = createTicketSchema.safeParse(body.value);
  if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));

  try {
    // Identity comes from the verified session, never from the body.
    const ticket = await createSupportTicket(
      {
        id: gate.user.id,
        role: gate.user.role,
        email: gate.user.email,
        name: gate.user.name,
      },
      parsed.data,
    );
    return NextResponse.json({ ticket }, { status: 201 });
  } catch (error) {
    return supportErrorResponse("ticket create", error);
  }
}
