import { NextResponse } from "next/server";
import { vendorHandler, readVendorBody } from "@/lib/server/vendor-api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { requireAdmin, requireAdminMutation } from "@/lib/server/admin-api";
import { listVendorSourcingRequests } from "@/lib/server/vendor-sourcing";
type Context = { params: Promise<{ communityId: string }> };
export const GET = vendorHandler("vendor sourcing requests", async (_request: Request, context: Context) => {
  const gate = await requireAdmin(); if (!gate.ok) return gate.response;
  return NextResponse.json(await listVendorSourcingRequests(gate.user.id, (await context.params).communityId));
});
