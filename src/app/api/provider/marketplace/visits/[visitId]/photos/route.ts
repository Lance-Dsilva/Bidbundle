import { NextResponse } from "next/server";
import { requireProviderConsole, requireProviderConsoleMutation } from "@/lib/server/provider-api";
import { hoaErrorResponse } from "@/lib/server/hoa-api";
import { HoaWorkflowError } from "@/lib/server/hoa";
import { listVisitPhotos, readVisitPhotoForm, storeVisitPhoto } from "@/lib/server/visit-photos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ visitId: string }> };
const headers = { "Cache-Control": "private, no-store" };

export async function GET(_request: Request, context: Context) {
  const gate = await requireProviderConsole(); if (!gate.ok) return gate.response;
  const { visitId } = await context.params;
  try { return NextResponse.json(await listVisitPhotos(gate.user.id, visitId), { headers }); }
  catch (error) { return hoaErrorResponse("visit photo list", error); }
}

export async function POST(request: Request, context: Context) {
  const gate = await requireProviderConsoleMutation(); if (!gate.ok) return gate.response;
  const { visitId } = await context.params;
  try {
    const form = await readVisitPhotoForm(request), purpose = form.get("purpose");
    if ((purpose !== "visit_before" && purpose !== "visit_after") || form.getAll("purpose").length !== 1 || form.getAll("file").length !== 1 || [...form.keys()].some((key) => key !== "file" && key !== "purpose")) throw new HoaWorkflowError("Upload one photo and choose before or after.", 400);
    return NextResponse.json({ photo: await storeVisitPhoto(gate.user.id, visitId, purpose, form.get("file")) }, { status: 201, headers });
  } catch (error) { return hoaErrorResponse("visit photo upload", error); }
}
