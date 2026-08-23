import { describe, expect, it } from "vitest";

import { searchHelp } from "@/lib/server/ai/help-content";

describe("searchHelp", () => {
  it("finds the bidding article for a bidding question", () => {
    const matches = searchHelp("how does bidding work on requests");
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].slug).toBe("how-bidding-works");
    expect(matches[0].title).toBe("How bidding works");
  });

  it("finds the provider verification article for a licensing question", () => {
    const matches = searchHelp("is a provider's license verified");
    expect(matches.some((m) => m.slug === "provider-verification")).toBe(true);
  });

  it("returns nothing for a query with no matching terms, rather than a weak guess", () => {
    expect(searchHelp("xylophone quokka zzz")).toEqual([]);
  });

  it("returns nothing for an empty or whitespace-only query", () => {
    expect(searchHelp("   ")).toEqual([]);
  });

  it("caps results at the requested limit", () => {
    const matches = searchHelp("account role community manager provider request", 2);
    expect(matches.length).toBeLessThanOrEqual(2);
  });
});
