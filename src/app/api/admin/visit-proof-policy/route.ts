import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, requireAdminMutation, readAdminBody, adminErrorResponse, validationErrorResponse } from "@/lib/server/admin-api";
import { SERVICE_CATEGORIES } from "@/lib/service-categories";
import { listVisitProofPolicies, updateVisitProofPolicy } from "@/lib/server/visit-proof-policy";
import { fieldErrors } from "@/lib/validation/profile";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const inputSchema = z.object({ category: z.enum(SERVICE_CATEGORIES), requiresAfterPhoto: z.boolean() }).strict();
const headers = { "Cache-Control": "private, no-store" };
export async function GET() {
  const gate = await requireAdmin(); if (!gate.ok) return gate.response;
  try { return NextResponse.json(await listVisitProofPolicies(gate.user.id), { headers }); }
  catch (error) { return adminErrorResponse("visit proof policy read", error); }
}
export async function PATCH(request: Request) {
  const gate = await requireAdminMutation(); if (!gate.ok) return gate.response;
  const body = await readAdminBody(request, 2048); if (!body.ok) return body.response;
  const parsed = inputSchema.safeParse(body.value); if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));
  try { return NextResponse.json(await updateVisitProofPolicy(gate.user.id, parsed.data.category, parsed.data.requiresAfterPhoto), { headers }); }
  catch (error) { return adminErrorResponse("visit proof policy update", error); }
}
