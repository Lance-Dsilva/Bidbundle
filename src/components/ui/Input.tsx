"use client";

import type { InputHTMLAttributes, ReactNode } from "react";

type InputProps = {
  label: string;
  prefixIcon?: ReactNode;
  hint?: string;
  error?: string;
  variant?: "default" | "warm";
} & Omit<InputHTMLAttributes<HTMLInputElement>, "className">;

export function Input({ id, label, prefixIcon, hint, error, type = "text", variant = "default", ...props }: InputProps) {
  const inputId = id ?? label.toLowerCase().replace(/\s+/g, "-");
  const warm = variant === "warm";

  // The hint and error are associated with the input via `aria-describedby`,
  // so a screen reader reads them as part of the field instead of leaving them
  // as loose text a non-sighted user would never connect to it.
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const describedBy = [error ? errorId : null, hint && !error ? hintId : null]
    .filter(Boolean)
    .join(" ");
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={inputId}
        className={warm ? "text-[12px] font-semibold uppercase tracking-[0.12em] text-[var(--ink-500)]" : "text-[13px] font-medium text-[#0f172a]"}
      >
        {label}
      </label>
      <span
        className={`flex items-center border bg-white px-3 transition-[box-shadow,border-color] duration-[250ms] ${
          warm
            ? "h-11 rounded-[12px] border-[var(--border-warm)] focus-within:border-[#0F9D8A] focus-within:shadow-[0_0_0_4px_rgba(15,157,138,0.12)]"
            : "h-9 rounded-lg focus-within:border-[#2563eb] focus-within:ring-[3px] focus-within:ring-[#2563eb]/10"
        } ${
          error ? "border-red-400 ring-2 ring-red-100" : warm ? "border-[var(--border-warm)]" : "border-[#e2e8f0]"
        }`}
      >
        {prefixIcon ? (
          <span className={`mr-2 flex shrink-0 ${warm ? "text-[var(--terracotta-500)]" : "text-[#94a3b8]"}`}>{prefixIcon}</span>
        ) : null}
        <input
          {...props}
          id={inputId}
          type={type}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          className={`h-full w-full border-0 bg-transparent p-0 outline-none ${
            warm
              ? "text-[14px] text-[var(--ink-900)] placeholder:text-[var(--ink-300)]"
              : "text-[13px] text-[#0f172a] placeholder:text-[#94a3b8]"
          }`}
        />
      </span>
      {hint && !error ? (
        <p id={hintId} className={warm ? "text-[11px] text-[var(--ink-400)]" : "text-[11px] text-[#64748b]"}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-[11px] text-red-500">
          {error}
        </p>
      ) : null}
    </div>
  );
}
