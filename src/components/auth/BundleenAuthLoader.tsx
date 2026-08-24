"use client";

import { useEffect, useState } from "react";

/**
 * The branded wait state for every Clerk handoff.
 *
 * Clerk's SDK can take a moment to load or to resolve an existing session, and
 * the Bundleen auth layout renders immediately around it. Without this the user
 * sees the page chrome wrapped around an empty rectangle, which reads as broken
 * rather than as loading.
 *
 * Deliberately an inline SVG/CSS animation rather than a bitmap: it inherits
 * the page's colours, weighs nothing, needs no network round trip during the
 * exact moment the network is already busy, and can be reduced to a static
 * house for `prefers-reduced-motion` without shipping a second asset.
 */

export type AuthLoaderContext =
  | "sign-in"
  | "sign-up"
  | "invitation"
  | "profile"
  | "redirect";

const CONTEXT_COPY: Record<AuthLoaderContext, { title: string; detail: string }> = {
  "sign-in": {
    title: "Preparing your secure sign-in…",
    detail: "Connecting to Bundleen's identity provider.",
  },
  "sign-up": {
    title: "Preparing your secure sign-up…",
    detail: "Getting the account step ready.",
  },
  invitation: {
    title: "Checking your invitation…",
    detail: "Confirming the community invite before you continue.",
  },
  profile: {
    title: "Finishing your Bundleen profile…",
    detail: "Saving your details, then taking you to your dashboard.",
  },
  redirect: {
    title: "Taking you to your dashboard…",
    detail: "Confirming which Bundleen workspace you belong to.",
  },
};

/** How long Clerk may stay unresolved before the user gets a way out. */
const DEFAULT_TIMEOUT_MS = 12_000;

type BundleenAuthLoaderProps = {
  context?: AuthLoaderContext;
  /** Overrides the context-derived headline. */
  title?: string;
  /** Overrides the context-derived supporting line. */
  detail?: string;
  /** Matches the incoming Clerk card so the page does not jump on swap. */
  className?: string;
  timeoutMs?: number;
  /**
   * Called when the user asks to retry. Defaults to a full reload, which is
   * the only reliable recovery when the Clerk SDK itself failed to initialize.
   */
  onRetry?: () => void;
};

/**
 * The house mark, drawn once.
 *
 * The outline strokes on, the door/window light fades up, and a neighbourhood
 * ring pulses out — a short sequence rather than an endless spinner, so the
 * page reads as "something specific is happening", not "this may never end".
 * Every animation is defined in a scoped `<style>` block guarded by
 * `prefers-reduced-motion`, so reduced motion gets the finished frame with no
 * movement at all.
 */
function HouseMark({ animated }: { animated: boolean }) {
  return (
    <span className="relative grid h-20 w-20 place-items-center" aria-hidden="true">
      <svg viewBox="0 0 96 96" className="h-20 w-20" fill="none">
        {/* Neighbourhood pulse */}
        <circle
          className="bal-pulse"
          cx="48"
          cy="52"
          r="34"
          stroke="var(--teal-400, #35B7A5)"
          strokeWidth="1.5"
          opacity="0.35"
        />
        {/* Roof + walls, drawn as one continuous outline */}
        <path
          className="bal-outline"
          d="M18 46 L48 22 L78 46 M26 44 V72 H70 V44"
          stroke="var(--teal-800, #087264)"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Door */}
        <path
          className="bal-door"
          d="M42 72 V56 H54 V72"
          stroke="var(--teal-600, #0F9D8A)"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Window light */}
        <rect
          className="bal-light"
          x="33"
          y="50"
          width="7"
          height="7"
          rx="1.5"
          fill="var(--amber-500, #F5A524)"
        />
        <rect
          className="bal-light bal-light-2"
          x="56"
          y="50"
          width="7"
          height="7"
          rx="1.5"
          fill="var(--amber-500, #F5A524)"
        />
      </svg>

      <style>{`
        .bal-outline { stroke-dasharray: 190; stroke-dashoffset: 0; }
        .bal-door { stroke-dasharray: 44; stroke-dashoffset: 0; }
        .bal-light { opacity: 1; }
        .bal-pulse { opacity: 0.28; }
        ${
          animated
            ? `
        @media (prefers-reduced-motion: no-preference) {
          .bal-outline {
            stroke-dashoffset: 190;
            animation: bal-draw 1.5s ease-in-out infinite;
          }
          .bal-door {
            stroke-dashoffset: 44;
            animation: bal-draw-door 1.5s ease-in-out infinite;
          }
          .bal-light { animation: bal-glow 1.5s ease-in-out infinite; }
          .bal-light-2 { animation-delay: .12s; }
          .bal-pulse { animation: bal-ring 1.5s ease-out infinite; }
        }
        @keyframes bal-draw {
          0%   { stroke-dashoffset: 190; }
          55%  { stroke-dashoffset: 0; }
          100% { stroke-dashoffset: 0; }
        }
        @keyframes bal-draw-door {
          0%, 40% { stroke-dashoffset: 44; }
          75%     { stroke-dashoffset: 0; }
          100%    { stroke-dashoffset: 0; }
        }
        @keyframes bal-glow {
          0%, 55% { opacity: 0; }
          75%     { opacity: 1; }
          100%    { opacity: .55; }
        }
        @keyframes bal-ring {
          0%   { r: 26; opacity: 0; }
          40%  { opacity: .30; }
          100% { r: 42; opacity: 0; }
        }
        `
            : ""
        }
      `}</style>
    </span>
  );
}

