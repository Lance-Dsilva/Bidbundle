import { NextResponse } from "next/server";
import { z } from "zod";
import { readHoaBody, validationErrorResponse } from "@/lib/server/hoa-api";
import { privateVisitPhotoHandler } from "@/lib/server/private-visit-photo-response";
import { authorizeRequest } from "@/lib/server/auth";
import { guardHoaMutation, guardFailureResponse } from "@/lib/server/auth-guard";
import { setVisitPhotoMarketingConsent } from "@/lib/server/visit-photos";
import { fieldErrors } from "@/lib/validation/profile";
export const runtime = "nodejs";
const consentSchema = z.object({ consent: z.boolean() }).strict();
type Context = { params: Promise<{ visitId: string; mediaId: string }> };
export const PATCH = privateVisitPhotoHandler("visit photo marketing permission", async (request: Request, context: Context) => {
  const gate = await authorizeRequest(["homeowner", "hoa_staff", "provider", "admin"]); if (!gate.ok) return gate.response;
  const failure = await guardHoaMutation(gate.user.id); if (failure) return guardFailureResponse(failure);
  const body = await readHoaBody(request); if (!body.ok) return body.response;
  const parsed = consentSchema.safeParse(body.value); if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));
  const { visitId, mediaId } = await context.params;
  return NextResponse.json({ photo: await setVisitPhotoMarketingConsent(gate.user.id, visitId, mediaId, parsed.data.consent) });
});
