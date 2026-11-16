import { NextResponse } from "next/server";
import { requireProviderMutation, readHoaBody, hoaErrorResponse, validationErrorResponse } from "@/lib/server/hoa-api";
import { fieldErrors } from "@/lib/validation/profile";
import { serviceQualityResponseSchema } from "@/lib/validation/service-quality";
import { respondToQualityClaim } from "@/lib/server/service-quality";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ claimId: string }> }) {
  const gate = await requireProviderMutation(); if (!gate.ok) return gate.response;
  const body = await readHoaBody(request); if (!body.ok) return body.response;
  const parsed = serviceQualityResponseSchema.safeParse(body.value);
  if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));
  try { return NextResponse.json(await respondToQualityClaim(gate.user.id, (await context.params).claimId, parsed.data)); }
  catch (error) { return hoaErrorResponse("quality response", error); }
}
