import type { BidSummary } from "@/lib/hoa-types";
import type { PoolTemplate } from "@/lib/pool-bid-template";

/** The server applies this before any resident payload leaves its boundary. */
export function redactPoolBidIdentity<T extends BidSummary>(
  bid: T,
  template: PoolTemplate | null,
  awarded: boolean,
  manager: boolean,
): T {
  if (!template?.hideProviderNamesUntilAward || awarded || manager) return bid;
  return {
    ...bid,
    identityHidden: true,
    providerUserId: "",
    providerName: `Provider quote ${bid.id.slice(-6)}`,
    providerCompany: null,
    // Freeform notes and earlier revisions may carry names or contact details.
    scope: "Provider notes are available after a provider is selected.",
    exclusions: null,
    estimatedDurationLabel: null,
    cadenceLabel: null,
    revisions: bid.revisions?.map((revision) => ({
      version: revision.version,
      amountCents: revision.amountCents,
      submittedAt: revision.submittedAt,
      poolQuote: revision.poolQuote,
    })),
  };
}
