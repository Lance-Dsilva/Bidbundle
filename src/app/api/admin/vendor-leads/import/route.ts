import { NextResponse } from "next/server";
import { vendorHandler, readVendorBody } from "@/lib/server/vendor-api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { requireAdminMutation } from "@/lib/server/admin-api";
import { importCslbLeads } from "@/lib/server/vendor-sourcing";
import { vendorImportSchema, MAX_VENDOR_BODY_BYTES } from "@/lib/validation/vendor-sourcing";
export const POST = vendorHandler("CSLB vendor import", async (request: Request) => {
  const gate = await requireAdminMutation(); if (!gate.ok) return gate.response;
  const body = await readVendorBody(request, vendorImportSchema, MAX_VENDOR_BODY_BYTES); if (!body.ok) return body.response;
  return NextResponse.json(await importCslbLeads(gate.user.id, body.value));
});
