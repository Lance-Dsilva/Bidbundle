import { NextResponse } from "next/server";
import { vendorHandler, readVendorBody } from "@/lib/server/vendor-api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { requireHoaMutation } from "@/lib/server/hoa-api";
import { addVendorReferral } from "@/lib/server/vendor-sourcing";
import { vendorReferralSchema } from "@/lib/validation/vendor-sourcing";
type Context = { params: Promise<{ requestId: string }> };
export const POST = vendorHandler("vendor referral", async (request: Request, context: Context) => {
  const gate = await requireHoaMutation(); if (!gate.ok) return gate.response;
  const body = await readVendorBody(request, vendorReferralSchema); if (!body.ok) return body.response;
  await addVendorReferral(gate.user.id, (await context.params).requestId, body.value);
  return NextResponse.json({ recorded: true }, { status: 201 });
});
