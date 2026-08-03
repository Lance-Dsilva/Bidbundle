"use client";

import { useState } from "react";

import type { CommunityMember } from "@/data/mock/mockAdminDashboard";

interface MemberCardProps {
  member: CommunityMember;
}

const eligibilityConfig: Record<CommunityMember["eligibility"], { bg: string; text: string; label: string; dot: string }> = {
  verified:   { bg: "bg-emerald-50", text: "text-emerald-700", label: "Verified", dot: "bg-emerald-500" },
  pending:    { bg: "bg-amber-50",   text: "text-amber-700",   label: "Pending",  dot: "bg-amber-500" },
  ineligible: { bg: "bg-red-50",     text: "text-red-600",     label: "Ineligible", dot: "bg-red-500" },
};

export function MemberCard({ member }: MemberCardProps) {
  const [eligibility, setEligibility] = useState(member.eligibility);
  const cfg = eligibilityConfig[eligibility];

  return (
    <article className="rounded-2xl border border-divider bg-card p-4 shadow-card transition-all hover:shadow-card-hover">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-primary/10 text-[13px] font-semibold text-primary">
          {member.name.charAt(0).toUpperCase()}
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold text-foreground">{member.name}</p>
          <p className="mt-0.5 text-[12px] text-muted">
            {member.address} · {member.joinDate}
          </p>
        </div>

        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${cfg.bg} ${cfg.text}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
          {cfg.label}
        </span>
      </div>

      {eligibility === "pending" && (
        <div className="mt-3.5 flex items-center gap-2.5 border-t border-divider pt-3.5">
          {/* Primary action: Approve */}
          <button
            className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl bg-foreground text-[12px] font-semibold text-white shadow-sm transition-all hover:bg-foreground/85 active:scale-[0.98]"
            type="button"
            onClick={() => setEligibility("verified")}
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="m5 12 5 5L19 8" />
            </svg>
            Approve
          </button>
          {/* Secondary action: Decline */}
          <button
            className="flex h-9 items-center justify-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-4 text-[12px] font-semibold text-red-600 transition-all hover:bg-red-100 active:scale-[0.98]"
            type="button"
            onClick={() => setEligibility("ineligible")}
          >
            Decline
          </button>
        </div>
      )}
    </article>
  );
}
