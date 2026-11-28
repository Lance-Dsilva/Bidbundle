export function qualityReviewSignal(claims: number, completedVisits: number, thresholdBps = 2000, minimumVisits = 5) {
  if (![claims, completedVisits, thresholdBps, minimumVisits].every(Number.isSafeInteger) || claims < 0 || completedVisits < claims ||
      thresholdBps < 0 || thresholdBps > 10000 || minimumVisits < 1) throw new Error("Invalid quality measurement");
  return {
    claims, completedVisits,
    claimRateBps: completedVisits ? Math.round(claims * 10000 / completedVisits) : 0,
    // Informational review flag only; never suspends a provider automatically.
    reviewSuggested: completedVisits >= minimumVisits && claims * 10000 > completedVisits * thresholdBps,
  };
}
