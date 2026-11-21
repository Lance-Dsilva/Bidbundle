import { expect, it } from "vitest";
import { buildStripeTestChargeIntent } from "@/lib/stripe-test-charge-intent";
const visit = { visitId: "visit", status: "completed", communityType: "hoa", requestKind: "optional_group" };
it("queues one deterministic reference-only payment intent for completed optional HOA visits", () => {
  expect(buildStripeTestChargeIntent(visit, "1")).toEqual({ kind: "stripe_test_visit_charge", dedupeKey: "stripe-test-charge:visit", payload: { visitId: "visit" } });
});
it("does not queue disabled, incomplete, neighborhood or HOA-paid services", () => {
  expect(buildStripeTestChargeIntent(visit, undefined)).toBeNull();
  for (const change of [{ status: "in_progress" }, { communityType: "neighborhood" }, { requestKind: "compulsory_recurring" }]) expect(buildStripeTestChargeIntent({ ...visit, ...change }, "1")).toBeNull();
});
