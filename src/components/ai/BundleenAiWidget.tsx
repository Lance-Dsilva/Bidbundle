"use client";

import dynamic from "next/dynamic";
import { useEffect, useId, useRef, useState } from "react";

import { Icon } from "@/components/ui/Icon";
import type { BundleenAiPanelProps } from "@/components/ai/BundleenAiPanel";

/**
 * The panel (message history, streaming, composer) is only downloaded once the
 * widget is actually opened — closed pages never pay for it.
 */
const LazyBundleenAiPanel = dynamic<BundleenAiPanelProps>(
  () => import("@/components/ai/BundleenAiPanel").then((mod) => mod.BundleenAiPanel),
  {
    ssr: false,
    loading: () => (
      <div className="bb-ai-panel-loading" role="status" aria-live="polite">
        Loading Bundleen AI…
      </div>
    ),
  },
);

const MOBILE_QUERY = "(max-width: 767px)";

function focusableIn(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((el) => el.offsetParent !== null);
}

export type BundleenAiWidgetProps = {
  /** Short prompt chips shown above the composer — pass role-tailored ones where useful. */
  suggestions?: string[];
  subtitle?: string;
};

/**
 * The single global "Open Bundleen AI" launcher + floating panel, mounted once
 * per authenticated shell. Reuses `useBundleenAi`/`BundleenAiPanel` — the same
 * conversation and `/api/ai/*` endpoints as everywhere else — it only adds the
 * launcher chrome, responsive presentation, and dialog accessibility around them.
 */
export function BundleenAiWidget({ suggestions, subtitle }: BundleenAiWidgetProps) {
  const [open, setOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const launcherRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    const mql = window.matchMedia(MOBILE_QUERY);
    const update = () => setIsMobile(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);

  const close = () => {
    setOpen(false);
    launcherRef.current?.focus();
  };

  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  // Escape closes from anywhere while open.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Desktop: an outside click dismisses the popover without trapping focus —
  // the page behind it stays keyboard-safe the whole time.
  useEffect(() => {
    if (!open || isMobile) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || launcherRef.current?.contains(target)) return;
      close();
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isMobile]);

  // Mobile: the sheet is a true modal — lock background scroll and trap Tab.
  useEffect(() => {
    if (!open || !isMobile) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = focusableIn(panelRef.current);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, isMobile]);

  return (
    <div className="bb-ai-widget">
      {open && isMobile ? <div className="bb-ai-backdrop" aria-hidden onClick={close} /> : null}

      {open ? (
        <div
          ref={panelRef}
          role="dialog"
          aria-modal={isMobile || undefined}
          aria-labelledby={titleId}
          tabIndex={-1}
          className={isMobile ? "bb-ai-sheet" : "bb-ai-popover"}
        >
          <LazyBundleenAiPanel suggestions={suggestions} subtitle={subtitle} onClose={close} titleId={titleId} />
        </div>
      ) : null}

      <button
        ref={launcherRef}
        type="button"
        className="bb-ai-launcher"
        aria-label={open ? "Close Bundleen AI" : "Open Bundleen AI"}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Bundleen AI"
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="sparkle" size={22} />
      </button>
    </div>
  );
}
