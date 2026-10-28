"use client";

import { useEffect, useRef, useState } from "react";

import { StepProgress } from "@/components/onboarding/StepProgress";
import { Button } from "@/components/ui/Button";
import { onboardingCoverageResponseSchema } from "@/lib/validation/onboarding-coverage";

type CoverageState =
  | { point: string; status: "loading" }
  | { point: string; status: "available" | "unavailable" | "error" };

const HEADINGS = {
  loading: "Checking your neighborhood",
  available: "Your area has neighborhood access",
  unavailable: "No neighborhood is available for this address yet",
  error: "We could not check neighborhood availability",
} as const;

// Invisible grid siblings reserve their responsive footprint without entering
// the accessibility tree. A retry must not move another action under a pointer.
const panelClass = (visible: boolean) => `col-start-1 row-start-1 self-start${visible ? "" : " invisible"}`;

type HomeownerCoverageStepProps = {
  address: string;
  latitude: number;
  longitude: number;
  onBack: () => void;
  onContinue: () => void;
  stepNumber?: number;
  stepCount?: number;
  continueLabel?: string;
};

/** An advisory check only: authenticated placement still happens on the server. */
export function HomeownerCoverageStep({
  address, latitude, longitude, onBack, onContinue,
  stepNumber = 3, stepCount = 4, continueLabel = "Continue to email verification",
}: HomeownerCoverageStepProps) {
  const point = `${latitude},${longitude}`;
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<CoverageState>({ point, status: "loading" });
  const heading = useRef<HTMLHeadingElement>(null);
  const requestNumber = useRef(0);
  const pending = useRef(false);
  const continued = useRef(false);
  // A changed address must never briefly reuse the previous address's decision.
  const status = state.point === point ? state.status : "loading";

  useEffect(() => {
    const number = ++requestNumber.current;
    const controller = new AbortController();
    let active = true;
    pending.current = true;
    continued.current = false;
    setState({ point, status: "loading" });
    // A stalled connection is retryable, rather than leaving onboarding stuck.
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    void (async () => {
      try {
        const response = await fetch("/api/onboarding/coverage", {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ latitude, longitude }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Coverage check unavailable");
        const parsed = onboardingCoverageResponseSchema.safeParse(await response.json());
        if (controller.signal.aborted) throw new Error("Coverage check cancelled");
        if (!parsed.success) throw new Error("Invalid coverage response");
        if (active && requestNumber.current === number) {
          setState({ point, status: parsed.data.coverage });
        }
      } catch {
        if (active && requestNumber.current === number) setState({ point, status: "error" });
      } finally {
        window.clearTimeout(timeout);
        if (active && requestNumber.current === number) pending.current = false;
      }
    })();
    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [latitude, longitude, point, attempt]);

  useEffect(() => { heading.current?.focus(); }, [status]);

  const continueAfterDecision = () => {
    if (pending.current || continued.current || !["available", "unavailable"].includes(status)) return;
    continued.current = true;
    onContinue();
  };
  const retry = () => {
    if (pending.current) return;
    pending.current = true;
    setState({ point, status: "loading" });
    setAttempt((current) => current + 1);
  };

  return (
    <section className="py-7">
      <StepProgress current={stepNumber} total={stepCount} />
      <p className="mt-3 text-xs text-[#6b7280]">Step {stepNumber} of {stepCount}</p>
      <h1 ref={heading} tabIndex={-1} className="mt-5 grid text-2xl font-bold tracking-tight text-[#1f2937]">
        {Object.entries(HEADINGS).map(([key, text]) => (
          <span key={key} aria-hidden={status !== key} className={panelClass(status === key)}>{text}</span>
        ))}
      </h1>
      <p className="mt-3 break-words text-sm leading-6 text-[#667085]">{address}</p>
      <div className="mt-4 grid">
        <p role={status === "loading" ? "status" : undefined} aria-hidden={status !== "loading"}
          className={`${panelClass(status === "loading")} text-sm leading-6 text-[#667085]`}>
          Checking whether an existing Bundleen neighborhood has room for your address…
        </p>
        <div role={status === "available" ? "status" : undefined} aria-hidden={status !== "available"}
          className={`${panelClass(status === "available")} rounded-xl border border-[#c9e7df] bg-[#f0faf6] p-4 text-sm leading-6 text-[#2d6659]`}>
          An existing neighborhood currently has room for this address. Your neighborhood is confirmed after sign-up; this check does not reserve a place.
        </div>
        <div role={status === "unavailable" ? "status" : undefined} aria-hidden={status !== "unavailable"}
          className={`${panelClass(status === "unavailable")} space-y-3 rounded-xl border border-[#ead8b8] bg-[#fff9ef] p-4 text-sm leading-6 text-[#75502d]`}>
          <p>We cannot currently place this address in an existing Bundleen neighborhood.</p>
          <p>You can still create an account, but you cannot post service requests until you are placed in a neighborhood. A new neighborhood may form as nearby residents join.</p>
          <p>Check your address, or choose to continue with this limitation.</p>
        </div>
        <p role={status === "error" ? "alert" : undefined} aria-hidden={status !== "error"}
          className={`${panelClass(status === "error")} rounded-xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-700`}>
          Neighborhood availability could not be checked. Please try again before continuing. This does not mean your address is outside our coverage.
        </p>
      </div>
      <div className="mt-6 flex flex-col gap-3">
        <Button className="min-h-11 h-auto w-full rounded-xl px-4 py-3 text-sm"
          disabled={status === "loading"} aria-busy={status === "loading"}
          onClick={(event) => {
            // A fast retry result must not reinterpret the second click of a
            // physical double-click as consent to continue. Keyboard clicks
            // have detail 0 and remain available immediately.
            if (event.detail > 1) return;
            if (status === "error") retry();
            else continueAfterDecision();
          }} variant="warm">
          <span className="grid">
            {[
              ["loading", "Checking…"], ["error", "Try again"],
              ["available", continueLabel], ["unavailable", "Continue without neighborhood access"],
            ].map(([key, text]) => (
              <span key={key} aria-hidden={status !== key} className={panelClass(status === key)}>{text}</span>
            ))}
          </span>
        </Button>
        <Button className="min-h-11 w-full rounded-xl text-sm" onClick={onBack} variant="secondary">Edit address</Button>
      </div>
    </section>
  );
}
