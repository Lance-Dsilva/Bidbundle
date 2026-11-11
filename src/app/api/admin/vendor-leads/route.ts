import { NextResponse } from "next/server";
import { vendorHandler, readVendorBody } from "@/lib/server/vendor-api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { requireAdmin, requireAdminMutation } from "@/lib/server/admin-api";
import { listVendorLeads, upsertVendorLead } from "@/lib/server/vendor-sourcing";
import { vendorLeadSchema } from "@/lib/validation/vendor-sourcing";
export const GET = vendorHandler("vendor lead list", async (request: Request) => {
  const gate = await requireAdmin(); if (!gate.ok) return gate.response;
  const search = new URL(request.url).searchParams.get("q")?.trim();
  if (search && search.length > 160) return NextResponse.json({ error: "Search is too long." }, { status: 400 });
  return NextResponse.json(await listVendorLeads(gate.user.id, { search }));
});
export const POST = vendorHandler("vendor lead create", async (request: Request) => {
  const gate = await requireAdminMutation(); if (!gate.ok) return gate.response;
  const body = await readVendorBody(request, vendorLeadSchema); if (!body.ok) return body.response;
  return NextResponse.json(await upsertVendorLead(gate.user.id, body.value), { status: 201 });
});
