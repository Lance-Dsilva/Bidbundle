import { requireHoaUser, hoaErrorResponse } from "@/lib/server/hoa-api";
import { canonicalShareUrl, getManagedRequestShare } from "@/lib/server/public-request-sharing";
import { createShareFlyer } from "@/lib/server/share-flyer";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, context: { params: Promise<{ requestId: string }> }) {
  const gate = await requireHoaUser(); if (!gate.ok) return gate.response;
  try {
    const summary = await getManagedRequestShare(gate.user.id, (await context.params).requestId);
    const bytes = await createShareFlyer(summary, canonicalShareUrl(summary.path));
    return new Response(Buffer.from(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": 'attachment; filename="bundleen-community-service.pdf"', "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return hoaErrorResponse("share flyer", error); }
}
