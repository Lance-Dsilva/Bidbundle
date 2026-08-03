"use client";

import { useRouter } from "next/navigation";

const settingsItems = [
  { label: "Payment method", subtitle: "Visa •••• 4242" },
  { label: "Notifications", subtitle: "Push & Email on" },
  { label: "Address & service area", subtitle: "123 Maple St" },
  { label: "Help & support", subtitle: "FAQ, Contact" },
  { label: "About BidBundle", subtitle: "v1.1.0" },
];

export function SettingsMenu() {
  const router = useRouter();

  return (
    <div>
      <div className="overflow-hidden rounded-card bg-card shadow-card divide-y divide-divider">
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
  );
}
