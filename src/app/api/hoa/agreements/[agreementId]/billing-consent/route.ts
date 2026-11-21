import { NextResponse } from "next/server";
import { z } from "zod";

import { hoaErrorResponse, readHoaBody, requireHoaMutation, requireHoaUser, validationErrorResponse } from "@/lib/server/hoa-api";
import { acceptVisitBillingOffer, getVisitBillingOffer } from "@/lib/server/visit-billing-consent";
import { fieldErrors } from "@/lib/validation/profile";

export const runtime = "nodejs";

const acceptanceSchema = z.strictObject({
  accepted: z.literal(true),
  termsToken: z.string().regex(/^[a-f0-9]{64}$/),
});

type RouteContext = { params: Promise<{ agreementId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const gate = await requireHoaUser();
  if (!gate.ok) return gate.response;
  const { agreementId } = await context.params;
  try {
    const offer = await getVisitBillingOffer(gate.user.id, agreementId);
    return NextResponse.json(offer, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return hoaErrorResponse("visit billing offer", error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const gate = await requireHoaMutation();
  if (!gate.ok) return gate.response;
  const body = await readHoaBody(request);
  if (!body.ok) return body.response;
  const parsed = acceptanceSchema.safeParse(body.value);
  if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));
  const { agreementId } = await context.params;
  try {
    const offer = await acceptVisitBillingOffer(gate.user.id, agreementId, parsed.data.termsToken);
    return NextResponse.json(offer, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return hoaErrorResponse("visit billing consent", error);
  }
}
