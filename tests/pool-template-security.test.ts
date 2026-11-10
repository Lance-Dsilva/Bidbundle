import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BidPrice } from "@/components/ui/BidPrice";
import { providerProfileUpdateSchema } from "@/lib/validation/profile";
import type { BidSummary } from "@/lib/hoa-types";
import type { PoolTemplate } from "@/lib/pool-bid-template";
import { redactPoolBidIdentity } from "@/lib/pool-bid-privacy";

const state = vi.hoisted(() => ({ request: {} as Record<string, unknown>, access: vi.fn(), list: vi.fn(), own: vi.fn() }));
vi.mock("@/lib/server/db", () => ({ db: {
  hoaServiceRequest: { findUnique: async () => state.request },
  serviceBid: { findMany: state.list, findUnique: state.own },
} }));
vi.mock("@/lib/server/ai/scope", () => ({ resolveCommunityAccess: state.access, communityHref: () => "/app/homeowner/community" }));
const { getRequestBids } = await import("@/lib/server/ai/tools/request-bids");

const template: PoolTemplate = { version: 1, serviceMonths: 3, visitsPerMonth: 4,
  tiers: ["standard", "large"], hideProviderNamesUntilAward: true };
const quote = { monthlyCents: { standard: 12001, large: 18002 }, chemicalsIncluded: true,
  equipmentRepairsExcluded: true as const, earliestStartDate: "2028-01-31T12:00:00.000Z",
  routeDay: "flexible" as const, cancellationNoticeDays: 30 };
function bid(): BidSummary {
  return { id: "opaque-bid-123456", requestId: "request-1", providerUserId: "PRIVATE_PROVIDER_ID",
    providerName: "PRIVATE_PROVIDER_NAME", providerCompany: "PRIVATE_COMPANY", providerVerified: true,
    status: "submitted", amountCents: 90009, currency: "usd", pricingBasis: "total", perHomeCents: null,
    homeCount: 2, totalOccurrences: 12, proposedStartDate: quote.earliestStartDate,
    scope: "PRIVATE_SCOPE includes the provider name and phone", exclusions: "PRIVATE_EXCLUSIONS name the business",
    estimatedDurationLabel: "PRIVATE_DURATION embeds a contact", cadenceLabel: "PRIVATE_CADENCE embeds a contact",
    validUntil: "2028-01-01T00:00:00Z", version: 2, submittedAt: "2026-11-10T12:00:00Z", poolQuote: quote,
    revisions: [{ version: 1, amountCents: 81000, submittedAt: "2026-11-09T12:00:00Z", poolQuote: quote,
      scope: "PRIVATE_OLD_SCOPE", providerName: "PRIVATE_OLD_NAME" }] as unknown as NonNullable<BidSummary["revisions"]> };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.request = { id: "request-1", title: "Community pool care", communityId: "community-1", poolTemplate: template, awardedAt: null };
  state.access.mockResolvedValue({ communityId: "community-1", name: "Owned community", isManagerOrAdmin: false });
  state.list.mockResolvedValue([{ id: "opaque-bid-123456", provider: { fullName: "PRIVATE_PROVIDER_NAME" },
    status: "submitted", amountCents: 90009, currency: "usd", pricingBasis: "total", submittedAt: new Date("2026-11-10T12:00:00Z") }]);
  state.own.mockResolvedValue({ id: "own-bid", status: "submitted", amountCents: 90009, currency: "usd",
    pricingBasis: "total", submittedAt: new Date("2026-11-10T12:00:00Z") });
});

describe("opted-in pool bid anonymity", () => {
  it("removes identity and every freeform name-bearing note, including historical extras, while keeping structured comparison data", () => {
    const original = bid(), saved = structuredClone(original);
    const hidden = redactPoolBidIdentity(original, template, false, false);
    expect(hidden).toMatchObject({ identityHidden: true, providerUserId: "", providerName: "Provider quote 123456",
      providerCompany: null, amountCents: 90009, currency: "usd", poolQuote: quote,
      exclusions: null, estimatedDurationLabel: null, cadenceLabel: null });
    expect(hidden.revisions).toEqual([{ version: 1, amountCents: 81000, submittedAt: "2026-11-09T12:00:00Z", poolQuote: quote }]);
    expect(JSON.stringify(hidden)).not.toContain("PRIVATE_");
    expect(original).toEqual(saved);
  });

  it.each([
    ["manager", template, false, true], ["awarded request", template, true, false],
    ["unsealed pool request", { ...template, hideProviderNamesUntilAward: false }, false, false],
    ["legacy request", null, false, false],
  ] as const)("preserves the authorized named contract for a %s", (_label, configured, awarded, manager) => {
    const original = bid();
    expect(redactPoolBidIdentity(original, configured, awarded, manager)).toBe(original);
  });
});

