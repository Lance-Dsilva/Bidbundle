import { NextResponse } from "next/server";
import { z } from "zod";
import { createSharedEnrollmentFlow } from "@/lib/server/shared-enrollment";
import { readHoaBody, hoaErrorResponse } from "@/lib/server/hoa-api";
import { guardRegistration, guardFailureResponse } from "@/lib/server/auth-guard";
import { SHARED_ENROLLMENT_COOKIE, sameOriginMutation, privateEnrollmentResponse as protect } from "@/lib/server/shared-enrollment-http";
export const runtime = "nodejs";
const token = z.string().regex(/^[A-Za-z0-9_-]{32}$/);
const schema = z.strictObject({ communityToken: token, requestToken: token });
export async function POST(request: Request) {
  if (!sameOriginMutation(request)) return protect(NextResponse.json({error:"Refresh the service page before continuing."},{status:403}));
  const failure = await guardRegistration(`public-enrollment:${request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"}`);
  if (failure) return protect(guardFailureResponse(failure));
  const body = await readHoaBody(request); if (!body.ok) return protect(body.response);
  const parsed = schema.safeParse(body.value); if (!parsed.success) return protect(NextResponse.json({error:"Invalid service link."},{status:400}));
  try {
    const flow = await createSharedEnrollmentFlow(parsed.data.communityToken, parsed.data.requestToken);
    const response = NextResponse.json({path:flow.path});
    response.cookies.set(SHARED_ENROLLMENT_COOKIE, flow.token, {httpOnly:true, sameSite:"lax", secure:process.env.NODE_ENV === "production", path:"/", expires:new Date(flow.expiresAt)});
    return protect(response);
  } catch(error) { return protect(hoaErrorResponse("Public enrollment",error)); }
}
