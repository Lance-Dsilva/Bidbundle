export const STRIPE_TEST_VISIT_CHARGE = "stripe_test_visit_charge";
/** Included in the same transaction as completion; never performs a Stripe call. */
export function buildStripeTestChargeIntent(visit: { visitId: string; status: string; communityType: string; requestKind: string }, enabled: string | undefined) {
  if (enabled !== "1" || visit.status !== "completed" || visit.communityType !== "hoa" || visit.requestKind !== "optional_group") return null;
  return { kind: STRIPE_TEST_VISIT_CHARGE, dedupeKey: `stripe-test-charge:${visit.visitId}`, payload: { visitId: visit.visitId } };
}
