// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import ProviderDashboardPage from "@/app/app/provider/dashboard/page";
import { ResidentHoaWorkspace } from "@/components/hoa/ResidentHoaWorkspace";
import type { HoaRequestSummary, ProviderFeedItem } from "@/lib/hoa-types";

const CATEGORIES = ["pool_care", "pest_control", "seasonal_maintenance"];

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/hooks/useCountUp", () => ({ useCountUp: (value: number) => value }));
vi.mock("@/hooks/useProviderOverview", () => ({
  useProviderOverview: () => ({
    overview: {
      companyName: "Shared Services", accountStatus: "active", activeBids: 0,
      jobsCompleted: 0, activeJobs: 0, revenueTotalCents: 0, revenue30dCents: 0,
      previous30dCents: 0, revenueChangePct: null, monthlyRevenue: [], currency: "usd",
      winRatePct: null, averageRating: null, reviewsCount: 0, unreadMessages: 0, recentThreads: [],
    },
    loading: false, error: null, refresh: vi.fn(),
  }),
}));
vi.mock("@/hooks/useProviderMarketplace", () => ({
  useProviderMarketplace: () => ({
    workspace: {
      feed: ["pool_care", "pest_control", "seasonal_maintenance"].map((category, index): ProviderFeedItem => ({
        requestId: `request-${index}`, context: "hoa", communityName: "Test HOA",
        locality: "Austin", region: "TX", title: `Shared service ${index}`, category,
        kind: "optional_group", description: "Community service", recurrenceLabel: null,
        totalOccurrences: 1, homeCount: 3, approximateDistanceMi: index + 1,
        budgetMinCents: null, budgetMaxCents: null, startDate: null,
        biddingClosesAt: null, myBid: null,
      })),
      bids: [], agreements: [], occurrencesByAgreement: {},
    },
    loading: false, error: null,
  }),
}));

afterEach(cleanup);

describe("human-readable service labels after category migration", () => {
  it("shows a readable category on the provider dashboard highlight and other job rows", () => {
    render(<ProviderDashboardPage />);
    expect(screen.getByText("Pool care")).toBeInTheDocument();
    expect(screen.getByText("Pest control request")).toBeInTheDocument();
    expect(screen.getByText("Seasonal maintenance request")).toBeInTheDocument();
    for (const slug of CATEGORIES) expect(document.body.textContent).not.toContain(slug);
  });

  it("shows readable categories on HOA resident request cards", () => {
    const requests: HoaRequestSummary[] = CATEGORIES.map((category, index) => ({
      id: `request-${index}`, communityId: "hoa-1", title: `Shared service ${index}`,
      category, description: "Community service", kind: "optional_group", recurrenceLabel: null,
      recurrenceIntervalDays: null, totalOccurrences: 1, status: "open_for_bids", opensAt: null,
      enrollmentClosesAt: null, biddingClosesAt: null, startDate: null, minHomes: null,
      maxHomes: null, participantsLockedAt: null, awardedAt: null, joinedCount: 3,
      declinedCount: 0, bidCount: 0, viewerResponse: null, createdAt: "2026-10-27T00:00:00Z",
    }));
    render(<ResidentHoaWorkspace hub={{ communities: [{
      id: "hoa-1", name: "Test HOA", unitId: "unit-1", unitLabel: "Home 1", requests,
      bidsByRequest: {}, agreements: [], myVisits: [], surveys: [],
    }] }} />);
    for (const label of ["Pool care", "Pest control", "Seasonal maintenance"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    for (const slug of CATEGORIES) expect(document.body.textContent).not.toContain(slug);
  });
});
