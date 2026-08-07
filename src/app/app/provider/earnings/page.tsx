"use client";

import { useMemo, useRef, useState } from "react";
import { useDemandForecast } from "@/hooks/useDemandForecast";
import { useProviderEarnings } from "@/hooks/useProviderEarnings";
import { useProviderBids } from "@/hooks/useProviderBids";

function IconSpark() { return <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l1.8 5L19 9.8 14 11.6 12 17l-1.8-5.4L5 9.8 10.2 8z"/></svg>; }

const card = { background: "var(--bg-card)", border: "1px solid var(--border-warm)", borderRadius: 18, boxShadow: "var(--shadow-warm-sm)" } as const;

function centsToDollars(cents: number) {
  return Math.round(cents / 100);
}

function fmtMoney(cents: number) {
  return `$${centsToDollars(cents).toLocaleString()}`;
}

function monthKey(date: Date) {
  return `${date.getFullYear()}-${date.getMonth()}`;
}

function stateChip(state: string) {
  const styles: Record<string, { bg: string; color: string; label: string }> = {
    pending: { bg: "var(--gold-50)", color: "var(--gold-600)", label: "Pending" },
    accepted: { bg: "var(--sage-50)", color: "var(--sage-700)", label: "Booked" },
    declined: { bg: "var(--cream-100)", color: "var(--ink-500)", label: "Declined" },
    lost: { bg: "var(--cream-100)", color: "var(--ink-500)", label: "Lost" },
  };
  return styles[state] ?? { bg: "var(--cream-100)", color: "var(--ink-500)", label: state };
}

export default function ProviderEarningsPage() {
  const { earnings, loading: earningsLoading } = useProviderEarnings();
  const { bids, loading: bidsLoading } = useProviderBids();
  const { getForecast, loading: forecastLoading } = useDemandForecast();
  const [showTaxDocs, setShowTaxDocs] = useState(false);
  const [forecastOpen, setForecastOpen] = useState(false);
  const [forecastError, setForecastError] = useState<string | null>(null);
  const [forecast, setForecast] = useState<Awaited<ReturnType<typeof getForecast>>>(null);
  const forecastRef = useRef<HTMLDivElement>(null);

  const {
    acceptedBids,
    pendingBids,
    declinedBids,
    sixMonthSeries,
    maxSeriesCents,
    tradeBreakdown,
    winRatePct,
    ytdGrossCents,
    ytdNetCents,
    nextPipelineCents,
    monthlyGoalCents,
    forecastMonthCents,
    currentMonthName,
    currentMonthIndex,
    totalBidCount,
    primaryNeighborhood,
  } = useMemo(() => {
    const now = new Date();
    const accepted = bids.filter((bid) => bid.status === "accepted");
    const pending = bids.filter((bid) => bid.status === "pending");
    const declined = bids.filter((bid) => bid.status === "declined" || bid.status === "lost");

    const months = Array.from({ length: 6 }, (_, offset) => {
      const date = new Date(now.getFullYear(), now.getMonth() - (5 - offset), 1);
      return {
        key: monthKey(date),
        label: date.toLocaleDateString("en-US", { month: "short" }),
        cents: 0,
      };
    });
    const monthLookup = new Map(months.map((month) => [month.key, month]));
    for (const bid of accepted) {
      const createdAt = new Date(bid.created_at);
      const bucket = monthLookup.get(monthKey(createdAt));
      if (bucket) bucket.cents += bid.amount;
    }

    const tradeMap = new Map<string, number>();
    for (const bid of accepted) {
      const label = bid.request_category || "other";
      tradeMap.set(label, (tradeMap.get(label) ?? 0) + bid.amount);
    }
    const grossAccepted = accepted.reduce((sum, bid) => sum + bid.amount, 0);
    const trades = Array.from(tradeMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([trade, cents]) => ({
        trade,
        cents,
        share: grossAccepted > 0 ? cents / grossAccepted : 0,
      }));

    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const ytdAccepted = accepted.filter((bid) => new Date(bid.created_at) >= startOfYear);
    const ytdGross = ytdAccepted.reduce((sum, bid) => sum + bid.amount, 0);
    const ytdNet = Math.round(ytdGross * 0.9);

    const resolvedCount = accepted.length + declined.length;
    const winRate = resolvedCount > 0 ? (accepted.length / resolvedCount) * 100 : null;

    const elapsedDays = Math.max(now.getDate(), 1);
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const thisMonthCents = earnings?.this_month_cents ?? 0;
    const forecast = elapsedDays > 0 ? Math.round((thisMonthCents / elapsedDays) * daysInMonth) : 0;
    const goal = Math.max(Math.round(Math.max(thisMonthCents, forecast) * 1.15), 100000);
    const pipeline = pending.reduce((sum, bid) => sum + bid.amount, 0);
    const neighborhoodCounts = new Map<string, number>();
    for (const bid of bids) {
      neighborhoodCounts.set(bid.request_neighborhood, (neighborhoodCounts.get(bid.request_neighborhood) ?? 0) + 1);
    }
    const topNeighborhood = Array.from(neighborhoodCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Historic South-Central";

    return {
      acceptedBids: accepted,
      pendingBids: pending,
      declinedBids: declined,
      sixMonthSeries: months,
      maxSeriesCents: Math.max(...months.map((month) => month.cents), 1),
      tradeBreakdown: trades,
      winRatePct: winRate,
      ytdGrossCents: ytdGross,
      ytdNetCents: ytdNet,
      nextPipelineCents: pipeline,
      monthlyGoalCents: goal,
      forecastMonthCents: forecast,
      currentMonthName: now.toLocaleDateString("en-US", { month: "long" }),
      currentMonthIndex: now.getMonth(),
      totalBidCount: bids.length,
      primaryNeighborhood: topNeighborhood,
    };
  }, [bids, earnings]);

  const loading = earningsLoading || bidsLoading;
  const currentMonthRatio = monthlyGoalCents > 0 ? Math.min((earnings?.this_month_cents ?? 0) / monthlyGoalCents, 1) : 0;
  const revenueThisMonth = fmtMoney(earnings?.this_month_cents ?? 0);
  const avgJobValue = fmtMoney(earnings?.avg_job_value_cents ?? 0);
  const thisMonthRemaining = Math.max(monthlyGoalCents - (earnings?.this_month_cents ?? 0), 0);
  const chartHeadline = earnings ? fmtMoney(earnings.total_cents) : "$0";
  const chartSubline = earnings
    ? `Net after fees: ${fmtMoney(Math.round(earnings.total_cents * 0.9))} · ${earnings.jobs_total} jobs · avg ${avgJobValue}/job`
    : "No accepted jobs yet";
  const estimatedTaxSetAsideCents = Math.round(ytdNetCents * 0.24);

  function downloadCsv() {
    const rows = [
      ["bid_id", "date", "request_title", "neighborhood", "category", "status", "amount_usd", "estimated_days"],
      ...bids.map((bid) => [
        String(bid.id),
        new Date(bid.created_at).toISOString(),
        bid.request_title,
        bid.request_neighborhood,
        bid.request_category,
        bid.status,
        String(centsToDollars(bid.amount)),
        String(bid.estimated_days),
      ]),
    ];
    const csv = rows
      .map((row) => row.map((value) => `"${String(value).replaceAll("\"", "\"\"")}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `bundleen-provider-earnings-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function openForecast() {
    setForecastOpen(true);
    setForecastError(null);
    const result = await getForecast(primaryNeighborhood);
    if (!result) {
      setForecastError("Could not load forecast right now.");
      return;
    }
    setForecast(result);
    forecastRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  return (
    <div style={{ background: "var(--bg-app)", minHeight: "100vh" }}>
      <div className="flex flex-col gap-4 px-4 pb-4 pt-6 md:flex-row md:items-end md:justify-between md:px-9 md:pb-5 md:pt-7">
        <div>
          <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 500, fontSize: "clamp(24px, 6vw, 30px)", letterSpacing: "-0.02em", margin: "0 0 4px", color: "var(--ink-900)" }}>Earnings</h1>
          <p style={{ margin: 0, color: "var(--ink-500)", fontSize: 14 }}>
            {loading ? "Loading earnings…" : `${earnings?.jobs_total ?? 0} booked jobs · ${revenueThisMonth} this month`}
          </p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={downloadCsv} style={{ display: "inline-flex", alignItems: "center", height: 38, padding: "0 16px", borderRadius: 999, fontSize: 14, fontWeight: 600, cursor: "pointer", background: "transparent", color: "var(--ink-700)", border: "1px solid var(--border-warm-strong)", fontFamily: "var(--font-body)" }}>Download CSV</button>
          <button onClick={() => setShowTaxDocs(true)} style={{ display: "inline-flex", alignItems: "center", height: 38, padding: "0 16px", borderRadius: 999, fontSize: 14, fontWeight: 600, cursor: "pointer", background: "var(--cream-100)", color: "var(--ink-900)", border: 0, fontFamily: "var(--font-body)" }}>Tax docs</button>
          <button onClick={() => void openForecast()} disabled={forecastLoading} style={{ display: "inline-flex", alignItems: "center", gap: 8, height: 38, padding: "0 16px", borderRadius: 999, fontSize: 14, fontWeight: 600, cursor: forecastLoading ? "default" : "pointer", background: "var(--terracotta-600)", color: "white", border: 0, fontFamily: "var(--font-body)", opacity: forecastLoading ? 0.7 : 1 }}><IconSpark /> {forecastLoading ? "Loading…" : "Forecast"}</button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 px-4 pb-8 md:px-9 md:pb-9 lg:grid-cols-[1fr_320px] lg:gap-[22px]">
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ ...card, padding: 22 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
              <div>
                <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.10em", color: "var(--ink-400)", fontWeight: 600 }}>Gross revenue · 6 mo</div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginTop: 8, flexWrap: "wrap" }}>
                  <div style={{ fontFamily: "var(--font-display)", fontWeight: 500, fontSize: 48, color: "var(--terracotta-600)", lineHeight: 1, letterSpacing: "-0.02em" }}>{chartHeadline}</div>
                  {winRatePct !== null ? (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, height: 24, padding: "0 10px", borderRadius: 999, fontSize: 12, fontWeight: 600, background: "var(--sage-50)", color: "var(--sage-700)" }}>
                      <span style={{ width: 6, height: 6, borderRadius: 3, background: "currentColor" }} /> {winRatePct.toFixed(0)}% win rate
                    </span>
                  ) : null}
                </div>
                <div style={{ fontSize: 13, color: "var(--ink-500)", marginTop: 4 }}>{chartSubline}</div>
              </div>
              <div style={{ display: "flex", background: "var(--cream-100)", borderRadius: 10, padding: 3 }}>
                {["Week", "30d", "6mo", "Year"].map((v, i) => (
                  <button key={v} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", height: 28, padding: "0 10px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer", border: 0, background: i === 2 ? "white" : "transparent", color: "var(--ink-700)", boxShadow: i === 2 ? "var(--shadow-warm-sm)" : "none", fontFamily: "var(--font-body)" }}>{v}</button>
                ))}
              </div>
            </div>

            {sixMonthSeries.every((month) => month.cents <= 0) ? (
              <div
                style={{
                  marginTop: 24,
                  padding: "36px 24px",
                  borderRadius: 14,
                  background: "var(--cream-50)",
                  border: "1px dashed var(--border-warm-strong)",
                  textAlign: "center",
                }}
              >
                <div style={{ fontSize: 28, marginBottom: 10 }} aria-hidden>📈</div>
                <div style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 500, color: "var(--ink-900)" }}>
                  Your first booking will appear here
                </div>
                <div style={{ fontSize: 13, color: "var(--ink-500)", marginTop: 6, lineHeight: 1.5 }}>
                  Win a bid and this chart starts tracking your revenue month by month.
                </div>
                <a
                  href="/app/provider/job-feed"
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 8, marginTop: 16,
                    height: 38, padding: "0 18px", borderRadius: 999,
                    fontSize: 14, fontWeight: 600,
                    background: "var(--terracotta-600)", color: "white", textDecoration: "none",
                  }}
                >
                  Browse jobs →
                </a>
              </div>
            ) : (
            <div style={{ marginTop: 24, height: 220, display: "flex", alignItems: "flex-end", gap: 18, position: "relative" }}>
              <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", justifyContent: "space-between", pointerEvents: "none" }}>
                {[maxSeriesCents, Math.round(maxSeriesCents * 0.66), Math.round(maxSeriesCents * 0.33), 0].map((value, gridIndex) => (
                  <div key={gridIndex} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 10, color: "var(--ink-400)", width: 42 }}>{fmtMoney(value)}</span>
                    <div style={{ flex: 1, borderTop: "1px dashed var(--border-warm)" }} />
                  </div>
                ))}
              </div>
              <div style={{ width: 42 }} />
              {sixMonthSeries.map((month, index) => (
                <div key={month.key} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 8, position: "relative", zIndex: 1 }}>
                  <div style={{ width: "100%", display: "flex", alignItems: "flex-end", height: 200 }}>
                    <div
                      style={{
                        flex: 1,
                        height: `${Math.max((month.cents / maxSeriesCents) * 90, month.cents > 0 ? 8 : 0)}%`,
                        background: index === sixMonthSeries.length - 1
                          ? "linear-gradient(to top, var(--terracotta-600), var(--terracotta-400))"
                          : "linear-gradient(to top, var(--cream-300), var(--terracotta-100))",
                        borderRadius: "8px 8px 0 0",
                        position: "relative",
                      }}
                    >
                      {index === sixMonthSeries.length - 1 && month.cents > 0 ? (
                        <div style={{ position: "absolute", top: -32, left: "50%", transform: "translateX(-50%)", background: "var(--ink-900)", color: "white", padding: "4px 8px", borderRadius: 6, fontSize: 11, whiteSpace: "nowrap" }}>
                          {fmtMoney(month.cents)}
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--ink-500)", fontWeight: 600 }}>{month.label}</div>
                </div>
              ))}
            </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-[1.5fr_1fr] md:gap-[18px]">
            <div style={{ ...card, padding: 22 }}>
              <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.10em", color: "var(--ink-400)", fontWeight: 600 }}>Revenue by trade</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 14 }}>
                {tradeBreakdown.length === 0 ? (
                  <div style={{ fontSize: 13, color: "var(--ink-500)" }}>No booked jobs yet, so trade revenue will appear here once a homeowner accepts your bid.</div>
                ) : tradeBreakdown.map((item) => (
                  <div key={item.trade}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, gap: 12 }}>
                      <span style={{ fontWeight: 600, color: "var(--ink-900)", textTransform: "capitalize" }}>{item.trade}</span>
                      <span>
                        <span style={{ fontFamily: "var(--font-display)", fontWeight: 500 }}>{fmtMoney(item.cents)}</span>
                        <span style={{ color: "var(--ink-500)", marginLeft: 6 }}>{Math.round(item.share * 100)}%</span>
                      </span>
                    </div>
                    <div style={{ height: 8, background: "var(--cream-200)", borderRadius: 999, marginTop: 6, overflow: "hidden" }}>
                      <div style={{ width: `${item.share * 100}%`, height: "100%", background: "var(--terracotta-500)", borderRadius: 999 }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ ...card, padding: 22 }}>
              <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.10em", color: "var(--ink-400)", fontWeight: 600 }}>Win/loss</div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", marginTop: 14, position: "relative" }}>
                <svg width="160" height="160" viewBox="0 0 160 160">
                  <circle cx="80" cy="80" r="60" fill="none" stroke="var(--cream-200)" strokeWidth="20" />
                  <circle
                    cx="80"
                    cy="80"
                    r="60"
                    fill="none"
                    stroke="var(--terracotta-500)"
                    strokeWidth="20"
                    strokeDasharray="377"
                    strokeDashoffset={377 - ((winRatePct ?? 0) / 100) * 377}
                    transform="rotate(-90 80 80)"
                    strokeLinecap="round"
                  />
                </svg>
                <div style={{ position: "absolute", textAlign: "center" }}>
                  <div style={{ fontFamily: "var(--font-display)", fontWeight: 500, fontSize: 32, color: "var(--terracotta-600)", lineHeight: 1, letterSpacing: "-0.02em" }}>{winRatePct !== null ? `${winRatePct.toFixed(0)}%` : "—"}</div>
                  <div style={{ fontSize: 11, color: "var(--ink-500)" }}>win rate</div>
                </div>
              </div>
              <div style={{ height: 1, background: "var(--border-warm)", margin: "12px 0" }} />
              <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12 }}>
                {[["Bids submitted", String(totalBidCount)], ["Won", String(acceptedBids.length)], ["Pending", String(pendingBids.length)]].map(([k, v]) => (
                  <div key={k} style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--ink-500)" }}>{k}</span>
                    <span style={{ fontWeight: 600, color: "var(--ink-900)" }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div style={{ ...card }}>
            <div style={{ padding: "18px 22px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.10em", color: "var(--ink-400)", fontWeight: 600 }}>Transactions</div>
              <div style={{ fontSize: 12, color: "var(--ink-500)" }}>{acceptedBids.length} booked transaction{acceptedBids.length !== 1 ? "s" : ""}</div>
            </div>
            <div style={{ height: 1, background: "var(--border-warm)" }} />
            {acceptedBids.length === 0 ? (
              <div style={{ padding: "18px 22px", fontSize: 13, color: "var(--ink-500)" }}>
                No confirmed earnings activity yet. Accepted homeowner bookings will appear here after a bid is confirmed.
              </div>
            ) : acceptedBids.map((bid, index) => {
              const chip = stateChip(bid.status);
              return (
                <div key={bid.id} className="flex flex-wrap items-center gap-3 px-4 py-3 md:px-[22px]" style={{ borderTop: index ? "1px solid var(--border-warm)" : "0" }}>
                  <div style={{ fontFamily: "var(--font-display)", fontWeight: 500, fontSize: 12, color: "var(--ink-500)", width: 52, flexShrink: 0 }}>
                    {new Date(bid.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </div>
                  <div style={{ flex: 1, minWidth: 130 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: "var(--ink-900)" }}>{bid.request_title}</div>
                    <div style={{ fontSize: 11, color: "var(--ink-500)" }}>{bid.request_neighborhood} · {bid.request_category}</div>
                  </div>
                  <span style={{ display: "inline-flex", alignItems: "center", height: 20, padding: "0 8px", borderRadius: 999, fontSize: 11, fontWeight: 600, background: chip.bg, color: chip.color }}>{chip.label}</span>
                  <div style={{ fontFamily: "var(--font-display)", fontWeight: 500, fontSize: 16, color: bid.status === "accepted" ? "var(--sage-700)" : "var(--ink-900)", textAlign: "right", minWidth: 88, letterSpacing: "-0.02em" }}>
                    {fmtMoney(bid.amount)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ borderRadius: 18, padding: 22, background: "linear-gradient(160deg, var(--terracotta-600), var(--terracotta-500))", color: "white", border: 0 }}>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.75)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600 }}>Pending pipeline</div>
            <div style={{ fontFamily: "var(--font-display)", fontWeight: 500, fontSize: 38, marginTop: 6, letterSpacing: "-0.02em" }}>{fmtMoney(nextPipelineCents)}</div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.85)" }}>{pendingBids.length} pending bid{pendingBids.length !== 1 ? "s" : ""} awaiting homeowner decision</div>
            <div style={{ borderTop: "1px solid rgba(255,255,255,0.2)", margin: "14px 0", paddingTop: 0 }} />
            <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
              {[["Booked revenue", fmtMoney(earnings?.total_cents ?? 0)], ["This month", revenueThisMonth], ["Avg job", avgJobValue]].map(([k, v]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "rgba(255,255,255,0.75)" }}>{k}</span>
                  <span style={{ fontWeight: 600 }}>{v}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ ...card, padding: 22 }}>
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.10em", color: "var(--ink-400)", fontWeight: 600 }}>YTD summary</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12, fontSize: 12 }}>
              {[["Gross", fmtMoney(ytdGrossCents)], ["Net estimate", fmtMoney(ytdNetCents)], ["Booked jobs", String(acceptedBids.length)], ["Open bids", String(pendingBids.length)]].map(([k, v]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--ink-500)" }}>{k}</span>
                  <span style={{ fontWeight: 600, color: "var(--ink-900)" }}>{v}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ ...card, padding: 22 }}>
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.10em", color: "var(--ink-400)", fontWeight: 600 }}>Goal · {currentMonthName}</div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 8 }}>
              <span style={{ fontFamily: "var(--font-display)", fontWeight: 500, fontSize: 22, letterSpacing: "-0.02em", color: "var(--ink-900)" }}>{revenueThisMonth}</span>
              <span style={{ fontSize: 12, color: "var(--ink-500)" }}>of {fmtMoney(monthlyGoalCents)}</span>
            </div>
            <div style={{ height: 6, borderRadius: 999, background: "var(--cream-200)", overflow: "hidden", marginTop: 10 }}>
              <div style={{ height: "100%", width: `${currentMonthRatio * 100}%`, background: "linear-gradient(90deg, var(--sage-500), var(--sage-700))", borderRadius: 999 }} />
            </div>
            <div style={{ fontSize: 11, color: "var(--sage-700)", fontWeight: 600, marginTop: 6 }}>{fmtMoney(thisMonthRemaining)} to go this month</div>
          </div>

          <div ref={forecastRef} style={{ ...card, padding: 22, background: forecastOpen ? "var(--cream-100)" : "var(--bg-card)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ color: "var(--terracotta-600)" }}><IconSpark /></span>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 16, fontWeight: 500, color: "var(--ink-900)" }}>Forecast</div>
            </div>
            {!forecastOpen ? (
              <>
                <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--ink-700)", lineHeight: 1.5 }}>
                  Based on your {currentMonthName.toLowerCase()} pace, you&apos;re on track for{" "}
                  <strong style={{ color: "var(--terracotta-600)" }}>{fmtMoney(forecastMonthCents)}</strong>{" "}
                  this month.
                </p>
                <div style={{ fontSize: 11, color: "var(--ink-500)", marginTop: 8 }}>
                  Month index: {currentMonthIndex + 1} · accepted jobs this month: {earnings?.jobs_this_month ?? 0}
                </div>
              </>
            ) : forecast ? (
              <>
                <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--ink-500)" }}>
                  {forecast.neighborhood} · {forecast.forecast_period}
                  {forecast.stub ? " · estimate only" : ""}
                </p>
                <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                  {forecast.predictions.slice(0, 4).map((prediction) => (
                    <div key={prediction.category} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, paddingTop: 8, borderTop: "1px solid var(--border-warm)" }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-900)", textTransform: "capitalize" }}>{prediction.category}</div>
                        <div style={{ fontSize: 11, color: "var(--ink-500)" }}>{prediction.reasoning}</div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--ink-900)" }}>{prediction.predicted_requests}</div>
                        <div style={{ fontSize: 11, color: prediction.provider_shortage ? "var(--terracotta-600)" : "var(--ink-500)" }}>
                          {prediction.provider_shortage ? "provider shortage" : prediction.confidence}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <p style={{ margin: "12px 0 0", fontSize: 12, color: "var(--ink-700)", lineHeight: 1.5, fontStyle: "italic" }}>{forecast.top_opportunity}</p>
              </>
            ) : (
              <div style={{ fontSize: 12, color: "var(--terracotta-600)", marginTop: 8 }}>{forecastError ?? "Loading forecast…"}</div>
            )}
          </div>
        </div>
      </div>
      {showTaxDocs ? (
        <div
          onClick={() => setShowTaxDocs(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(20,16,12,0.24)", display: "grid", placeItems: "center", padding: 24, zIndex: 50 }}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={{ width: "min(560px, 100%)", background: "var(--bg-card)", borderRadius: 22, border: "1px solid var(--border-warm)", boxShadow: "var(--shadow-warm-lg)", padding: 24 }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
              <div>
                <div style={{ fontFamily: "var(--font-display)", fontSize: 24, fontWeight: 500, color: "var(--ink-900)" }}>Tax docs</div>
                <div style={{ fontSize: 13, color: "var(--ink-500)", marginTop: 4 }}>Live provider tax summary based on booked revenue.</div>
              </div>
              <button onClick={() => setShowTaxDocs(false)} style={{ background: "transparent", border: 0, fontSize: 20, lineHeight: 1, cursor: "pointer", color: "var(--ink-500)" }}>×</button>
            </div>
            <div style={{ marginTop: 18, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              {[
                ["YTD gross", fmtMoney(ytdGrossCents)],
                ["YTD net estimate", fmtMoney(ytdNetCents)],
                ["Estimated tax set-aside", fmtMoney(estimatedTaxSetAsideCents)],
                ["Booked jobs", String(acceptedBids.length)],
              ].map(([label, value]) => (
                <div key={label} style={{ ...card, padding: 16, boxShadow: "none" }}>
                  <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ink-400)", fontWeight: 600 }}>{label}</div>
                  <div style={{ marginTop: 8, fontFamily: "var(--font-display)", fontSize: 28, fontWeight: 500, color: "var(--ink-900)" }}>{value}</div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 16, fontSize: 12, color: "var(--ink-500)", lineHeight: 1.5 }}>
              Working summary, not a filed tax document — export transactions with Download CSV for your accountant.
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
