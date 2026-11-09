import { NextResponse } from "next/server";
import { authorizeRequest } from "@/lib/server/auth";
import { guardAdminMutation, guardHoaMutation, guardFailureResponse } from "@/lib/server/auth-guard";
import { hoaErrorResponse, readHoaBody, validationErrorResponse } from "@/lib/server/hoa-api";
import { fieldErrors } from "@/lib/validation/profile";
import { getProviderPolicy, providerPolicySchema, updateProviderPolicy } from "@/lib/server/provider-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ communityId: string }> };

export async function GET(_request: Request, context: Context) {
  const gate = await authorizeRequest(["homeowner", "hoa_staff", "admin"]);
  if (!gate.ok) return gate.response;
  const { communityId } = await context.params;
  try { return NextResponse.json(await getProviderPolicy(gate.user.id, communityId), { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return hoaErrorResponse("provider policy read", error); }
}

export async function PATCH(request: Request, context: Context) {
  const gate = await authorizeRequest(["homeowner", "hoa_staff", "admin"]);
  if (!gate.ok) return gate.response;
  const failure = await (gate.user.role === "admin" ? guardAdminMutation(gate.user.id) : guardHoaMutation(gate.user.id));
  if (failure) return guardFailureResponse(failure);
  const body = await readHoaBody(request);
  if (!body.ok) return body.response;
  const parsed = providerPolicySchema.safeParse(body.value);
  if (!parsed.success) return validationErrorResponse(fieldErrors(parsed.error));
  const { communityId } = await context.params;
  try { return NextResponse.json(await updateProviderPolicy(gate.user.id, communityId, parsed.data)); }
  catch (error) { return hoaErrorResponse("provider policy update", error); }
}
