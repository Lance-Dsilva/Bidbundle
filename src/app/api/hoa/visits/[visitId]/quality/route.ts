import { NextResponse } from "next/server";
import { requireHoaMutation, readHoaBody, hoaErrorResponse, validationErrorResponse } from "@/lib/server/hoa-api";
import { fieldErrors } from "@/lib/validation/profile";
import { serviceQualityReportSchema } from "@/lib/validation/service-quality";
import { reportServiceQuality } from "@/lib/server/service-quality";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ visitId: string }> }) {
  const gate = await requireHoaMutation(); if (!gate.ok) return gate.response;
  if (gate.user.role !== "homeowner") return NextResponse.json({ error: "Resident access is required." }, { status: 403 });
  const body = await readHoaBody(request); if (!body.ok) return body.response;
  const parsed = serviceQualityReportSchema.safeParse(body.value);
  if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));
  try { return NextResponse.json(await reportServiceQuality(gate.user.id, (await context.params).visitId, parsed.data), { status: 201, headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return hoaErrorResponse("quality report", error); }
}
