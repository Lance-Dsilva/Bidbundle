import { z } from "zod";
import { hoaErrorResponse, readHoaBody, requireHoaMutation, validationErrorResponse } from "@/lib/server/hoa-api";
import { HoaWorkflowError } from "@/lib/server/hoa";
import { fieldErrors } from "@/lib/validation/profile";
import { startEnrollmentBilling, confirmEnrollmentBilling } from "@/lib/server/enrollment-billing";
export const runtime = "nodejs";
const schema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("start"), consentId: z.uuid(), accepted: z.literal(true), termsToken: z.string().regex(/^[a-f0-9]{64}$/), savedCardReference: z.string().regex(/^[a-f0-9]{64}$/).optional() }),
  z.strictObject({ action: z.literal("join"), consentId: z.uuid(), setupIntentId: z.string().max(128).regex(/^seti_[A-Za-z0-9]+$/) }),
]);
export async function POST(request: Request, context: { params: Promise<{ requestId: string }> }) {
  const gate = await requireHoaMutation(); if (!gate.ok) return gate.response;
  const body = await readHoaBody(request); if (!body.ok) return body.response;
  const parsed = schema.safeParse(body.value); if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));
  const { requestId } = await context.params;
  try {
    const data = parsed.data;
    const result = data.action === "start" ? await startEnrollmentBilling(gate.user.id, requestId, data.consentId, data.termsToken, data.savedCardReference)
      : await confirmEnrollmentBilling(gate.user.id, requestId, data.consentId, data.setupIntentId);
    return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const response = hoaErrorResponse("Sandbox enrollment", error instanceof HoaWorkflowError ? error : new HoaWorkflowError("Enrollment is temporarily unavailable. Refresh before retrying.", 503));
    response.headers.set("Cache-Control", "private, no-store"); return response;
  }
}
