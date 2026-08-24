"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * The shared filter/search row, and the drawer/dialog every module confirms in.
 *
 * Split from `primitives/index.tsx` because these are the only pieces that hold
 * state — keeping them here lets the rest stay server components.
 */

export type AdminFilterOption = { value: string; label: string };

export function AdminFilterSelect({
  label,
  value,
  options,
  onChange,
  allLabel = "All",
}: {
  label: string;
  value: string;
  options: readonly AdminFilterOption[];
  onChange: (value: string) => void;
  allLabel?: string;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500">
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 min-w-0 rounded-lg border border-slate-300 bg-white px-2.5 text-[12px] font-medium text-slate-800 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
      >
        <option value="">{allLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Debounced search input.
 *
 * Debounced rather than submit-on-enter because the queue query runs on the
 * server: typing must not fire one request per keystroke.
 */
export function AdminSearchInput({
  value,
  onChange,
  placeholder = "Search",
  label = "Search",
  delayMs = 300,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  delayMs?: number;
}) {
  const [draft, setDraft] = useState(value);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Adopt an externally cleared/changed value without fighting the user's typing.
  useEffect(() => setDraft(value), [value]);

  useEffect(() => {
    if (draft === value) return;
    const timer = window.setTimeout(() => onChangeRef.current(draft), delayMs);
    return () => window.clearTimeout(timer);
  }, [draft, value, delayMs]);

  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500">
        {label}
      </span>
      <input
        type="search"
        value={draft}
        placeholder={placeholder}
        onChange={(event) => setDraft(event.target.value)}
        className="h-9 min-w-0 rounded-lg border border-slate-300 bg-white px-3 text-[12px] text-slate-800 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
      />
    </label>
  );
}

export function AdminFilterBar({
  children,
  onReset,
  activeCount,
}: {
  children: ReactNode;
  onReset?: () => void;
  activeCount?: number;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-end gap-3">{children}</div>
      {onReset && (activeCount ?? 0) > 0 ? (
        <button
          type="button"
          onClick={onReset}
          className="mt-2 text-[11px] font-bold text-slate-500 underline transition hover:text-slate-800"
        >
          Clear {activeCount} filter{activeCount === 1 ? "" : "s"}
        </button>
      ) : null}
    </div>
  );
}

/**
 * A modal used for confirmations and short forms.
 *
 * Escape and backdrop close it, focus moves in on open and returns on close,
 * and the page behind it stops scrolling — the same behaviour the AI widget
 * already established, so the portal has one modal idiom rather than three.
 */
export function AdminDialog({
  open,
  title,
  description,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      returnFocusRef.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white shadow-2xl outline-none sm:rounded-2xl"
      >
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-[15px] font-extrabold text-slate-900">{title}</h2>
          {description ? (
            <p className="mt-1 text-[12px] leading-5 text-slate-500">{description}</p>
          ) : null}
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer ? (
          <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 px-5 py-3.5">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Right-hand slide-over for record detail without leaving the list. */
export function AdminDrawer({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100]">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-slate-950/40"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-white shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="text-[14px] font-extrabold text-slate-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 text-slate-500"
          >
            <span aria-hidden="true">×</span>
            <span className="sr-only">Close</span>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </aside>
    </div>
  );
}
