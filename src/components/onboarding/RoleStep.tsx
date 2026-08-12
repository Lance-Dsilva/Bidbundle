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
  title: string;
  subtitle: string;
  body: string;
  benefits: string[];
}> = {
  homeowner: {
    title: "Homeowner",
    subtitle: "Book home services",
    body: "Join community bids and get group pricing on home services.",
    benefits: [
      "Join neighbourhood group bids",
      "Track bookings from start to finish",
      "Chat with verified neighbours",
    ],
  },
  provider: {
    title: "Service Provider",
    subtitle: "Provide services",
    body: "Get bulk job alerts, bid competitively, and grow your business.",
    benefits: [
      "Receive nearby bundled job alerts",
      "Bid competitively for grouped work",
      "Build trust with verified reviews",
    ],
  },
};

function Check({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 20 20" fill="none">
      <path d="m5 10 3 3 7-7" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" />
    </svg>
  );
}

function RoleIcon({ role, selected }: { role: PublicRole; selected: boolean }) {
  if (role === "homeowner") {
    return (
      <span className={`flex h-[70px] w-[70px] shrink-0 items-center justify-center rounded-2xl ${selected ? "bg-[linear-gradient(145deg,#16a36f,#008b5d)] text-white shadow-[0_8px_20px_rgba(10,141,94,.18)]" : "bg-[#f3f5f6] text-[#223047]"}`}>
        <svg aria-hidden="true" className="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
          <path d="m3.5 10.5 8.5-7 8.5 7v9.3a.7.7 0 0 1-.7.7h-5.3v-6h-5v6H4.2a.7.7 0 0 1-.7-.7v-9.3Z" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }

  return (
    <span className={`flex h-[70px] w-[70px] shrink-0 items-center justify-center rounded-2xl border ${selected ? "border-[#92d6ba] bg-[#effaf5] text-[#078457]" : "border-[#e1e5e9] bg-[linear-gradient(145deg,#f8f9fa,#eceff2)] text-[#223047]"}`}>
      <svg aria-hidden="true" className="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="3" y="7" width="18" height="13" rx="2" />
        <path d="M8 7V5.5A1.5 1.5 0 0 1 9.5 4h5A1.5 1.5 0 0 1 16 5.5V7M3 12h18M9.5 12v2h5v-2" />
      </svg>
    </span>
  );
}

export function RoleStep({
  role,
  onBack,
  onContinue,
  onRoleChange,
  stepNumber = 1,
  stepCount = 2,
}: RoleStepProps) {
  const selectedContent = roleContent[role];

  return (
    <section className="flex min-h-[750px] flex-col px-1 py-7 sm:px-2">
      <header>
        <button
          aria-label="Back"
          className="mb-6 flex h-9 w-9 items-center justify-center rounded-full text-[#27364b] transition hover:bg-[#f1f5f3] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#129664]"
          type="button"
          onClick={onBack}
        >
          <svg aria-hidden="true" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="m15 18-6-6 6-6" />
          </svg>
        </button>
        <StepProgress current={stepNumber} total={stepCount} />
        <h1 className="mt-7 text-[34px] font-extrabold leading-none tracking-[-0.045em] text-[#111f32] sm:text-[38px]">
          Choose your role
        </h1>
        <p className="mt-4 text-[16px] text-[#6b7690]">How will you use Bundleen?</p>
      </header>

      <div className="mt-7 space-y-5">
        {PUBLIC_ROLES.map((roleOption) => {
          const content = roleContent[roleOption];
          const selected = roleOption === role;
          return (
            <button
              key={roleOption}
              aria-pressed={selected}
              className="relative flex min-h-[140px] w-full items-center gap-7 rounded-2xl border px-6 py-5 text-left transition-all duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#129664]"
              style={{
                borderColor: selected ? "#169d69" : "#dfe3e8",
                background: selected
                  ? "linear-gradient(110deg,#ffffff 0%,#f2fbf7 100%)"
                  : "#ffffff",
                boxShadow: selected ? "0 8px 22px rgba(15,112,75,.05)" : "none",
              }}
              type="button"
              onClick={() => onRoleChange(roleOption)}
            >
              <RoleIcon role={roleOption} selected={selected} />
              <span className="min-w-0 flex-1 pr-7">
                <span className="block text-[20px] font-bold tracking-[-0.025em] text-[#101b2e]">
                  {content.title}
                </span>
                <span className="mt-1 block text-[15px] text-[#344054]">{content.subtitle}</span>
                <span className="mt-3 block max-w-[410px] text-[14px] leading-6 text-[#758097]">
                  {content.body}
                </span>
              </span>
              {selected ? (
                <span className="absolute right-5 top-5 flex h-6 w-6 items-center justify-center rounded-full bg-[#119665] text-white">
                  <Check className="h-4 w-4" />
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <section className="mt-5 rounded-2xl border border-[#d5eee3] bg-[linear-gradient(110deg,#f7fcfa,#eff9f5)] px-5 py-5">
        <h2 className="text-[14px] font-semibold text-[#087d52]">
          As a {selectedContent.title.toLowerCase()}, you can:
        </h2>
        <ul className="mt-3 space-y-2.5">
          {selectedContent.benefits.map((benefit) => (
            <li key={benefit} className="flex items-center gap-4 text-[13px] text-[#485468]">
              <span className="text-[#0c9963]"><Check /></span>
              {benefit}
            </li>
          ))}
        </ul>
      </section>

      <footer className="mt-auto flex flex-col gap-5 border-t border-[#edf0f2] pt-7 sm:flex-row sm:items-end sm:justify-between">
        <div className="w-full sm:max-w-[280px]">
          <p className="text-[14px] text-[#727d94]">Step {stepNumber} of {stepCount}</p>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#e5e8ec]">
            <div className="h-full rounded-full bg-[#119664]" style={{ width: `${(stepNumber / stepCount) * 100}%` }} />
          </div>
        </div>
        <Button className="h-[52px] w-full rounded-lg px-14 text-[16px] font-semibold sm:w-auto" onClick={onContinue} variant="warm">
          Continue
        </Button>
      </footer>
    </section>
  );
}