export function BundleenAuthLoader({
  context = "sign-in",
  title,
  detail,
  className,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  onRetry,
}: BundleenAuthLoaderProps) {
  const [timedOut, setTimedOut] = useState(false);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if (timeoutMs <= 0) return;
    const timer = window.setTimeout(() => setTimedOut(true), timeoutMs);
    return () => window.clearTimeout(timer);
  }, [timeoutMs]);

  useEffect(() => {
    if (typeof navigator === "undefined") return;
    const sync = () => setOffline(!navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  const copy = CONTEXT_COPY[context];
  const headline = title ?? copy.title;
  const supporting = detail ?? copy.detail;

  const retry = () => {
    if (onRetry) onRetry();
    else window.location.reload();
  };

  return (
    <section
      // One live region for the whole card, polite, announcing the status
      // sentence only. The animation frames are inside `aria-hidden` markup so
      // a screen reader is never told the house is being redrawn.
      role="status"
      aria-live="polite"
      aria-busy={!timedOut}
      className={
        className ??
        "auth-step-enter w-full max-w-md rounded-2xl border border-[#e4e7ec] bg-white px-7 py-10 text-center shadow-[0_24px_60px_rgba(31,26,20,0.10)] sm:px-9"
      }
    >
      <div className="flex justify-center">
        <HouseMark animated={!timedOut} />
      </div>

      {timedOut ? (
        <>
          <h2 className="mt-5 text-[17px] font-bold tracking-[-0.02em] text-[#1f2937]">
            {offline ? "You appear to be offline" : "This is taking longer than usual"}
          </h2>
          <p className="mx-auto mt-2 max-w-sm text-[13px] leading-6 text-[#667085]">
            {offline
              ? "Reconnect to the internet and try again — nothing you entered has been lost."
              : "We could not reach the sign-in service. This is usually temporary."}
          </p>
          <button
            type="button"
            onClick={retry}
            className="mt-5 h-11 rounded-xl bg-[#0f8f83] px-6 text-[13px] font-bold text-white transition hover:bg-[#087264]"
          >
            Try again
          </button>
        </>
      ) : (
        <>
          <h2 className="mt-5 text-[17px] font-bold tracking-[-0.02em] text-[#1f2937]">
            {headline}
          </h2>
          <p className="mx-auto mt-2 max-w-sm text-[13px] leading-6 text-[#667085]">
            {supporting}
          </p>
          {/* Purely decorative progress hint; the sentence above is the status. */}
          <div
            aria-hidden="true"
            className="mx-auto mt-6 h-1.5 w-40 max-w-full overflow-hidden rounded-full bg-[#e7eeec]"
          >
            <span className="bal-track block h-full w-1/3 rounded-full bg-[#0f8f83]" />
          </div>
          <style>{`
            .bal-track { transform: translateX(-100%); }
            @media (prefers-reduced-motion: no-preference) {
              .bal-track { animation: bal-slide 1.4s ease-in-out infinite; }
            }
            @media (prefers-reduced-motion: reduce) {
              .bal-track { transform: none; width: 100%; opacity: .45; }
            }
            @keyframes bal-slide {
              0%   { transform: translateX(-100%); }
              100% { transform: translateX(300%); }
            }
          `}</style>
        </>
      )}
    </section>
  );
}

/**
 * The full-page form-area variant, sized to the same column the Clerk card
 * occupies so swapping one for the other does not move the layout.
 */
export function BundleenAuthLoaderPanel(props: BundleenAuthLoaderProps) {
  return (
    <div className="flex w-full items-center justify-center">
      <BundleenAuthLoader {...props} />
    </div>
  );
}
