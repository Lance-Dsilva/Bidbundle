import { NextResponse } from "next/server";
import { vendorHandler, readVendorBody } from "@/lib/server/vendor-api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { requireProviderMutation } from "@/lib/server/hoa-api";
import { claimVendorInvitation } from "@/lib/server/vendor-sourcing";
import { emptyMutationSchema } from "@/lib/validation/hoa";
type Context = { params: Promise<{ token: string }> };
export const POST = vendorHandler("vendor proposal claim", async (request: Request, context: Context) => {
  const gate = await requireProviderMutation(); if (!gate.ok) return gate.response;
  const body = await readVendorBody(request, emptyMutationSchema, 1024); if (!body.ok) return body.response;
  const { token } = await context.params;
  const claim = await claimVendorInvitation(gate.user.id, token);
  return NextResponse.json({ ...claim, claimed: true });
});
