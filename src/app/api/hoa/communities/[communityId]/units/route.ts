import { NextResponse } from "next/server";

import { requireManagedHoa } from "@/lib/server/hoa";
import {
  hoaErrorResponse,
  readHoaBody,
  requireHoaMutation,
  requireHoaUser,
  validationErrorResponse,
} from "@/lib/server/hoa-api";
import { createUnit, listUnits } from "@/lib/server/hoa-units";
import { unitCreateSchema } from "@/lib/validation/hoa";
import { fieldErrors } from "@/lib/validation/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ communityId: string }> };

export async function GET(_request: Request, context: RouteContext): Promise<NextResponse> {
  const gate = await requireHoaUser();
  if (!gate.ok) return gate.response;
  const { communityId } = await context.params;

  try {
    await requireManagedHoa(gate.user.id, communityId);
    return NextResponse.json({ units: await listUnits(communityId) });
  } catch (error) {
    return hoaErrorResponse("unit list", error);
  }
}

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const gate = await requireHoaMutation();
  if (!gate.ok) return gate.response;
  const body = await readHoaBody(request);
  if (!body.ok) return body.response;
  const parsed = unitCreateSchema.safeParse(body.value);
  if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));
  const { communityId } = await context.params;

  try {
    await requireManagedHoa(gate.user.id, communityId);
    const unit = await createUnit(gate.user.id, communityId, parsed.data);
    return NextResponse.json({ unit }, { status: 201 });
  } catch (error) {
    return hoaErrorResponse("unit creation", error);
  }
}
