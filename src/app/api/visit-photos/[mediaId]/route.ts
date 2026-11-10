import { NextResponse } from "next/server";
import { authorizeRequest } from "@/lib/server/auth";
import { hoaErrorResponse } from "@/lib/server/hoa-api";
import { loadVisitPhotoForAccess, readVisitPhotoBytes } from "@/lib/server/visit-photos";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", Vary: "Cookie, Authorization" };
type Context = { params: Promise<{ mediaId: string }> };
export async function GET(_request: Request, context: Context) {
  const gate = await authorizeRequest(["homeowner", "hoa_staff", "provider", "admin"]); if (!gate.ok) return gate.response;
  const { mediaId } = await context.params;
  try {
    const asset = await loadVisitPhotoForAccess(gate.user.id, mediaId);
    if (!asset) return new NextResponse(null, { status: 404, headers });
    const stream = await readVisitPhotoBytes(asset);
    if (!stream) return new NextResponse(null, { status: 404, headers });
    return new NextResponse(stream, { headers: { ...headers, "Content-Type": asset.contentType, "Content-Disposition": "inline" } });
  } catch (error) { const response = hoaErrorResponse("private visit photo read", error); Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value)); return response; }
}
