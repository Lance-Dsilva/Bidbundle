import { z } from "zod";
import { hoaErrorResponse, readHoaBody, requireHoaMutation, validationErrorResponse } from "@/lib/server/hoa-api";
import { startStripeTestCardSetup, verifyStripeTestCardSetup } from "@/lib/server/stripe-test-card";
import { fieldErrors } from "@/lib/validation/profile";

export const runtime = "nodejs";

const schema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("start"), attemptId: z.uuid() }),
  z.strictObject({ action: z.literal("verify"), setupIntentId: z.string().max(128).regex(/^seti_[A-Za-z0-9]+$/) }),
]);

export async function POST(request: Request, context: { params: Promise<{ agreementId: string }> }) {
  const gate = await requireHoaMutation();
  if (!gate.ok) return gate.response;
  const body = await readHoaBody(request);
  if (!body.ok) return body.response;
  const parsed = schema.safeParse(body.value);
  if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));
  const { agreementId } = await context.params;

  try {
    const result = parsed.data.action === "start"
      ? await startStripeTestCardSetup(gate.user.id, agreementId, parsed.data.attemptId)
      : await verifyStripeTestCardSetup(gate.user.id, agreementId, parsed.data.setupIntentId);
    return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return hoaErrorResponse("Stripe sandbox card setup", error);
  }
}
