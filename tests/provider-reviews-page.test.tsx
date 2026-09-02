// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import ProviderReviewsPage from "@/app/app/provider/reviews/page";

/**
 * What the reviews page shows when it has nothing yet, nothing at all, or
 * cannot get anything.
 *
 * This page used to call an endpoint that answered 404 and then render four
 * invented testimonials underneath the failure, so "no reviews" and "broken"
 * looked identical and both looked busy. Each state now has to say what it is,
 * and a failure has to offer a way forward without retrying by itself.
 */

const originalFetch = global.fetch;

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  } as unknown as Response;
}

/** Records every request the page makes, so a retry loop would be visible. */
function stubFetch(handler: (url: string) => unknown) {
  const calls: string[] = [];
  global.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return handler(String(input)) as Response;
  }) as unknown as typeof fetch;
  return calls;
}

const emptyRatings = {
  summary: {
    averageRating: null,
    totalCount: 0,
    distribution: [5, 4, 3, 2, 1].map((rating) => ({ rating, count: 0, percent: 0 })),
  },
  reviews: [],
  page: { limit: 20, offset: 0, total: 0, hasMore: false },
};

const twoReviews = {
  summary: {
    averageRating: 4.5,
    totalCount: 2,
    distribution: [
      { rating: 5, count: 1, percent: 50 },
      { rating: 4, count: 1, percent: 50 },
      { rating: 3, count: 0, percent: 0 },
      { rating: 2, count: 0, percent: 0 },
      { rating: 1, count: 0, percent: 0 },
    ],
  },
  reviews: [
    {
      id: "review-1",
      reviewerName: "Sarah Mills",
      rating: 5,
      comment: "Cleared the whole block in a morning.",
      subjectLabel: "Gutter clearing · Cedar Park",
      createdAt: "2026-08-20T09:00:00.000Z",
    },
  ],
  page: { limit: 20, offset: 0, total: 2, hasMore: false },
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  global.fetch = originalFetch;
});

describe("provider reviews page states", () => {
  it("shows a loading line, then an honest empty result — never sample reviews", async () => {
    stubFetch(() => jsonResponse(emptyRatings));
    render(<ProviderReviewsPage />);

    // The loading line is on screen before the first answer resolves.
    expect(screen.getAllByText("Loading reviews…").length).toBeGreaterThan(0);

    expect(await screen.findByText(/No reviews yet — complete your first job/)).toBeInTheDocument();
    expect(screen.getByText("0 verified reviews from Bundleen neighbours")).toBeInTheDocument();
    // The four invented testimonials and the invented "mentions" tallies are
    // gone, not merely hidden behind a flag.
    expect(screen.queryByText(/Sarah M\./)).not.toBeInTheDocument();
    expect(screen.queryByText(/What neighbors mention/)).not.toBeInTheDocument();
  });

  it("renders real reviews with the database's own summary", async () => {
    stubFetch(() => jsonResponse(twoReviews));
    render(<ProviderReviewsPage />);

    expect(await screen.findByText("Sarah Mills")).toBeInTheDocument();
    expect(screen.getByText("Gutter clearing · Cedar Park")).toBeInTheDocument();
    // 4.5 over 2 reviews, from the summary — not an average of the one row
    // this page happens to hold.
    expect(screen.getByText("4.5")).toBeInTheDocument();
    expect(screen.getByText("2 verified reviews from Bundleen neighbours")).toBeInTheDocument();
  });

  it("states a failure once, offers a retry, and does not loop", async () => {
    const calls = stubFetch(() =>
      jsonResponse({ error: "Something went wrong on our end." }, { ok: false, status: 500 }),
    );
    render(<ProviderReviewsPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong on our end.");
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(calls).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(calls).toHaveLength(2));
  });
});
