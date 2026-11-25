import { NextResponse } from "next/server";
import { vendorHandler, readVendorBody } from "@/lib/server/vendor-api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { requireAdminMutation } from "@/lib/server/admin-api";
import { upsertVendorLead } from "@/lib/server/vendor-sourcing";
import { vendorLeadSchema } from "@/lib/validation/vendor-sourcing";
type Context = { params: Promise<{ leadId: string }> };
export const PATCH = vendorHandler("vendor lead update", async (request: Request, context: Context) => {
  const gate = await requireAdminMutation(); if (!gate.ok) return gate.response;
  const body = await readVendorBody(request, vendorLeadSchema); if (!body.ok) return body.response;
  const { leadId } = await context.params;
  return NextResponse.json(await upsertVendorLead(gate.user.id, body.value, leadId));
});
