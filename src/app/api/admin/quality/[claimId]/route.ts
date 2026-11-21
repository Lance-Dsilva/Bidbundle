import { NextResponse } from "next/server";
import { requireAdminMutation } from "@/lib/server/admin-api";
import { readHoaBody, hoaErrorResponse, validationErrorResponse } from "@/lib/server/hoa-api";
import { fieldErrors } from "@/lib/validation/profile";
import { serviceQualityResolutionSchema } from "@/lib/validation/service-quality";
import { requestQualityResolution } from "@/lib/server/service-quality";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ claimId: string }> }) {
  const gate = await requireAdminMutation(); if (!gate.ok) return gate.response;
  const body = await readHoaBody(request); if (!body.ok) return body.response;
  const parsed = serviceQualityResolutionSchema.safeParse(body.value);
  if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));
  try { return NextResponse.json(await requestQualityResolution(gate.user.id, (await context.params).claimId, parsed.data), { status: 202 }); }
  catch (error) { return hoaErrorResponse("quality resolution", error); }
}
