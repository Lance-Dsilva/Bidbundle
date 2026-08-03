"use client";

import Link from "next/link";
import { useState } from "react";

import { AppPageHeader } from "@/components/layout/AppPageHeader";
import { ActivityCard } from "@/components/admin/ActivityCard";
import { useDemandForecast } from "@/hooks/useDemandForecast";
import type { DemandForecastResult } from "@/hooks/useDemandForecast";
import {
  mockAdminStats,
  mockCommunityMembers,
  mockRecentActivity,
} from "@/data/mock/mockAdminDashboard";

const metrics = [
  {
    value: mockAdminStats.totalMembers.toString(),
    label: "Total members",
    sub: "Oakwood Heights",
    color: "var(--teal-800)",
  },
  {
    value: mockAdminStats.activeBids.toString(),
    label: "Active bids",
    sub: "Group bids live now",
    color: "var(--gold-600)",
  },
  {
    value: `$${mockAdminStats.monthlySavings}`,
    label: "Saved this month",
    sub: "vs. solo quotes",
    color: "var(--orange-600)",
  },
  {
    value: mockCommunityMembers.filter(m => m.eligibility === "pending").length.toString(),
    label: "Pending review",
    sub: "Needs your action",
    color: "var(--danger-600)",
  },
];

export default function AdminDashboardPage() {
  const { getForecast, loading: forecastLoading } = useDemandForecast();
  const [forecast, setForecast] = useState<DemandForecastResult | null>(null);
  const pendingMembers = mockCommunityMembers.filter(m => m.eligibility === "pending");

  return (
    <div className="flex flex-col">
      <AppPageHeader
        title="Community Dashboard"
        subtitle={`${mockAdminStats.communityName} · Admin`}
        action={
          <Link
            href="/app/admin/community"
            className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-foreground px-4 text-[13px] font-semibold text-white shadow-sm transition-all hover:bg-foreground/85"
          >
            Manage community
          </Link>
        }
      />

      <div className="mx-auto w-full max-w-5xl px-4 py-7 pb-24">
        {/* KPI row */}
        <div className="mb-6 grid grid-cols-2 gap-3">
          {metrics.map((m) => (
            <div
              key={m.label}
              className="rounded-2xl bg-white p-4 shadow-card transition-all duration-200 hover:-translate-y-0.5 hover:shadow-card-hover"
            >
              <p
                className="font-display text-[1.6rem] font-bold italic leading-none"
                style={{ color: m.color }}
              >
                {m.value}
              </p>
              <p className="mt-2 text-[12px] font-semibold text-foreground">{m.label}</p>
              <p className="mt-0.5 text-[11px] text-muted">{m.sub}</p>
            </div>
          ))}
        </div>

        <div className="grid gap-5">
          {/* Activity feed */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[15px] font-semibold text-foreground">Recent activity</h2>
              <span className="text-[12px] text-muted">{mockRecentActivity.length} events</span>
            </div>
            <div className="space-y-2.5">
              {mockRecentActivity.map((item) => (
                <ActivityCard key={item.id} item={item} />
              ))}
            </div>
          </div>

          {/* Pending + quick links */}
          <div className="space-y-4">
            {pendingMembers.length > 0 && (
              <div className="rounded-2xl p-4" style={{ border: "1px solid var(--gold-100)", background: "var(--gold-50)" }}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-[13px] font-semibold" style={{ color: "var(--gold-600)" }}>
                      {pendingMembers.length} member{pendingMembers.length > 1 ? "s" : ""} pending review
                    </p>
                    <p className="mt-0.5 text-[11px]" style={{ color: "var(--gold-600)", opacity: 0.75 }}>
                      {pendingMembers.map(m => m.name).join(" and ")} need eligibility review.
                    </p>
                  </div>
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold" style={{ background: "var(--gold-100)", color: "var(--gold-600)" }}>
                    {pendingMembers.length}
                  </span>
                </div>
                <Link
                  href="/app/admin/community"
                  className="mt-3 inline-flex items-center gap-1 text-[12px] font-semibold transition"
                  style={{ color: "var(--gold-600)" }}
                >
                  Review eligibility →
                </Link>
              </div>
            )}

            {/* Quick links */}
            <div className="rounded-2xl border border-divider bg-white p-4 shadow-card">
              <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.15em] text-muted">Quick actions</p>
              <div className="space-y-1">
                {[
                  { href: "/app/admin/community", label: "Review member eligibility", icon: "👥" },
                  { href: "/app/admin/reports", label: "View savings reports", icon: "📊" },
                  { href: "/app/admin/profile", label: "HOA settings", icon: "⚙️" },
                ].map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] text-foreground transition-all hover:bg-canvas hover:translate-x-0.5"
                  >
                    <span className="text-base">{item.icon}</span>
                    {item.label}
                    <svg className="ml-auto h-3.5 w-3.5 text-muted" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="m9 18 6-6-6-6" />
                    </svg>
                  </Link>
                ))}
              </div>
            </div>

            {/* Savings snapshot */}
            <div
              className="grain rounded-2xl p-5 text-center"
              style={{ background: "linear-gradient(135deg, var(--navy-900) 0%, var(--navy-700) 100%)" }}
            >
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/35">All-time savings</p>
              <p className="mt-1 font-display text-[2.4rem] font-bold italic leading-none" style={{ color: "var(--gold-500)" }}>
                ${mockAdminStats.totalSavingsAllTime.toLocaleString()}
              </p>
              <p className="mt-1 text-[12px] text-white/40">Oakwood Heights HOA</p>
              <Link
                href="/app/admin/reports"
                className="mt-3 inline-flex items-center gap-1 rounded-full bg-white/10 px-3 py-1.5 text-[11px] font-semibold text-white/70 transition hover:bg-white/15"
              >
                View full report →
              </Link>
            </div>

            <div className="rounded-2xl border border-divider bg-white p-4 shadow-card">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-muted">Demand forecast</p>
                {!forecast ? (
                  <button
                    className="inline-flex h-6 items-center gap-1 rounded-full bg-[var(--terracotta-50)] px-2.5 text-[11px] font-semibold text-[var(--terracotta-600)] transition hover:bg-[var(--terracotta-100)]"
                    disabled={forecastLoading}
                    onClick={async () => {
                      const result = await getForecast();
                      if (result) setForecast(result);
                    }}
                  >
                    {forecastLoading ? "Loading…" : "✦ Run forecast"}
                  </button>
                ) : (
                  <button className="text-[12px] text-muted transition hover:text-foreground" onClick={() => setForecast(null)}>
                    Reset
                  </button>
                )}
              </div>

              {!forecast ? (
                <p className="text-[12px] text-muted">
                  See which services your neighbors will need most in the next 30 days.
                </p>
              ) : (
                <div className="space-y-2">
                  {forecast.predictions.slice(0, 3).map((p, i) => (
                    <div key={i} className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[13px] font-semibold capitalize text-foreground">{p.category}</span>
                        {p.provider_shortage && (
                          <span className="rounded-full bg-[var(--terracotta-50)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--terracotta-600)]">shortage</span>
                        )}
                      </div>
                      <div className="text-right">
                        <span className="text-[13px] font-bold text-foreground">{p.predicted_requests}</span>
                        <span className="ml-1 text-[11px] text-muted">req</span>
                      </div>
                    </div>
                  ))}
                  {forecast.stub && <p className="text-[11px] text-muted">Estimate only — AI unavailable.</p>}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
