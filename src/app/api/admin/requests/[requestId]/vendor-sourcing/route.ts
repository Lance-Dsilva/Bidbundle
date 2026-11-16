import { NextResponse } from "next/server";
import { vendorHandler, readVendorBody } from "@/lib/server/vendor-api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { requireAdmin, requireAdminMutation } from "@/lib/server/admin-api";
import { listRequestSourcing, inviteVendorBatch } from "@/lib/server/vendor-sourcing";
import { vendorInviteBatchSchema } from "@/lib/validation/vendor-sourcing";
type Context = { params: Promise<{ requestId: string }> };
export const GET = vendorHandler("vendor sourcing candidates", async (_request: Request, context: Context) => {
  const gate = await requireAdmin(); if (!gate.ok) return gate.response;
  return NextResponse.json(await listRequestSourcing(gate.user.id, (await context.params).requestId));
});
export const POST = vendorHandler("vendor batch invitation", async (request: Request, context: Context) => {
  const gate = await requireAdminMutation(); if (!gate.ok) return gate.response;
  const body = await readVendorBody(request, vendorInviteBatchSchema); if (!body.ok) return body.response;
  return NextResponse.json(await inviteVendorBatch(gate.user.id, (await context.params).requestId, body.value));
});
