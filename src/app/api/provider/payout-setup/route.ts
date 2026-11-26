import { requireProviderMutation, requireProviderUser, hoaErrorResponse } from "@/lib/server/hoa-api";
import { refreshStripeTestPayouts, startStripeTestOnboarding } from "@/lib/server/stripe-test-connect";
export const runtime = "nodejs";
export async function GET() {
  const gate = await requireProviderUser(); if (!gate.ok) return gate.response;
  if (process.env.STRIPE_TEST_CONNECT !== "1") return Response.json({ enabled: false }, { headers: { "Cache-Control": "private, no-store" } });
  try { return Response.json({ enabled: true, ...await refreshStripeTestPayouts(gate.user.id) }, { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return hoaErrorResponse("sandbox payouts", error); }
}
export async function POST() {
  const gate = await requireProviderMutation(); if (!gate.ok) return gate.response;
  try { return Response.json(await startStripeTestOnboarding(gate.user.id), { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return hoaErrorResponse("sandbox payouts", error); }
}
