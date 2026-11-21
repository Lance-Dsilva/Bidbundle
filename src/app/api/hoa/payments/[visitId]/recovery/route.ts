import { z } from "zod";
import { hoaErrorResponse, readHoaBody, requireHoaMutation, validationErrorResponse } from "@/lib/server/hoa-api";
import { fieldErrors } from "@/lib/validation/profile";
import { HoaWorkflowError } from "@/lib/server/hoa";
import { getStripeTestPaymentRecovery, startStripeTestPaymentRecovery, retryStripeTestPayment } from "@/lib/server/stripe-test-payment-recovery";
export const runtime = "nodejs";
const schema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("refresh") }),
  z.strictObject({ action: z.literal("start"), attemptId: z.uuid(), accepted: z.literal(true) }),
  z.strictObject({ action: z.literal("retry"), attemptId: z.uuid(), setupIntentId: z.string().max(128).regex(/^seti_[A-Za-z0-9]+$/), accepted: z.literal(true) }),
]);
export async function POST(request: Request, context: { params: Promise<{ visitId: string }> }) {
  const gate = await requireHoaMutation(); if (!gate.ok) return gate.response;
  const body = await readHoaBody(request); if (!body.ok) return body.response;
  const parsed = schema.safeParse(body.value); if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));
  const { visitId } = await context.params;
  try {
    const data = parsed.data;
    const result = data.action === "refresh" ? await getStripeTestPaymentRecovery(gate.user.id, visitId)
      : data.action === "start" ? await startStripeTestPaymentRecovery(gate.user.id, visitId, data.attemptId)
      : await retryStripeTestPayment(gate.user.id, visitId, data.attemptId, data.setupIntentId);
    return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    // Raw processor errors may contain request/payment details. Do not log or
    // serialize them through the generic API error reporter.
    const response = hoaErrorResponse("Sandbox payment recovery", error instanceof HoaWorkflowError ? error : new HoaWorkflowError("Payment recovery is temporarily unavailable. Please refresh before retrying.", 503));
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
