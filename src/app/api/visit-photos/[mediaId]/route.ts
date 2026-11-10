import { NextResponse } from "next/server";
import { authorizeRequest } from "@/lib/server/auth";
import { privateVisitPhotoHandler } from "@/lib/server/private-visit-photo-response";
import { loadVisitPhotoForAccess, readVisitPhotoBytes } from "@/lib/server/visit-photos";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ mediaId: string }> };
export const GET = privateVisitPhotoHandler("private visit photo read", async (_request: Request, context: Context) => {
  const gate = await authorizeRequest(["homeowner", "hoa_staff", "provider", "admin"]); if (!gate.ok) return gate.response;
  const { mediaId } = await context.params;
  const asset = await loadVisitPhotoForAccess(gate.user.id, mediaId);
  if (!asset) return new NextResponse(null, { status: 404 });
  const stream = await readVisitPhotoBytes(asset);
  if (!stream) return new NextResponse(null, { status: 404 });
  return new NextResponse(stream, { headers: { "Content-Type": asset.contentType, "Content-Disposition": "inline" } });
});
