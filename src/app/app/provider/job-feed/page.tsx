"use client";

import { ProviderMarketplaceFeed } from "@/components/provider/ProviderMarketplaceFeed";

/**
 * Provider Job Feed.
 *
 * Everything on this page comes from `/api/provider/marketplace`, the one real
 * marketplace contract. The previous version of this screen called
 * `/api/provider/job-feed` and `/api/provider/bids` — neither of which had a
 * Route Handler — and kept auto-bid rules and saved jobs in `localStorage`,
 * where no server could act on them. Both are gone: a bid is a persisted row
 * or it does not exist.
 */
export default function ProviderJobFeedPage() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6">
      <header className="mb-5">
        <h1 className="text-lg font-semibold" style={{ color: "var(--ink-900)" }}>
          Available work
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--ink-400)" }}>
          Open requests inside your service areas that match the trades on your account.
        </p>
      </header>
      <ProviderMarketplaceFeed />
    </div>
  );
}
