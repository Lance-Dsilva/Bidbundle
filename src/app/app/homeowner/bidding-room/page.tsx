"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { BidCard } from "@/components/homeowner/BidCard";
import { Button } from "@/components/ui/Button";
import {
  mockBiddingRoomBids,
  mockBiddingRoomRequest,
} from "@/data/mock/mockBiddingRoom";

const maxSavings =
  mockBiddingRoomRequest.soloPrice -
  Math.min(...mockBiddingRoomBids.map((bid) => bid.amount));

function BackChevronIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24">
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

export default function HomeownerBiddingRoomPage() {
  const router = useRouter();
  const [step, setStep] = useState<"bids" | "confirm" | "confirmed">("bids");
  const [selectedBidId, setSelectedBidId] = useState<string>("br-1");
  const [isConfirming, setIsConfirming] = useState(false);

  const selectedBid = mockBiddingRoomBids.find((bid) => bid.id === selectedBidId)!;
  const savings = mockBiddingRoomRequest.soloPrice - selectedBid.amount;

  function handleConfirm() {
    setIsConfirming(true);
    window.setTimeout(() => {
      setIsConfirming(false);
      setStep("confirmed");
    }, 900);
  }

  return (
    <div className="mx-auto max-w-3xl px-5 py-6 pb-24 md:px-8 md:py-8">
      {step === "bids" && (
        <>
          <header className="mb-6 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                aria-label="Back"
                className="flex h-9 w-9 items-center justify-center rounded-full border border-divider bg-card text-muted shadow-sm transition hover:bg-canvas hover:shadow active:scale-95"
                type="button"
                onClick={() => router.back()}
              >
                <BackChevronIcon />
              </button>
              <div>
                <h1 className="font-display text-[1.3rem] font-bold italic tracking-tight text-foreground">Bidding room</h1>
                <p className="text-[12px] text-muted">{mockBiddingRoomRequest.category}</p>
              </div>
            </div>
            <span className="flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-[12px] font-semibold text-amber-700">
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" /><path strokeLinecap="round" d="M12 6v6l4 2" />
              </svg>
              {mockBiddingRoomRequest.countdown}
            </span>
          </header>

          {/* Request context */}
          <div className="grain mb-6 rounded-2xl bg-surface p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[15px] font-semibold text-white">{mockBiddingRoomRequest.title}</p>
                <div className="mt-1 flex items-center gap-3 text-[12px] text-white/45">
                  <span>{mockBiddingRoomRequest.neighborhood}</span>
                  <span>·</span>
                  <span>{mockBiddingRoomRequest.neighborsJoined}/{mockBiddingRoomRequest.neighborsTotal} neighbors</span>
                </div>
              </div>
              <div className="text-right">
                <p className="text-[11px] text-white/40">Save up to</p>
                <p className="font-display text-[1.4rem] font-bold italic text-amber-400">${maxSavings}</p>
              </div>
            </div>
          </div>

          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-[14px] font-semibold text-foreground">
              {mockBiddingRoomBids.length} bids received
            </h2>
            <span className="flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
              Live
            </span>
          </div>

          <div className="space-y-3">
            {mockBiddingRoomBids.map((bid) => (
              <BidCard
                key={bid.id}
                bid={bid}
                isSelected={selectedBidId === bid.id}
                onSelect={() => setSelectedBidId(bid.id)}
              />
            ))}
          </div>

          {/* AI recommendation */}
          <div className="mt-4 rounded-2xl border border-primary/15 bg-primary/5 p-4">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="flex h-5 w-5 items-center justify-center rounded bg-primary/15 text-[10px] font-bold text-primary">✦</span>
              <span className="text-[12px] font-semibold text-primary">AI recommendation</span>
            </div>
            <p className="text-[13px] text-foreground">
              ProFix Plumbing offers the best value — highest rating (4.9★) at the lowest price in this group bid.
            </p>
          </div>

          <Button
            className="mt-5 w-full"
            disabled={!selectedBidId}
            variant="primary"
            onClick={() => setStep("confirm")}
            style={{ height: "52px", fontSize: "15px" } as React.CSSProperties}
          >
            Accept bid — ${selectedBid.amount}
          </Button>
        </>
      )}

      {step === "confirm" && (
        <>
          <header className="mb-6 flex items-center gap-3">
            <button
              aria-label="Back to bids"
              className="flex h-9 w-9 items-center justify-center rounded-full border border-divider bg-card text-muted shadow-sm transition hover:bg-canvas active:scale-95"
              type="button"
              onClick={() => setStep("bids")}
            >
              <BackChevronIcon />
            </button>
            <div>
              <h1 className="font-display text-[1.3rem] font-bold italic tracking-tight text-foreground">Confirm booking</h1>
              <p className="text-[12px] text-muted">Review before you confirm</p>
            </div>
          </header>

          <div className="rounded-2xl border border-divider bg-card p-6 shadow-card">
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-base font-bold text-white shadow-sm">
                {selectedBid.providerInitials}
              </div>
              <div className="min-w-0">
                <p className="text-[16px] font-semibold text-foreground">{selectedBid.providerName}</p>
                <div className="mt-0.5 flex items-center gap-2">
                  <span className="text-[13px] font-semibold text-accent-bright">★ {selectedBid.rating}</span>
                  <span className="text-[13px] text-muted">{selectedBid.jobsCompleted} jobs completed</span>
                </div>
              </div>
            </div>

            <div className="my-5 border-t border-divider" />

            <div className="grid grid-cols-2 gap-3 text-center">
              <div className="rounded-2xl bg-canvas p-4">
                <p className="font-display text-[2rem] font-bold italic text-foreground">${selectedBid.amount}</p>
                <p className="mt-0.5 text-[12px] text-muted">Bid amount</p>
              </div>
              <div className="rounded-2xl bg-canvas p-4">
                <p className="font-display text-[2rem] font-bold italic text-foreground">{selectedBid.estimatedDays}d</p>
                <p className="mt-0.5 text-[12px] text-muted">Estimated days</p>
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-[14px] font-semibold text-amber-800">You save ${savings} with your community</p>
            <p className="mt-0.5 text-[12px] text-amber-700/70">vs. booking alone at ${mockBiddingRoomRequest.soloPrice}</p>
          </div>

          <Button className="mt-5 w-full" disabled={isConfirming} variant="primary" onClick={handleConfirm}
            style={{ height: "52px", fontSize: "15px" } as React.CSSProperties}>
            {isConfirming ? "Confirming…" : "Confirm booking"}
          </Button>

          <button className="mt-3 w-full py-2 text-center text-[13px] text-muted transition hover:text-foreground" type="button" onClick={() => setStep("bids")}>
            ← Back to bids
          </button>
        </>
      )}

      {step === "confirmed" && (
        <>
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <div className="flex h-18 w-18 items-center justify-center rounded-full bg-emerald-100" style={{ height: "72px", width: "72px" }}>
              <svg aria-hidden="true" className="h-9 w-9 text-emerald-600" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" viewBox="0 0 24 24">
                <path d="m5 12 5 5L19 8" />
              </svg>
            </div>
            <h2 className="mt-3 font-display text-[2rem] font-bold italic text-foreground">Booking confirmed!</h2>
            <p className="text-[14px] text-muted">{selectedBid.providerName} · {mockBiddingRoomRequest.category}</p>
          </div>

          <div className="grain rounded-2xl bg-surface p-6 text-white">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-white/45">Service details</p>
            <p className="mt-1.5 text-[16px] font-semibold text-white">{selectedBid.providerName}</p>
            <div className="mt-4 grid grid-cols-3 divide-x divide-white/12 border-t border-white/12 pt-4 text-center">
              <div>
                <p className="font-display text-[1.5rem] font-bold italic text-white">${selectedBid.amount}</p>
                <p className="text-[10px] uppercase tracking-wide text-white/40">Amount</p>
              </div>
              <div>
                <p className="font-display text-[1.5rem] font-bold italic text-white">{selectedBid.estimatedDays}d</p>
                <p className="text-[10px] uppercase tracking-wide text-white/40">Est.</p>
              </div>
              <div>
                <p className="font-display text-[1.5rem] font-bold italic text-amber-400">★ {selectedBid.rating}</p>
                <p className="text-[10px] uppercase tracking-wide text-white/40">Rating</p>
              </div>
            </div>
            <p className="mt-3 text-[12px] text-white/40">📍 {mockBiddingRoomRequest.neighborhood}</p>
          </div>

          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-[14px] font-semibold text-amber-800">You saved ${savings} with your community</p>
            <p className="mt-0.5 text-[12px] text-amber-700/70">{mockBiddingRoomRequest.neighborsJoined} neighbors in this group bid</p>
          </div>

          <Button className="mt-5 w-full" variant="primary" onClick={() => router.push("/app/homeowner/bids")}
            style={{ height: "52px", fontSize: "15px" } as React.CSSProperties}>
            Track my service
          </Button>

          <p className="mt-3 text-center text-[12px] text-muted">You can leave a review when the service is complete</p>
        </>
      )}
    </div>
  );
}
