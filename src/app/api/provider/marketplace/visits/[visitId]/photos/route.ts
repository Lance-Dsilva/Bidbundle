import { NextResponse } from "next/server";
import { requireProviderConsole, requireProviderConsoleMutation } from "@/lib/server/provider-api";
import { privateVisitPhotoHandler } from "@/lib/server/private-visit-photo-response";
import { HoaWorkflowError } from "@/lib/server/hoa";
import { listVisitPhotos, readVisitPhotoForm, storeVisitPhoto } from "@/lib/server/visit-photos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ visitId: string }> };

export const GET = privateVisitPhotoHandler("visit photo list", async (_request: Request, context: Context) => {
  const gate = await requireProviderConsole(); if (!gate.ok) return gate.response;
  const { visitId } = await context.params;
  return NextResponse.json(await listVisitPhotos(gate.user.id, visitId));
});

export const POST = privateVisitPhotoHandler("visit photo upload", async (request: Request, context: Context) => {
  const gate = await requireProviderConsoleMutation(); if (!gate.ok) return gate.response;
  const { visitId } = await context.params;
  const form = await readVisitPhotoForm(request), purpose = form.get("purpose");
  if ((purpose !== "visit_before" && purpose !== "visit_after") || form.getAll("purpose").length !== 1 || form.getAll("file").length !== 1 || [...form.keys()].some((key) => key !== "file" && key !== "purpose")) throw new HoaWorkflowError("Upload one photo and choose before or after.", 400);
  return NextResponse.json({ photo: await storeVisitPhoto(gate.user.id, visitId, purpose, form.get("file")) }, { status: 201 });
});
