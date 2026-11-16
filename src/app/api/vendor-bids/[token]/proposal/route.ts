import { NextResponse } from "next/server";
import { vendorHandler, readVendorBody } from "@/lib/server/vendor-api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { requireProviderMutation } from "@/lib/server/hoa-api";
import { submitInvitedProposal } from "@/lib/server/vendor-sourcing";
import { bidSubmitSchema } from "@/lib/validation/hoa";
type Context = { params: Promise<{ token: string }> };
export const PUT = vendorHandler("invited vendor proposal", async (request: Request, context: Context) => {
  const gate = await requireProviderMutation(); if (!gate.ok) return gate.response;
  const body = await readVendorBody(request, bidSubmitSchema); if (!body.ok) return body.response;
  const bid = await submitInvitedProposal(gate.user.id, (await context.params).token, body.value);
  return NextResponse.json({ bid }, { status: 201 });
});
