import { authorizeRequest } from "@/lib/server/auth";
import { HoaWorkflowError } from "@/lib/server/hoa";
import { getResidentTestReceipt } from "@/lib/server/stripe-test-payment-history";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, context: { params: Promise<{ visitId: string }> }) {
  const gate = await authorizeRequest(["homeowner"]);
  if (!gate.ok) { gate.response.headers.set("Cache-Control", "private, no-store"); return gate.response; }
  try {
    const { visitId } = await context.params;
    const receipt = await getResidentTestReceipt(gate.user.id, visitId);
    return new Response(null, { status: 303, headers: { Location: receipt, "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) {
    // Processor errors may contain sensitive request data; never relay/log them.
    return Response.json({ error: error instanceof HoaWorkflowError ? error.message : "Receipt is temporarily unavailable." }, { status: error instanceof HoaWorkflowError ? error.status : 503, headers: { "Cache-Control": "private, no-store" } });
  }
}
