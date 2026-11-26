import { z } from "zod";
import { requireAdminOwnerMutation, readAdminBody, validationErrorResponse } from "@/lib/server/admin-api";
import { fieldErrors } from "@/lib/validation/profile";
import { HoaWorkflowError } from "@/lib/server/hoa";
import { requestStripeTestRefund, retryStripeTestRefund } from "@/lib/server/stripe-test-refunds";
import { db } from "@/lib/server/db";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const schema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("request"), id: z.uuid(), amountCents: z.number().int().positive().max(2147483647), reason: z.enum(["service_quality", "duplicate", "requested_by_customer"]), confirmed: z.literal(true) }),
  z.strictObject({ action: z.literal("retry"), id: z.uuid() }),
]);
export async function POST(request: Request, context: { params: Promise<{ visitId: string }> }) {
  const gate = await requireAdminOwnerMutation(); if (!gate.ok) return gate.response;
  const body = await readAdminBody(request); if (!body.ok) return body.response;
  const parsed = schema.safeParse(body.value); if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));
  const { visitId } = await context.params;
  try {
    const input = parsed.data;
    if (input.action === "request") await requestStripeTestRefund(gate.user.id, visitId, input);
    let processingError = false;
    try { await retryStripeTestRefund(gate.user.id, visitId, input.id); }
    catch (error) {
      if (error instanceof HoaWorkflowError && [403, 404, 503].includes(error.status)) throw error;
      processingError = true;
    }
    const operation = await db.stripeTestRefund.findFirst({ where: { id: input.id, visitId }, select: { id: true, state: true, amountCents: true, reversalCents: true } });
    if (!operation) throw new HoaWorkflowError("Refund not found.", 404);
    return Response.json({ ...operation, ...(processingError ? { message: "Saved. Refund processing needs retry or reconciliation; do not create another refund." } : {}) },
      { status: processingError || !["succeeded", "failed"].includes(operation.state) ? 202 : 200, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof HoaWorkflowError ? error.message : "Refund is temporarily unavailable. Refresh before retrying." },
      { status: error instanceof HoaWorkflowError ? error.status : 503, headers: { "Cache-Control": "private, no-store" } });
  }
}
