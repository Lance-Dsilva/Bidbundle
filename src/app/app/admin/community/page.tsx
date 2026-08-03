"use client";

import { useState } from "react";

import { AppPageHeader } from "@/components/layout/AppPageHeader";
import { MemberCard } from "@/components/admin/MemberCard";
import {
  mockCommunityMembers,
  type CommunityMember,
} from "@/data/mock/mockAdminDashboard";

const filters: Array<{
  label: string;
  value: "all" | CommunityMember["eligibility"];
  count?: number;
}> = [
  { label: "All", value: "all", count: mockCommunityMembers.length },
  { label: "Verified", value: "verified", count: mockCommunityMembers.filter(m => m.eligibility === "verified").length },
  { label: "Pending", value: "pending", count: mockCommunityMembers.filter(m => m.eligibility === "pending").length },
  { label: "Ineligible", value: "ineligible", count: mockCommunityMembers.filter(m => m.eligibility === "ineligible").length },
];

export default function AdminCommunityPage() {
  const [activeFilter, setActiveFilter] = useState<"all" | CommunityMember["eligibility"]>("all");

  const filteredMembers =
    activeFilter === "all"
      ? mockCommunityMembers
      : mockCommunityMembers.filter((m) => m.eligibility === activeFilter);

  const pendingCount = mockCommunityMembers.filter((m) => m.eligibility === "pending").length;

  return (
    <div className="flex flex-col">
      <AppPageHeader
        title="Community"
        subtitle={`${mockCommunityMembers.length} members · ${pendingCount} pending review`}
      />
    <div className="mx-auto w-full min-w-0 max-w-3xl px-4 py-7 pb-24">

      {/* Pending alert */}
      {pendingCount > 0 && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-3.5" style={{ border: "1px solid var(--gold-100)", background: "var(--gold-50)" }}>
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold" style={{ background: "var(--gold-100)", color: "var(--gold-600)" }}>
              {pendingCount}
            </div>
            <div>
              <p className="text-[13px] font-semibold" style={{ color: "var(--gold-600)" }}>{pendingCount} members need eligibility review</p>
              <p className="text-[11px]" style={{ color: "var(--gold-600)", opacity: 0.75 }}>Review and approve or decline below</p>
            </div>
          </div>
          <button
            className="shrink-0 text-[12px] font-semibold transition"
            style={{ color: "var(--gold-600)" }}
            type="button"
            onClick={() => setActiveFilter("pending")}
          >
            View pending →
          </button>
        </div>
      )}

      {/* Filter tabs */}
      <div className="mb-5 flex flex-wrap gap-2 pb-1">
        {filters.map((filter) => {
          const isActive = filter.value === activeFilter;
          return (
            <button
              key={filter.value}
              className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-4 py-1.5 text-[12px] font-semibold transition-all ${
                isActive
                  ? "bg-foreground text-white shadow-sm"
                  : "border border-divider bg-card text-muted hover:border-foreground/20 hover:text-foreground"
              }`}
              type="button"
              onClick={() => setActiveFilter(filter.value)}
            >
              {filter.label}
              {filter.count !== undefined && (
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none ${
                  isActive ? "bg-white/20 text-white" : "bg-foreground/8 text-muted"
                }`}>
                  {filter.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Members list */}
      <div className="space-y-3">
        {filteredMembers.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-divider bg-card p-8 text-center shadow-card">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted/10">
              <svg className="h-5 w-5 text-muted" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                <circle cx="9" cy="7" r="4" /><path strokeLinecap="round" d="M2.5 21a6.5 6.5 0 0 1 13 0" />
              </svg>
            </div>
            <p className="text-[14px] font-semibold text-foreground">
              No {activeFilter === "all" ? "" : activeFilter + " "}members
            </p>
            <p className="text-[12px] text-muted">Nothing here yet.</p>
          </div>
        ) : (
          filteredMembers.map((member) => <MemberCard key={member.id} member={member} />)
        )}
      </div>
    </div>
    </div>
  );
}
