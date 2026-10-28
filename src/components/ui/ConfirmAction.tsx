"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/Button";

/** Native modal semantics supply focus containment and an inert background. */
export function ConfirmAction({
  open, title, description, confirmLabel, onCancel, onConfirm,
  error, valid = true, destructive = false,
}: {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => Promise<boolean>;
  error?: string | null;
  valid?: boolean;
  destructive?: boolean;
}) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!open || !element) return;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setLocalError(null);
    element.showModal();
    // Focus the safe choice, rather than the action that changes shared data.
    cancel.current?.focus({ preventScroll: true });
    return () => {
      if (element.open) element.close();
      if (opener.current?.isConnected) opener.current.focus({ preventScroll: true });
    };
  }, [open]);

  useEffect(() => {
    if (pending) dialog.current?.focus({ preventScroll: true });
  }, [pending]);

  const dismiss = () => { if (!inFlight.current) onCancel(); };
  const confirm = async () => {
    if (inFlight.current || !valid) return;
    inFlight.current = true;
    setPending(true);
    setLocalError(null);
    try {
      const ok = await onConfirm();
      if (ok) onCancel();
      else setLocalError("That change was not saved. Review the details and try again.");
    } catch (caught) {
      setLocalError(caught instanceof Error ? caught.message : "That change was not saved. Please try again.");
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };

  if (!open) return null;
  return (
    <dialog
      ref={dialog}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`}
      aria-busy={pending}
      tabIndex={-1}
      className="m-auto w-[calc(100%_-_2rem)] max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border p-5 shadow-xl backdrop:bg-black/40 sm:p-6"
      style={{ borderColor: "var(--border-warm)", background: "var(--bg-card, white)", color: "var(--ink-900)" }}
      onCancel={(event) => { event.preventDefault(); dismiss(); }}
      onClick={(event) => { if (event.target === event.currentTarget) dismiss(); }}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const element = event.currentTarget;
        const focusable = Array.from(element.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]):not([disabled])',
        )).filter((target) => {
          const style = window.getComputedStyle(target);
          return !target.closest("[hidden]") && style.display !== "none" && style.visibility !== "hidden";
        });
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!first || !last) {
          event.preventDefault();
          element.focus({ preventScroll: true });
        } else if (event.shiftKey && (document.activeElement === first || document.activeElement === element)) {
          event.preventDefault();
          last.focus({ preventScroll: true });
        } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === element)) {
          event.preventDefault();
          first.focus({ preventScroll: true });
        }
      }}
    >
      <h2 id={`${id}-title`} className="text-lg font-semibold">{title}</h2>
      <div id={`${id}-description`} className="mt-3 space-y-3 text-sm leading-relaxed" style={{ color: "var(--ink-700)" }}>{description}</div>
      {!valid ? <p role="alert" className="mt-3 text-sm" style={{ color: "#92400e" }}>These details have changed. Cancel and review the latest information before continuing.</p> : null}
      {error || localError ? <p role="alert" className="mt-3 text-sm" style={{ color: "#b91c1c" }}>{error ?? localError}</p> : null}
      {pending ? <p role="status" className="mt-3 text-xs">Saving your change. Please wait.</p> : null}
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button ref={cancel} type="button" disabled={pending} onClick={dismiss} className="min-h-11 rounded-lg border px-4 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50" style={{ borderColor: "var(--border-warm)" }}>Cancel</button>
        <Button type="button" className="min-h-11" disabled={pending || !valid} onClick={() => void confirm()} variant={destructive ? "danger" : "warm"}>
          {pending ? "Saving…" : confirmLabel}
        </Button>
      </div>
    </dialog>
  );
}
