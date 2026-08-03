"use client";

import Link from "next/link";
import { useEffect } from "react";

import { StepProgress } from "@/components/onboarding/StepProgress";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

type SignupData = {
  fullName: string;
  email: string;
  password: string;
  phone: string;
};

type SignupStepProps = {
  signup: SignupData;
  onChange: (field: keyof SignupData, value: string) => void;
  onContinue: () => void;
  stepCount?: number;
};

function GoogleMark() {
  return (
    <svg aria-hidden="true" className="h-5 w-5 shrink-0" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M21.6 12.23c0-.68-.06-1.33-.17-1.95H12v3.69h5.39a4.63 4.63 0 0 1-2 3.04v2.53h3.24c1.9-1.75 2.97-4.33 2.97-7.31Z"/>
      <path fill="#34A853" d="M12 22c2.7 0 4.97-.9 6.63-2.46l-3.24-2.53c-.9.6-2.05.96-3.39.96-2.6 0-4.81-1.75-5.6-4.1H3.06v2.6A10 10 0 0 0 12 22Z"/>
      <path fill="#FBBC05" d="M6.4 13.87A5.98 5.98 0 0 1 6.09 12c0-.65.11-1.27.31-1.87v-2.6H3.06A10 10 0 0 0 2 12c0 1.61.39 3.14 1.06 4.47l3.34-2.6Z"/>
      <path fill="#EA4335" d="M12 6.03c1.47 0 2.79.51 3.83 1.5l2.87-2.87C16.96 3.04 14.7 2 12 2a10 10 0 0 0-8.94 5.53l3.34 2.6c.79-2.35 3-4.1 5.6-4.1Z"/>
    </svg>
  );
}

export function SignupStep({ signup, onChange, onContinue, stepCount = 3 }: SignupStepProps) {
  const isComplete =
    signup.fullName.trim().length > 0 &&
    signup.email.trim().length > 0 &&
    signup.password.trim().length > 0 &&
    signup.phone.trim().length > 0;

  useEffect(() => {
    const fieldMap: Record<keyof SignupData, string> = {
      fullName: "full-name",
      email: "email",
      password: "password",
      phone: "phone",
    };

    const syncAutofill = () => {
      (Object.entries(fieldMap) as Array<[keyof SignupData, string]>).forEach(([field, id]) => {
        const input = document.getElementById(id) as HTMLInputElement | null;
        if (!input) return;
        if (input.value && input.value !== signup[field]) {
          onChange(field, input.value);
        }
      });
    };

    syncAutofill();
    const timeoutIds = [150, 400, 900].map((delay) => window.setTimeout(syncAutofill, delay));

    return () => {
      timeoutIds.forEach((id) => window.clearTimeout(id));
    };
  }, [onChange, signup]);

  return (
    <section className="py-6">
      <header className="pb-7">
        <StepProgress current={1} total={stepCount} />
        <h1 className="mt-2 font-display text-[2.4rem] font-bold italic tracking-tight text-[var(--ink-900)]">
          Create account
        </h1>
        <p className="mt-2 max-w-sm text-[14px] leading-6 text-[var(--ink-500)]">
          Join your neighborhood — it&apos;s free
        </p>
      </header>

      <div className="space-y-4">
        <Input
          autoComplete="name"
          id="full-name"
          label="Full name"
          placeholder="Lance Silva"
          variant="warm"
          prefixIcon={<span className="text-[15px] leading-none">👤</span>}
          value={signup.fullName}
          onChange={(e) => onChange("fullName", e.target.value)}
        />
        <Input
          autoComplete="email"
          id="email"
          label="Email"
          placeholder="lance@email.com"
          type="email"
          variant="warm"
          prefixIcon={<span className="text-[15px] leading-none">📧</span>}
          value={signup.email}
          onChange={(e) => onChange("email", e.target.value)}
        />
        <Input
          autoComplete="new-password"
          id="password"
          label="Password"
          placeholder="8+ characters"
          type="password"
          variant="warm"
          prefixIcon={<span className="text-[15px] leading-none">🔒</span>}
          value={signup.password}
          onChange={(e) => onChange("password", e.target.value)}
        />
        <Input
          autoComplete="tel"
          id="phone"
          label="Phone"
          placeholder="+1 (215) 555-0192"
          type="tel"
          variant="warm"
          prefixIcon={<span className="text-[15px] leading-none">📱</span>}
          value={signup.phone}
          onChange={(e) => onChange("phone", e.target.value)}
        />
      </div>

      <div className="mt-6">
        <div className="mb-3 flex items-center justify-between">
          <StepProgress current={1} total={stepCount} />
          <span className="text-[12px] text-[var(--ink-400)]">1 of {stepCount}</span>
        </div>
        <Button className="h-12 w-full rounded-full text-[14px] font-semibold" disabled={!isComplete} onClick={onContinue} variant="warm">
          Continue
        </Button>
      </div>

      <div className="my-5 flex items-center gap-3">
        <span className="h-px flex-1 bg-[var(--border-warm)]" />
        <span className="text-[12px] text-[var(--ink-400)]">or</span>
        <span className="h-px flex-1 bg-[var(--border-warm)]" />
      </div>

      <button
        className="flex h-12 w-full items-center justify-center gap-2.5 rounded-full border bg-white text-[13px] font-medium text-[var(--ink-900)] transition-all hover:bg-[var(--cream-50)] active:scale-[0.98]"
        style={{ borderColor: "var(--border-warm-strong)" }}
        type="button"
      >
        <GoogleMark />
        Continue with Google
      </button>

      <p className="mt-5 text-center text-[11px] leading-5 text-[var(--ink-400)]">
        By continuing, you agree to our{" "}
        <span className="text-[var(--ink-900)] underline decoration-[var(--border-warm-strong)] underline-offset-2">
          Terms
        </span>{" "}
        and{" "}
        <span className="text-[var(--ink-900)] underline decoration-[var(--border-warm-strong)] underline-offset-2">
          Privacy Policy
        </span>
        .
      </p>

      <p className="mt-4 text-center text-[12px] text-[var(--ink-500)]">
        Already have an account?{" "}
        <Link href="/sign-in" className="font-semibold text-[var(--ink-900)] underline decoration-[var(--border-warm-strong)] underline-offset-2">
          Sign in
        </Link>
      </p>
    </section>
  );
}
