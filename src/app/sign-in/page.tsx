"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { AuthShowcase } from "@/components/auth/AuthShowcase";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { clearAuth, fetchMe, login, setToken } from "@/lib/auth";
import { saveRole, type UserRole } from "@/utils/onboardingState";

const destinationByRole: Record<UserRole, string> = {
  homeowner: "/app/homeowner/dashboard",
  provider: "/app/provider/dashboard",
  admin: "/app/admin/dashboard",
};

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const canSubmit = email.trim().length > 0 && password.trim().length > 0 && !submitting;

  const handleSignIn = async () => {
    setSubmitting(true);
    setAuthError(null);
    try {
      const tokens = await login(email, password);
      setToken(tokens.access_token);
      const me = await fetchMe(tokens.access_token);
      const destination = destinationByRole[me.role as UserRole];
      if (!destination) {
        clearAuth();
        setAuthError("This account type isn't supported in the web app yet.");
        setSubmitting(false);
        return;
      }
      saveRole(me.role as UserRole);
      router.push(destination);
    } catch (e: unknown) {
      setAuthError(e instanceof Error ? e.message : "Sign in failed");
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen">
      <AuthShowcase
        testimonial={{
          quote: "As a plumber, BidBundle sends me bundled jobs from the same neighborhood. Less driving, better margins.",
          name: "James Kowalski",
          location: "Service Provider",
          initials: "JK",
        }}
      />

      <div
        className="relative flex flex-1 flex-col items-center justify-center overflow-y-auto px-5 py-8"
        style={{ background: "linear-gradient(180deg, #FAF6F0 0%, #F1ECE2 100%)" }}
      >
        <div
          className="pointer-events-none absolute right-[-8%] top-[12%] h-[260px] w-[260px] rounded-full opacity-70"
          style={{ background: "radial-gradient(circle, rgba(224,135,88,0.16) 0%, transparent 68%)" }}
        />
        <div
          className="pointer-events-none absolute bottom-[10%] left-[-6%] h-[220px] w-[220px] rounded-full opacity-60"
          style={{ background: "radial-gradient(circle, rgba(122,154,126,0.14) 0%, transparent 68%)" }}
        />
        <div
          className="relative w-full max-w-xl rounded-[32px] border bg-white/88 p-8 backdrop-blur-sm sm:p-10"
          style={{
            borderColor: "var(--border-warm)",
            boxShadow: "0 24px 60px rgba(31,26,20,0.10), 0 4px 12px rgba(31,26,20,0.05)",
          }}
        >
          <header className="pb-7">
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[var(--ink-400)]">Welcome back</p>
            <h1 className="mt-2 font-display text-[2.4rem] font-bold italic tracking-tight text-[var(--ink-900)]">
              Sign in
            </h1>
            <p className="mt-2 max-w-sm text-[14px] leading-6 text-[var(--ink-500)]">
              Access your neighborhood dashboard and live bids.
            </p>
          </header>

          <div className="space-y-4">
            <Input
              autoComplete="email"
              label="Email"
              placeholder="lance@email.com"
              type="email"
              variant="warm"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Input
              autoComplete="current-password"
              label="Password"
              placeholder="Enter your password"
              type="password"
              variant="warm"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />

          </div>

          <div className="mt-6 space-y-3">
            <Button className="h-12 w-full rounded-full text-[14px] font-semibold" disabled={!canSubmit} onClick={handleSignIn} variant="warm">
              {submitting ? "Signing in…" : "Sign in"}
            </Button>
            {authError ? (
              <p style={{ color: "var(--danger-600)", fontSize: 13, textAlign: "center" }}>{authError}</p>
            ) : null}
            <Link href="/get-started" className="block text-center text-[12px] font-medium text-[var(--ink-500)] underline decoration-[var(--border-warm-strong)] underline-offset-2">
              Need an account? Create one
            </Link>
          </div>

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
        </div>
      </div>
    </div>
  );
}
