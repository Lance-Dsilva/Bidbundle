"use client";

import { Button } from "@/components/ui/Button";
import { StepProgress } from "@/components/onboarding/StepProgress";
import { PUBLIC_ROLES, type PublicRole } from "@/lib/validation/auth";

type RoleStepProps = {
  role: PublicRole;
  onBack: () => void;
  onContinue: () => void;
  onRoleChange: (role: PublicRole) => void;
  stepNumber?: number;
  stepCount?: number;
};

const roleContent: Record<PublicRole, {
  bg: string; abbr: string; title: string; subtitle: string; body: string; benefits: string[];
}> = {
  homeowner: {
    bg: "var(--terracotta-600)",
    abbr: "H",
    title: "Homeowner",
    subtitle: "I want to book services",
    body: "Join community bids and get group pricing on home services.",
    benefits: ["Join neighborhood group bids", "Track bookings end-to-end", "Chat with verified neighbors"],
  },
  provider: {
    bg: "var(--gold-500)",
    abbr: "P",
    title: "Service Provider",
    subtitle: "I provide services",
    body: "Get bulk job alerts, bid competitively, grow your business.",
    benefits: ["Alerts on new group jobs", "Bid competitively to win more work", "Build reputation with real reviews"],
  },
};

/**
 * The HOA Admin tile was removed from public sign-up.
 *
 * Admin accounts can approve members and read community-wide analytics, so
 * letting anyone self-assign the role at registration would have handed out
 * those powers to whoever picked the third card. The server enforces this
 * independently — `profileSetupSchema` only accepts `PUBLIC_ROLES` — so deleting
 * the tile is the UI half of a rule that holds even if this file is bypassed.
 * Admins are provisioned by an approved seed or migration instead.
 */
const roleOrder: readonly PublicRole[] = PUBLIC_ROLES;

function Check() {
  return (
    <svg aria-hidden="true" className="h-3 w-3" viewBox="0 0 20 20" fill="none">
      <path d="m5 10 3 3 7-7" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" />
    </svg>
  );
}

export function RoleStep({
  role,
  onBack,
  onContinue,
  onRoleChange,
  stepNumber = 2,
  stepCount = 3,
}: RoleStepProps) {
  const selectedContent = roleContent[role];

  return (
    <section className="py-6">
      <header className="relative pb-6">
        <button
          aria-label="Back"
          className="mb-3 flex h-10 w-10 items-center justify-center rounded-full text-[var(--ink-700)] transition hover:bg-[var(--cream-100)]"
          type="button"
          onClick={onBack}
        >
          <svg aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="m15 18-6-6 6-6" />
          </svg>
        </button>
        <StepProgress current={stepNumber} total={stepCount} />
        <h1 className="mt-2 font-display text-[2.4rem] font-bold italic tracking-tight text-[var(--ink-900)]">
          Choose your role
        </h1>
        <p className="mt-2 text-[14px] leading-6 text-[var(--ink-500)]">How will you use Bundleen?</p>
      </header>

      <div className="space-y-2.5">
        {roleOrder.map((roleOption) => {
          const c = roleContent[roleOption];
          const isSelected = roleOption === role;
          return (
            <button
              key={roleOption}
              aria-pressed={isSelected}
              className="relative flex w-full items-start gap-4 rounded-[24px] border-2 p-4 text-left transition-all duration-150"
              style={{
                background: isSelected ? "linear-gradient(180deg, #FFFFFF 0%, var(--terracotta-50) 100%)" : "white",
                borderColor: isSelected ? c.bg : "transparent",
                boxShadow: isSelected ? "0 12px 30px rgba(31,26,20,0.10)" : "var(--shadow-warm-sm)",
              }}
              type="button"
              onClick={() => onRoleChange(roleOption)}
            >
              <span
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl font-display text-sm font-bold italic text-white shadow-sm"
                style={{ background: c.bg }}
              >
                {c.abbr}
              </span>
              <span className="min-w-0 flex-1 pr-14">
                <span className="block text-[14px] font-semibold tracking-tight text-[var(--ink-900)]">
                  {c.title}
                </span>
                <span className="mt-0.5 block text-[12px] text-[var(--ink-500)]">{c.subtitle}</span>
                <span className="mt-1 block text-[12px] leading-5 text-[var(--ink-400)]">{c.body}</span>
              </span>
              {isSelected && (
                <span
                  className="absolute right-3 top-3 flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset"
                  style={{
                    background: `${c.bg}14`,
                    color: c.bg,
                    boxShadow: `inset 0 0 0 1px ${c.bg}30`,
                  }}
                >
                  <Check /> Selected
                </span>
              )}
            </button>
          );
        })}
      </div>

      <section className="mt-4 rounded-[24px] border bg-[var(--cream-50)] p-5" style={{ borderColor: "var(--border-warm)" }}>
        <h2 className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--ink-500)]">
          As a {selectedContent.title.toLowerCase()}
        </h2>
        <ul className="mt-2.5 space-y-2.5">
          {selectedContent.benefits.map((b) => (
            <li key={b} className="flex items-center gap-3 text-[13px] text-[var(--ink-900)]">
              <span
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
                style={{ background: `${selectedContent.bg}14`, color: selectedContent.bg }}
              >
                <Check />
              </span>
              {b}
            </li>
          ))}
        </ul>
      </section>

      <div className="mt-6">
        <div className="mb-3 flex items-center justify-between">
          <StepProgress current={2} total={stepCount} />
          <span className="text-[12px] text-[var(--ink-400)]">2 of {stepCount}</span>
        </div>
        <Button className="h-12 w-full rounded-full text-[14px] font-semibold" onClick={onContinue} variant="warm">
          Continue
        </Button>
      </div>
    </section>
  );
}
