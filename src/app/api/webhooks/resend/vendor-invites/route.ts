import { NextResponse } from "next/server";
import { vendorHandler } from "@/lib/server/vendor-api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { ingestResendWebhook } from "@/lib/server/vendor-sourcing";
import { readVendorRawBody } from "@/lib/server/vendor-api";
export const POST = vendorHandler("vendor delivery webhook", async (request: Request) => {
  const raw = await readVendorRawBody(request);
  await ingestResendWebhook(raw, {
    "svix-id": request.headers.get("svix-id") ?? "",
    "svix-timestamp": request.headers.get("svix-timestamp") ?? "",
    "svix-signature": request.headers.get("svix-signature") ?? "",
  });
  return NextResponse.json({ accepted: true });
}, true);
