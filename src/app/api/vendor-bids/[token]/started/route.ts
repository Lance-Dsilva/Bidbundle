import { NextResponse } from "next/server";
import { vendorHandler, readVendorBody } from "@/lib/server/vendor-api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { markProposalStarted } from "@/lib/server/vendor-sourcing";
import { emptyMutationSchema } from "@/lib/validation/hoa";
type Context = { params: Promise<{ token: string }> };
export const POST = vendorHandler("vendor proposal started", async (request: Request, context: Context) => {
  const body = await readVendorBody(request, emptyMutationSchema, 1024); if (!body.ok) return body.response;
  const { token } = await context.params;
  await markProposalStarted(token);
  return NextResponse.json({ started: true });
});
