import { NextResponse } from "next/server";

import {
  hoaErrorResponse,
  readHoaBody,
  requireProviderMutation,
  validationErrorResponse,
} from "@/lib/server/hoa-api";
import { upsertServiceArea } from "@/lib/server/hoa-market";
import { serviceAreaSchema } from "@/lib/validation/hoa";
import { fieldErrors } from "@/lib/validation/profile";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  const gate = await requireProviderMutation();
  if (!gate.ok) return gate.response;
  const body = await readHoaBody(request);
  if (!body.ok) return body.response;
  const parsed = serviceAreaSchema.safeParse(body.value);
  if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));

  try {
    const area = await upsertServiceArea(gate.user.id, parsed.data);
    return NextResponse.json({ area }, { status: 201 });
  } catch (error) {
    return hoaErrorResponse("service area", error);
  }
}
