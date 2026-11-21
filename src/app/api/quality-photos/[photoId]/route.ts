import { NextResponse } from "next/server";
import { requireSupportUser } from "@/lib/server/support-api";
import { privateVisitPhotoHandler } from "@/lib/server/private-visit-photo-response";
import { readQualityPhoto } from "@/lib/server/service-quality-photos";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ photoId: string }> };
export const GET = privateVisitPhotoHandler("quality photo read", async (_request: Request, context: Context) => {
 const gate = await requireSupportUser(); if (!gate.ok) return gate.response;
 const photo = await readQualityPhoto(gate.user.id, (await context.params).photoId);
 return photo ? new NextResponse(photo.stream, { headers: { "Content-Type": photo.contentType, "Content-Disposition": "inline" } }) : new NextResponse(null, { status: 404 });
});
