import { NextResponse } from "next/server";

import {
  hoaErrorResponse,
  readHoaBody,
  requireProviderMutation,
  validationErrorResponse,
} from "@/lib/server/hoa-api";
import { submitBid, withdrawBid } from "@/lib/server/hoa-market";
import { bidSubmitSchema } from "@/lib/validation/hoa";
import { fieldErrors } from "@/lib/validation/profile";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ requestId: string }> };

/** Submit or revise the provider's single current bid while bidding is open. */
export async function PUT(request: Request, context: RouteContext): Promise<NextResponse> {
  const gate = await requireProviderMutation();
  if (!gate.ok) return gate.response;
  const body = await readHoaBody(request);
  if (!body.ok) return body.response;
  const parsed = bidSubmitSchema.safeParse(body.value);
  if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));
  const { requestId } = await context.params;

  try {
    const bid = await submitBid(gate.user.id, requestId, parsed.data);
    return NextResponse.json({ bid }, { status: 201 });
  } catch (error) {
    return hoaErrorResponse("bid submission", error);
  }
}

export async function DELETE(_request: Request, context: RouteContext): Promise<NextResponse> {
  const gate = await requireProviderMutation();
  if (!gate.ok) return gate.response;
  const { requestId } = await context.params;

  try {
    await withdrawBid(gate.user.id, requestId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return hoaErrorResponse("bid withdrawal", error);
  }
}
