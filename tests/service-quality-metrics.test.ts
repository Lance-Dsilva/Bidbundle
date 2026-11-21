import { expect, it } from "vitest";
import { qualityReviewSignal } from "@/lib/service-quality-metrics";
it("flags only a sufficient cohort strictly above the configured rate", () => {
  expect(qualityReviewSignal(1, 5)).toMatchObject({ claimRateBps: 2000, reviewSuggested: false });
  expect(qualityReviewSignal(2, 5)).toMatchObject({ claimRateBps: 4000, reviewSuggested: true });
  expect(qualityReviewSignal(2, 2)).toMatchObject({ reviewSuggested: false });
  expect(qualityReviewSignal(0, 0)).toMatchObject({ claimRateBps: 0, reviewSuggested: false });
});
it("rejects impossible counts and invalid thresholds rather than presenting misleading rates", () => {
  expect(() => qualityReviewSignal(2, 1)).toThrow();
  expect(() => qualityReviewSignal(-1, 2)).toThrow();
  expect(() => qualityReviewSignal(1, 2, 10001)).toThrow();
  expect(() => qualityReviewSignal(1, 2, 1000, 0)).toThrow();
});
