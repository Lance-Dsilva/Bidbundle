"use client";

import { useRouter } from "next/navigation";

import { mockAdminStats } from "@/data/mock/mockAdminDashboard";

const settingsItems = [
  { label: "Community settings", subtitle: "Eligibility rules" },
  { label: "Notifications", subtitle: "Push & Email on" },
  { label: "Address & area", subtitle: "Oakwood Heights" },
  { label: "Help & support", subtitle: "FAQ, Contact" },
  { label: "About Bundleen", subtitle: "v1.1.0" },
];

const profileStats = [
  { label: "Members", value: mockAdminStats.totalMembers.toString() },
  { label: "Active bids", value: mockAdminStats.activeBids.toString() },
  { label: "Saved", value: `$${mockAdminStats.monthlySavings}` },
];

export default function AdminProfilePage() {
  const router = useRouter();

  return (
    <div className="mx-auto max-w-lg space-y-4 px-5 py-6 pb-24">
      <h1 className="text-xl font-bold text-foreground">Profile</h1>

      <section className="rounded-card bg-surface p-5 text-white shadow-card">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-base font-bold text-white shadow-sm">
            {mockAdminStats.adminInitials}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-base font-semibold text-white">{mockAdminStats.adminName}</p>
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-white/70">
                Admin
              </span>
            </div>
            <p className="mt-0.5 text-xs text-white/60">{mockAdminStats.communityName}</p>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-3 divide-x divide-divider rounded-card bg-card p-4 text-center shadow-card">
        {profileStats.map((stat) => (
          <div key={stat.label}>
            <p className="text-lg font-bold text-foreground">{stat.value}</p>
            <p className="mt-0.5 text-[10px] uppercase tracking-wide text-muted">{stat.label}</p>
          </div>
        ))}
      </section>

      <div>
        <div className="divide-y divide-divider overflow-hidden rounded-card bg-card shadow-card">
          {settingsItems.map((item) => (
            <button
              key={item.label}
              className="flex w-full items-center justify-between px-4 py-3.5 text-left transition-colors hover:bg-canvas active:bg-canvas/50"
              type="button"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">{item.label}</p>
                <p className="mt-0.5 text-xs text-muted">{item.subtitle}</p>
              </div>
              <svg
                aria-hidden="true"
                className="h-4 w-4 shrink-0 text-muted/60"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="m9 18 6-6-6-6" />
              </svg>
            </button>
          ))}
        </div>

        <button
          className="mt-1 w-full rounded-xl py-4 text-center text-sm font-medium text-red-500 transition hover:bg-red-50 active:bg-red-100"
          type="button"
          onClick={() => router.push("/")}
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
