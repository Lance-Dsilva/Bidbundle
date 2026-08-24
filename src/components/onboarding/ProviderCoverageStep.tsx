"use client";

import { useState } from "react";

import { StepProgress } from "@/components/onboarding/StepProgress";
import {
  ProviderServiceAreaEditor,
  isServiceAreaDraftValid,
  type ServiceAreaDraft,
} from "@/components/provider/ProviderServiceAreaEditor";
import { Button } from "@/components/ui/Button";

/**
 * Provider-only onboarding step: draw the area you actually work in.
 *
 * Purely a form. The circle is validated again by `providerServiceAreaSchema`
 * and saved as the provider's primary active area only after the profile
 * itself is created server-side — nothing here writes to the database.
 */

type ProviderCoverageStepProps = {
  value: ServiceAreaDraft | null;
  onChange: (draft: ServiceAreaDraft | null) => void;
  onBack: () => void;
  onContinue: () => void;
  submitting?: boolean;
  stepNumber?: number;
  stepCount?: number;
  confirmLabel?: string;
};

export function ProviderCoverageStep({
  value,
  onChange,
  onBack,
  onContinue,
  submitting = false,
  stepNumber = 5,
  stepCount = 6,
  confirmLabel = "Continue",
}: ProviderCoverageStepProps) {
  const [touched, setTouched] = useState(false);
  const valid = isServiceAreaDraftValid(value);

  return (
    <section className="py-6">
      <header className="pb-5">
        <button
          aria-label="Back"
          className="mb-3 flex h-10 w-10 items-center justify-center rounded-full text-[var(--ink-700)] transition hover:bg-[var(--cream-100)]"
          type="button"
          onClick={onBack}
        >
          <svg
            aria-hidden="true"
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m15 18-6-6 6-6" />
          </svg>
        </button>
        <StepProgress current={stepNumber} total={stepCount} />
        <h1 className="mt-2 font-display text-[2.2rem] font-bold italic leading-tight tracking-tight text-[var(--ink-900)]">
          Where do you work?
        </h1>
        <p className="mt-2 text-[14px] leading-6 text-[var(--ink-500)]">
          Drop a pin on the area you cover and set how far you travel. This is the area Bundleen
          matches you against — you will only see open service requests that fall inside it.
        </p>
      </header>

      <ProviderServiceAreaEditor
        value={value}
        onChange={(draft) => {
          setTouched(true);
          onChange(draft);
        }}
        showLabelField={false}
        disabled={submitting}
        helpText="Requests outside this circle never reach your feed. You can change the centre and radius any time from your profile."
      />

      {touched && !valid ? (
        <p role="alert" className="mt-3 text-[13px] font-medium text-red-600">
          Search for an address and set a radius before continuing.
        </p>
      ) : null}

      <div className="mt-6">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            {Array.from({ length: stepCount }, (_, index) => index + 1).map((n) => (
              <span
                key={n}
                className={`rounded-full transition-all duration-300 ${
                  n === stepNumber ? "h-2 w-6" : "h-2 w-2"
                }`}
                style={{
                  background: n <= stepNumber ? "var(--terracotta-600)" : "rgba(232,98,63,0.40)",
                }}
              />
            ))}
          </div>
          <span className="text-[12px] text-[var(--ink-400)]">
            {stepNumber} of {stepCount}
          </span>
        </div>
        <Button
          className="h-12 w-full rounded-full text-[14px] font-semibold"
          onClick={() => {
            setTouched(true);
            if (valid) onContinue();
          }}
          variant="warm"
          disabled={submitting || !valid}
        >
          {submitting ? "Saving…" : confirmLabel}
        </Button>
      </div>
    </section>
  );
}
