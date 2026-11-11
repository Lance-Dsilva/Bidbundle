import { NextResponse } from "next/server";
import { vendorHandler } from "@/lib/server/vendor-api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { unsubscribeVendor } from "@/lib/server/vendor-sourcing";
type Context = { params: Promise<{ token: string }> };
// RFC8058 mail clients may POST cross-origin. The purpose-specific MAC is required;
// GET never opts somebody out or consumes a proposal invitation.
export const POST = vendorHandler("vendor unsubscribe", async (_request: Request, context: Context) => {
  await unsubscribeVendor((await context.params).token);
  return NextResponse.json({ unsubscribed: true });
}, true);
