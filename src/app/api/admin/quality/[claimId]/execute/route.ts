import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminOwnerMutation } from "@/lib/server/admin-api";
import { readHoaBody, hoaErrorResponse, validationErrorResponse } from "@/lib/server/hoa-api";
import { fieldErrors } from "@/lib/validation/profile";
import { executeQualityRefund, scheduleQualityRedo } from "@/lib/server/service-quality-resolution";
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("refund"), operationId: z.string().uuid(), amountCents: z.number().int().positive(), note: z.string().trim().min(10).max(2000) }).strict(),
  z.object({ action: z.literal("redo"), serviceDate: z.string().datetime(), note: z.string().trim().min(10).max(2000) }).strict(),
]);
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ claimId: string }> }) {
  const gate = await requireAdminOwnerMutation(); if (!gate.ok) return gate.response;
  const body = await readHoaBody(request); if (!body.ok) return body.response;
  const parsed = schema.safeParse(body.value); if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));
  try {
    const claimId = (await context.params).claimId;
    return NextResponse.json(parsed.data.action === "refund" ? await executeQualityRefund(gate.user.id, claimId, parsed.data) : await scheduleQualityRedo(gate.user.id, claimId, new Date(parsed.data.serviceDate), parsed.data.note), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return hoaErrorResponse("quality execution", error); }
}
