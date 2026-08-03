import type React from "react";
import Link from "next/link";

import { Button } from "@/components/ui/Button";

const stats = [
  { value: "2,400+", label: "Homeowners" },
  { value: "$310", label: "Avg. saved", amber: true },
  { value: "47", label: "Verified providers" },
];

function LiveBiddingPreview() {
  return (
    <div className="relative w-full max-w-[460px] mx-auto lg:mx-0 lg:ml-auto">
      {/* Glow behind card */}
      <div
        className="absolute inset-0 rounded-3xl opacity-40 blur-3xl"
        style={{ background: "radial-gradient(circle at 40% 50%, rgba(37,99,235,0.4) 0%, rgba(217,119,6,0.2) 60%, transparent 80%)", transform: "scale(1.1)" }}
      />

      {/* Main card */}
      <div
        className="grain relative rounded-3xl border border-white/8 p-6"
        style={{
          background: "linear-gradient(145deg, rgba(30,47,72,0.98) 0%, rgba(21,32,51,0.99) 100%)",
          boxShadow: "0 40px 100px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04), inset 0 1px 0 rgba(255,255,255,0.06)",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/30">
              Live Bidding Room
            </p>
            <p className="mt-0.5 text-[15px] font-semibold text-white">
              Plumbing — Pipe Repair
            </p>
          </div>
          <span className="flex items-center gap-1.5 rounded-full bg-amber-500/15 px-3 py-1 text-[11px] font-bold text-amber-400 ring-1 ring-amber-500/20">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
            LIVE
          </span>
        </div>

        {/* Neighbors */}
        <div className="mt-3.5 flex items-center gap-2.5 rounded-2xl bg-white/5 px-3.5 py-2.5 ring-1 ring-white/6">
          <div className="flex -space-x-2">
            {["LS", "MC", "AP", "JK"].map((init, i) => (
              <div
                key={i}
                className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[8px] font-bold text-white ring-2 ring-[#152033]"
              >
                {init}
              </div>
            ))}
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-white/10 text-[8px] font-bold text-white/60 ring-2 ring-[#152033]">
              +10
            </div>
          </div>
          <p className="text-[11px] text-white/45">14 neighbors joined · 23h left</p>
        </div>

        {/* Bids */}
        <div className="mt-3.5 space-y-2">
          {/* Winning bid */}
          <div
            className="bid-appear rounded-2xl p-3.5"
            style={{
              border: "1.5px solid rgba(217,119,6,0.4)",
              background: "linear-gradient(135deg, rgba(217,119,6,0.08) 0%, rgba(217,119,6,0.04) 100%)",
              animationDelay: "0.3s",
            }}
          >
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-amber-500 text-[11px] font-bold text-white shadow-lg shadow-amber-900/30">
                PF
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-white">ProFix Plumbing</p>
                <p className="text-[11px] text-white/40">★ 4.9 · 248 jobs</p>
              </div>
              <div className="flex-none text-right">
                <p className="font-display text-[20px] font-bold italic text-amber-400">$280</p>
                <p className="text-[10px] text-white/35">3d est.</p>
              </div>
            </div>
            <div className="mt-2.5 flex items-center gap-1.5 border-t border-amber-500/15 pt-2">
              <svg className="h-3 w-3 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="m5 12 5 5L19 8" />
              </svg>
              <span className="text-[10px] font-semibold text-amber-400">Best value · AI recommended</span>
            </div>
          </div>

          {/* Second bid */}
          <div className="bid-appear rounded-2xl border border-white/7 bg-white/3 p-3.5" style={{ animationDelay: "0.55s" }}>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-white/10 text-[11px] font-bold text-white">AH</div>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-white">AquaHome Services</p>
                <p className="text-[11px] text-white/40">★ 4.7 · 183 jobs</p>
              </div>
              <div className="flex-none text-right">
                <p className="font-display text-[20px] font-bold italic text-white">$320</p>
                <p className="text-[10px] text-white/35">4d est.</p>
              </div>
            </div>
          </div>

          {/* Third bid */}
          <div className="bid-appear rounded-2xl border border-white/7 bg-white/3 p-3.5" style={{ animationDelay: "0.8s" }}>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-white/10 text-[11px] font-bold text-white">CP</div>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-white">City Pro Plumbing</p>
                <p className="text-[11px] text-white/40">★ 4.8 · 312 jobs</p>
              </div>
              <div className="flex-none text-right">
                <p className="font-display text-[20px] font-bold italic text-white">$350</p>
                <p className="text-[10px] text-white/35">2d est.</p>
              </div>
            </div>
          </div>
        </div>

        {/* Savings */}
        <div className="mt-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/7 px-4 py-3">
          <div className="flex items-center justify-between">
            <p className="text-[12px] font-semibold text-emerald-400">Group saves $120 vs. solo quotes</p>
            <p className="text-[10px] text-white/25">Solo avg: $400</p>
          </div>
        </div>

        {/* Accept */}
        <button
          className="mt-3.5 w-full rounded-2xl bg-primary py-3 text-[13px] font-semibold text-white transition-all hover:bg-primary/90"
          type="button"
          tabIndex={-1}
          aria-hidden="true"
        >
          Accept bid — $280
        </button>
      </div>

      {/* Floating: new neighbor */}
      <div
        className="float-y absolute -right-4 top-4 hidden items-center gap-2.5 rounded-2xl border border-white/10 px-3.5 py-2.5 backdrop-blur-xl lg:flex"
        style={{
          background: "rgba(21,32,51,0.95)",
          boxShadow: "0 12px 40px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.06)",
          animationDelay: "0.8s",
        }}
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500/20 text-sm">🏠</span>
        <div>
          <p className="text-[11px] font-semibold text-white">New neighbor joined</p>
          <p className="text-[10px] text-white/40">123 Maple St · just now</p>
        </div>
      </div>

      {/* Floating: new bid */}
      <div
        className="float-y absolute -left-4 bottom-20 hidden items-center gap-2 rounded-xl border border-white/8 px-3 py-2 backdrop-blur-xl lg:flex"
        style={{
          background: "rgba(21,32,51,0.95)",
          boxShadow: "0 8px 28px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.05)",
          animationDelay: "2.2s",
        }}
      >
        <span className="text-sm">⚡</span>
        <p className="text-[11px] font-medium text-white/70">
          New bid: <span className="font-bold text-amber-400">$280</span>
        </p>
      </div>
    </div>
  );
}

export function Splash() {
  return (
    <section
      className="relative overflow-hidden"
      style={{ background: "#07111e", minHeight: "100vh" }}
    >
      {/* Dot grid */}
      <div className="pointer-events-none absolute inset-0 dot-grid opacity-60" />

      {/* Orbs */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="orb-a absolute left-[-5%] top-[20%] h-[640px] w-[640px] rounded-full"
          style={{ background: "radial-gradient(circle, rgba(37,99,235,0.22) 0%, transparent 65%)", filter: "blur(72px)" }}
        />
        <div
          className="orb-b absolute bottom-[5%] right-[-5%] h-[500px] w-[500px] rounded-full"
          style={{ background: "radial-gradient(circle, rgba(217,119,6,0.18) 0%, transparent 65%)", filter: "blur(60px)" }}
        />
        <div
          className="orb-c absolute right-[25%] top-[-5%] h-[320px] w-[320px] rounded-full"
          style={{ background: "radial-gradient(circle, rgba(124,58,237,0.10) 0%, transparent 70%)", filter: "blur(48px)" }}
        />
      </div>

      {/* Content */}
      <div className="relative mx-auto max-w-7xl px-6 pb-28 pt-28 lg:px-10 lg:pt-36 xl:pt-40">
        <div className="grid grid-cols-1 items-center gap-14 lg:grid-cols-[1fr_1fr] xl:grid-cols-[52%_48%] lg:gap-12">

          {/* LEFT */}
          <div>
            <div className="fade-up inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 backdrop-blur-sm">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
              <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/55">
                Live in 80+ neighborhoods
              </span>
            </div>

            <h1
              className="fade-up fade-up-1 mt-5 font-display font-bold italic leading-[1.0] tracking-tightest text-white"
              style={{ fontSize: "clamp(3.2rem, 7vw, 7rem)" }}
            >
              Bid together,
              <br />
              <span style={{ color: "#f59e0b" }}>save together.</span>
            </h1>

            <p className="fade-up fade-up-2 mt-7 max-w-[520px] text-[17px] leading-[1.75] text-white/62">
              Neighbors group the same home service request. Providers compete
              for the whole block. Everyone gets a better deal — without
              negotiating alone.
            </p>

            <div className="fade-up fade-up-3 mt-8 flex flex-wrap items-center gap-4">
              <Link href="/get-started">
                <Button
                  as="span"
                  variant="amber"
                  className="h-13 px-8 text-[15px] shadow-2xl shadow-amber-900/30"
                  style={{ height: "52px" } as React.CSSProperties}
                >
                  Get started free
                </Button>
              </Link>
              <a
                href="#how-it-works"
                className="flex items-center gap-1.5 text-[14px] font-medium text-white/50 transition-colors hover:text-white"
              >
                See how it works
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m9 18 6-6-6-6" />
                </svg>
              </a>
            </div>

            {/* Stats */}
            <div className="fade-up fade-up-4 mt-12 flex items-stretch gap-0 divide-x divide-white/10">
              {stats.map((stat) => (
                <div key={stat.label} className="flex flex-col px-7 first:pl-0">
                  <p
                    className="font-display text-[2.1rem] font-bold italic leading-none"
                    style={{ color: stat.amber ? "#f59e0b" : "#ffffff" }}
                  >
                    {stat.value}
                  </p>
                  <p className="mt-1.5 text-[11px] uppercase tracking-[0.15em] text-white/45">
                    {stat.label}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* RIGHT */}
          <div className="slide-right fade-up-2">
            <LiveBiddingPreview />
          </div>
        </div>
      </div>

      {/* Clean bottom edge — no gap-creating gradient */}
      <div
        className="pointer-events-none absolute bottom-0 left-0 right-0 h-1"
        style={{ background: "#07111e" }}
      />
    </section>
  );
}
