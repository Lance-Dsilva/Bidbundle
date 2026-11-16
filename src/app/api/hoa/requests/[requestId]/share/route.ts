import { NextResponse } from "next/server";
import { z } from "zod";
import { requireHoaMutation, readHoaBody, hoaErrorResponse } from "@/lib/server/hoa-api";
import { setRequestSharing } from "@/lib/server/public-request-sharing";
export const runtime = "nodejs";
const schema = z.object({ action: z.enum(["enable", "disable", "rotate"]) }).strict();
export async function POST(request: Request, context: { params: Promise<{ requestId: string }> }) {
  const gate = await requireHoaMutation(); if (!gate.ok) return gate.response;
  const body = await readHoaBody(request); if (!body.ok) return body.response;
  const parsed = schema.safeParse(body.value); if (!parsed.success) return NextResponse.json({ error: "Choose a sharing action." }, { status: 400 });
  try { return NextResponse.json(await setRequestSharing(gate.user.id, (await context.params).requestId, parsed.data.action), { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return hoaErrorResponse("request sharing", error); }
}
