import { NextResponse } from "next/server";
import { vendorHandler } from "@/lib/server/vendor-api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { getPublicBidSummary } from "@/lib/server/vendor-sourcing";
type Context = { params: Promise<{ token: string }> };
export const GET = vendorHandler("public vendor proposal summary", async (_request: Request, context: Context) => {
  const summary = await getPublicBidSummary((await context.params).token);
  return summary ? NextResponse.json(summary) : NextResponse.json({ error: "Invitation unavailable." }, { status: 404 });
});
