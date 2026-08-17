import { NextResponse } from "next/server";

import { requireManagedHoa } from "@/lib/server/hoa";
import {
  hoaErrorResponse,
  readHoaBody,
  requireHoaMutation,
  validationErrorResponse,
} from "@/lib/server/hoa-api";
import { updateUnit } from "@/lib/server/hoa-units";
import { unitUpdateSchema } from "@/lib/validation/hoa";
import { fieldErrors } from "@/lib/validation/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ communityId: string; unitId: string }> };

export async function PATCH(request: Request, context: RouteContext): Promise<NextResponse> {
  const gate = await requireHoaMutation();
  if (!gate.ok) return gate.response;
  const body = await readHoaBody(request);
  if (!body.ok) return body.response;
  const parsed = unitUpdateSchema.safeParse(body.value);
  if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));
  const { communityId, unitId } = await context.params;

  try {
    await requireManagedHoa(gate.user.id, communityId);
    const unit = await updateUnit(gate.user.id, communityId, unitId, parsed.data);
    return NextResponse.json({ unit });
  } catch (error) {
    return hoaErrorResponse("unit update", error);
  }
}
