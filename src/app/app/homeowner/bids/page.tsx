"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, type CSSProperties } from "react";

import { BidPrice, LegacyBidNotice } from "@/components/ui/BidPrice";
import { compareBidQuotes } from "@/lib/bid-pricing";
import { ConfirmAction } from "@/components/ui/ConfirmAction";
import type { HomeownerBidView } from "@/lib/server/marketplace-reads";
import { EmptyState } from "@/components/ui/EmptyState";
import { useHomeownerBids } from "@/hooks/useHomeownerBids";
import { useNeighbourhood } from "@/hooks/useNeighbourhood";
import { apiFetch } from "@/lib/api";
import type { ConversationThread } from "@/lib/server/conversations";

/**
 * Homeowner "My Bids": the quotes providers have sent for requests this
 * account opened or joined.
 *
 * Transparent by design — every participant sees the same comparison — but
 * only the neighbourhood manager can accept one while bidding is open or
 * closed. Awarding an open request ends bidding immediately. `canAward` comes from the server; the award endpoint checks it
 * again, so the button's absence is a courtesy and its presence is not
 * permission.
 */

const card: CSSProperties = {
  background: "var(--bg-card)",
  border: "1px solid var(--border-warm)",
  borderRadius: 18,
  boxShadow: "var(--shadow-warm-sm)",
};

const STATUS_TONES: Record<string, CSSProperties> = {
  submitted: { background: "var(--gold-50)", color: "var(--gold-600)" },
  accepted: { background: "#dcfce7", color: "#15803d" },
  rejected: { background: "#fee2e2", color: "#b91c1c" },
};

/** A live quote is what entitles a customer to message the provider. */
const CONTACTABLE = new Set(["submitted", "accepted"]);



