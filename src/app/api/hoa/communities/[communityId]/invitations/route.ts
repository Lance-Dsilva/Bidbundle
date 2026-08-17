import { NextResponse } from "next/server";

import {
  hoaErrorResponse,
  readHoaBody,
  requireHoaMutation,
  validationErrorResponse,
} from "@/lib/server/hoa-api";
import { inviteHoaResident } from "@/lib/server/hoa";
import { fieldErrors } from "@/lib/validation/profile";
import { hoaResidentInvitationCreateSchema } from "@/lib/validation/hoa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ communityId: string }> };

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const gate = await requireHoaMutation();
  if (!gate.ok) return gate.response;
  const body = await readHoaBody(request);
  if (!body.ok) return body.response;
  const parsed = hoaResidentInvitationCreateSchema.safeParse(body.value);
  if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));
  const { communityId } = await context.params;

  try {
    const invitation = await inviteHoaResident({
      actorUserId: gate.user.id,
      actorEmail: gate.user.email,
      communityId,
      email: parsed.data.email,
      unitId: parsed.data.unitId,
      requestUrl: request.url,
    });
    return NextResponse.json({ invitation }, { status: 201 });
  } catch (error) {
    return hoaErrorResponse("resident invitation", error);
  }
}
