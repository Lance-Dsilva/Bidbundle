import { NextResponse } from "next/server";
import { requireSupportUser, requireSupportMutation } from "@/lib/server/support-api";
import { privateVisitPhotoHandler } from "@/lib/server/private-visit-photo-response";
import { readVisitPhotoForm } from "@/lib/server/visit-photos";
import { listQualityPhotos, storeQualityPhoto } from "@/lib/server/service-quality-photos";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ claimId: string }> };
export const GET = privateVisitPhotoHandler("quality photos list", async (_request: Request, context: Context) => {
 const gate = await requireSupportUser(); if (!gate.ok) return gate.response;
 return NextResponse.json({ photos: await listQualityPhotos(gate.user.id, (await context.params).claimId) });
});
export const POST = privateVisitPhotoHandler("quality photo upload", async (request: Request, context: Context) => {
 const gate = await requireSupportMutation(); if (!gate.ok) return gate.response;
 const form = await readVisitPhotoForm(request);
 return NextResponse.json({ photo: await storeQualityPhoto(gate.user.id, (await context.params).claimId, form.get("file")) }, { status: 201 });
});
