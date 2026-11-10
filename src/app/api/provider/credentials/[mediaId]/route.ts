import { NextResponse } from "next/server";
import { authorizeRequest } from "@/lib/server/auth";
import { hoaErrorResponse } from "@/lib/server/hoa-api";
import { loadProviderCredentialForAccess, readPrivateCredentialBytes } from "@/lib/server/provider-credentials";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const missing = () => NextResponse.json({ error: "Not found." }, { status: 404, headers: { "Cache-Control": "private, no-store" } });

export async function GET(_request: Request, context: { params: Promise<{ mediaId: string }> }) {
  const gate = await authorizeRequest();
  if (!gate.ok) return missing();
  const { mediaId } = await context.params;
  try {
    const asset = await loadProviderCredentialForAccess(mediaId, { userId: gate.user.id,
      canReviewProviders: gate.user.role === "admin" && gate.user.adminAccessLevel !== null && !gate.user.adminIsStaffAccount });
    if (!asset) return missing();
    const payload = await readPrivateCredentialBytes(asset);
    if (!payload) return missing();
    return new NextResponse(payload.stream, { headers: {
      "Content-Type": payload.contentType, "Content-Disposition": "attachment; filename=credential-document",
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'", "Referrer-Policy": "no-referrer",
    } });
  } catch (error) { return hoaErrorResponse("private credential read", error); }
}
