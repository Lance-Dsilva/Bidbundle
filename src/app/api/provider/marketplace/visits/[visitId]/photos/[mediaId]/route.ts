import { NextResponse } from "next/server";
import { requireProviderConsoleMutation } from "@/lib/server/provider-api";
import { hoaErrorResponse } from "@/lib/server/hoa-api";
import { removeVisitPhoto } from "@/lib/server/visit-photos";
export const runtime = "nodejs";
type Context = { params: Promise<{ visitId: string; mediaId: string }> };
export async function DELETE(_request: Request, context: Context) {
  const gate = await requireProviderConsoleMutation(); if (!gate.ok) return gate.response;
  const { visitId, mediaId } = await context.params;
  try { await removeVisitPhoto(gate.user.id, visitId, mediaId); return NextResponse.json({ removed: true }); }
  catch (error) { return hoaErrorResponse("visit photo removal", error); }
}