export default function HomeownerBidsPage() {
  const { bids, loading, error, refresh } = useHomeownerBids();
  const { act, busy, missingAddresses, error: actionError, setError: setActionError } = useNeighbourhood();
  const [filter, setFilter] = useState<"all" | "submitted" | "accepted">("all");
  const router = useRouter();
  const [opening, setOpening] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<HomeownerBidView | null>(null);
  const currentBid = confirmation ? bids.find((bid) => bid.id === confirmation.id) : null;
  const validConfirmation = Boolean(confirmation && currentBid?.canAward && ["open_for_bids", "bidding_closed"].includes(currentBid.requestStatus) && currentBid.requestStatus === confirmation.requestStatus && currentBid.status === "submitted" && currentBid.pricingBasis === "total" &&
    currentBid.requestId === confirmation.requestId && currentBid.requestTitle === confirmation.requestTitle &&
    currentBid.homeCount === confirmation.homeCount && currentBid.totalOccurrences === confirmation.totalOccurrences && currentBid.version === confirmation.version && currentBid.amountCents === confirmation.amountCents && currentBid.currency === confirmation.currency && currentBid.providerUserId === confirmation.providerUserId);


  const visible = useMemo(
    () => bids.filter((bid) => filter === "all" || bid.status === filter).sort(compareBidQuotes),
    [bids, filter],
  );

  const award = async (bid: HomeownerBidView) => {
    const ok = await act({ kind: "award", requestId: bid.requestId, bidId: bid.id, expectedBidVersion: bid.version });
    if (ok) await refresh();
    return ok;
  };

  /**
   * Opens the thread for one quote and goes to it.
   *
   * The body names the *bid*, never the provider: the server reads who quoted
   * it and confirms the quote sits on a request this account created. There is
   * no path here that could address an arbitrary account.
   */
  const messageProvider = async (bidId: string) => {
    if (opening) return;
    setOpening(bidId);
    setOpenError(null);
    try {
      const payload = await apiFetch<{ thread: ConversationThread }>("/homeowner/inbox", {
        method: "POST",
        body: JSON.stringify({ bidId }),
      });
      router.push(`/app/homeowner/chat?thread=${payload.thread.id}`);
    } catch (caught) {
      setOpenError(
        caught instanceof Error ? caught.message : "We could not open that conversation.",
      );
      setOpening(null);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-6">
        <p className="text-sm" style={{ color: "var(--ink-400)" }}>
          Loading your quotes…
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6">
      <header className="mb-4">
        <h1 className="text-lg font-semibold" style={{ color: "var(--ink-900)" }}>
          My bids
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--ink-400)" }}>
          Quotes on requests you opened or joined.
        </p>
        <p className="mt-2 text-sm leading-6" style={{ color: "var(--ink-700)" }}>
          The neighbourhood manager chooses the provider. If no manager is assigned, Bundleen must assign one before a provider can be chosen. Viewing quotes does not grant permission to award.
        </p>
      </header>

      {error || actionError || openError ? (
        <p className="mb-4 rounded-xl px-4 py-3 text-sm" role="alert" style={{ background: "#fef2f2", color: "#b91c1c" }}>
          {error ?? actionError ?? openError}
        </p>
      ) : null}

      {missingAddresses ? (
        <div
          className="mb-4 rounded-xl px-4 py-3 text-sm"
          role="alert"
          style={{ background: "#fffbeb", color: "#92400e" }}
        >
          Nothing was awarded: {missingAddresses.names.join(", ")}{" "}
          {missingAddresses.count === 1 ? "has" : "have"} no home address on file yet.
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap gap-2">
        {(["all", "submitted", "accepted"] as const).map((value) => (
          <button
            className="rounded-full px-3 py-1 text-xs font-semibold"
            key={value}
            onClick={() => setFilter(value)}
            style={
              value === filter
                ? { background: "var(--terracotta-600)", color: "white" }
                : { background: "var(--cream-100)", color: "var(--ink-700)" }
            }
            type="button"
          >
            {value === "all" ? "All" : value}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <EmptyState
          ctaHref="/app/homeowner/request"
          ctaLabel="Open a request"
          hint="When providers quote on a request you opened or joined, their bids appear here side by side."
          icon={<span aria-hidden>💬</span>}
          title="No quotes yet"
        />
      ) : (
        <ul className="space-y-3">
          {visible.map((bid) => (
            <li className="p-4" key={bid.id} style={card}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold" style={{ color: "var(--ink-900)" }}>
                    {bid.requestTitle}
                  </p>
                  <p className="mt-1 text-xs" style={{ color: "var(--ink-400)" }}>
                    {bid.providerCompany ?? bid.providerName}
                    {bid.providerVerified ? " · verified" : ""}
                  </p>
                </div>
                <span
                  className="rounded-full px-3 py-1 text-xs font-semibold"
                  style={STATUS_TONES[bid.status] ?? { background: "var(--cream-100)", color: "var(--ink-400)" }}
                >
                  {bid.status}
                </span>
              </div>
              <div className="mt-2"><BidPrice bid={bid} /></div>
              {bid.pricingBasis !== "total" && bid.status === "submitted" ? <LegacyBidNotice requestStatus={bid.requestStatus} /> : null}
              <p className="mt-2 text-xs" style={{ color: "var(--ink-700)" }}>
                {bid.scope}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {bid.canAward && ["open_for_bids", "bidding_closed"].includes(bid.requestStatus) && bid.status === "submitted" ? (
                  <button
                    className="min-h-11 rounded-lg px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
                    disabled={busy || bid.pricingBasis !== "total"}
                    onClick={() => { setActionError(null); setConfirmation({ ...bid }); }}
                    style={{ background: "var(--terracotta-600)" }}
                    type="button"
                  >
                    Award this provider
                  </button>
                ) : null}
                {CONTACTABLE.has(bid.status) ? (
                  <button
                    className="rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-60"
                    disabled={opening === bid.id}
                    onClick={() => void messageProvider(bid.id)}
                    style={{ background: "var(--cream-100)", color: "var(--ink-900)" }}
                    type="button"
                  >
                    {opening === bid.id ? "Opening…" : "Message provider"}
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      {confirmation ? (
        <ConfirmAction
          open title="Award this provider?" confirmLabel="Award provider"
          valid={validConfirmation} error={actionError}
          onCancel={() => setConfirmation(null)}
          onConfirm={async () => !validConfirmation || busy ? false : award(confirmation)}
          description={<>
            <p>Award “{confirmation.requestTitle}” to {confirmation.providerCompany ?? confirmation.providerName} (quote version {confirmation.version})?</p>
            <BidPrice bid={confirmation} />
            <p>{confirmation.requestStatus === "open_for_bids" ? "Awarding now ends bidding immediately. No more quotes can be submitted." : "Bidding is already closed."} This choice cannot be undone here.</p>
            <p>This accepts this quote, rejects other submitted quotes, and creates the agreement and service visits. The provider, affected residents and other bidders may be notified according to their preferences.</p>
          </>}
        />
      ) : null}
    </div>
  );
}
