import { NextResponse } from "next/server";
import { requireProviderConsoleMutation } from "@/lib/server/provider-api";
import { privateVisitPhotoHandler } from "@/lib/server/private-visit-photo-response";
import { removeVisitPhoto } from "@/lib/server/visit-photos";
export const runtime = "nodejs";
type Context = { params: Promise<{ visitId: string; mediaId: string }> };
export const DELETE = privateVisitPhotoHandler("visit photo removal", async (_request: Request, context: Context) => {
  const gate = await requireProviderConsoleMutation(); if (!gate.ok) return gate.response;
  const { visitId, mediaId } = await context.params;
  await removeVisitPhoto(gate.user.id, visitId, mediaId);
  return NextResponse.json({ removed: true });
});