describe("AI bid tool follows the same audience boundary", () => {
  const resident = { userId: "resident-1", role: "homeowner" as const, isAdmin: false };

  it("withholds the provider name from an authorized resident before the actual award", async () => {
    const result = await getRequestBids.run(resident, { requestId: "request-1" });
    expect(result.data).toMatchObject({ bids: [{ providerName: "Provider quote 123456", amountCents: 90009 }] });
    expect(JSON.stringify(result)).not.toContain("PRIVATE_PROVIDER_NAME");
    expect(state.access).toHaveBeenCalledWith(resident, "community-1");
  });

  it.each(["manager", "awarded"])("retains named AI results for the %s case", async (kind) => {
    if (kind === "manager") state.access.mockResolvedValue({ communityId: "community-1", isManagerOrAdmin: true });
    else state.request.awardedAt = new Date();
    expect((await getRequestBids.run(resident, { requestId: "request-1" })).data)
      .toMatchObject({ bids: [{ providerName: "PRIVATE_PROVIDER_NAME" }] });
  });

  it("checks community authority before querying any competitor's bid rows", async () => {
    state.access.mockRejectedValue(Object.assign(new Error("Forbidden"), { status: 403 }));
    await expect(getRequestBids.run(resident, { requestId: "request-1" })).rejects.toMatchObject({ status: 403 });
    expect(state.list).not.toHaveBeenCalled();
  });

  it("allows a provider to inspect only their own quote, never the shared comparison list", async () => {
    const result = await getRequestBids.run({ userId: "provider-1", role: "provider", isAdmin: false }, { requestId: "request-1" });
    expect(state.own).toHaveBeenCalledWith(expect.objectContaining({ where: {
      requestId_providerUserId: { requestId: "request-1", providerUserId: "provider-1" },
    } }));
    expect(result.data).toMatchObject({ bids: [{ id: "own-bid", mine: true }] });
    expect(state.list).not.toHaveBeenCalled(); expect(state.access).not.toHaveBeenCalled();
  });
});

describe("pool price presentation preserves the whole-term contract", () => {
  it.each(["quote", "snapshot"])("does not replace actual tier rates with household or visit averages for a pool %s", (kind) => {
    const markup = renderToStaticMarkup(createElement(BidPrice, { bid: {
      amountCents: 90009, currency: "usd", pricingBasis: "total", homeCount: 3, totalOccurrences: 12,
      ...(kind === "quote" ? { poolQuote: quote } : { poolSnapshot: { version: 1 } }),
    } }));
    expect(markup).toContain("900.09"); expect(markup).toContain("whole-job term total");
    expect(markup).toContain("exact monthly and full-term price");
    expect(markup).not.toMatch(/≈|average|per home per visit/i);
  });

  it("keeps the existing approximate breakdown for a legacy whole-job quote", () => {
    const markup = renderToStaticMarkup(createElement(BidPrice, { bid: {
      amountCents: 90009, currency: "usd", pricingBasis: "total", homeCount: 3, totalOccurrences: 12,
    } }));
    expect(markup).toContain("whole-job total"); expect(markup).toContain("Average");
    expect(markup).toContain("per home per visit");
  });
});

describe("provider founded-year claims", () => {
  it("allows omission, an explicit null clear and a real current-or-past year", () => {
    expect(providerProfileUpdateSchema.safeParse({ companyName: "Example provider" }).success).toBe(true);
    expect(providerProfileUpdateSchema.parse({ businessStartedYear: null })).toMatchObject({ businessStartedYear: null });
    for (const businessStartedYear of [1800, 2010, new Date().getUTCFullYear()]) {
      expect(providerProfileUpdateSchema.safeParse({ businessStartedYear }).success).toBe(true);
    }
  });

  it.each([1799, new Date().getUTCFullYear() + 1, Number.NaN, 2000.5, "2010"])("rejects a fabricated or invalid founded year: %j", (businessStartedYear) => {
    expect(providerProfileUpdateSchema.safeParse({ businessStartedYear }).success).toBe(false);
  });
});
