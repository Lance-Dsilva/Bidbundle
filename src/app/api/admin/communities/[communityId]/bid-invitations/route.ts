import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, requireAdminMutation, readAdminBody, adminErrorResponse, validationErrorResponse } from "@/lib/server/admin-api";
import { inviteProviderToBid, listProviderBidInvitations } from "@/lib/server/provider-bid-invitations";
import { fieldErrors } from "@/lib/validation/profile";

export const runtime = "nodejs";
type Context = { params: Promise<{ communityId: string }> };
const inputSchema = z.object({ requestId: z.string().trim().min(1).max(64), providerUserId: z.string().trim().min(1).max(64) }).strict();

export async function GET(request: Request, context: Context) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;
  const { communityId } = await context.params;
  const requestId = new URL(request.url).searchParams.get("requestId") || undefined;
  if (requestId && requestId.length > 64) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  try {
    return NextResponse.json(await listProviderBidInvitations(gate.user.id, communityId, requestId), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return adminErrorResponse("provider bid invitations", error); }
}

export async function POST(request: Request, context: Context) {
  const gate = await requireAdminMutation();
  if (!gate.ok) return gate.response;
  const body = await readAdminBody(request, 2048);
  if (!body.ok) return body.response;
  const parsed = inputSchema.safeParse(body.value);
  if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));
  const { communityId } = await context.params;
  try {
    return NextResponse.json(await inviteProviderToBid(gate.user.id, communityId, parsed.data.requestId, parsed.data.providerUserId));
  } catch (error) { return adminErrorResponse("provider bid invitation", error); }
}
