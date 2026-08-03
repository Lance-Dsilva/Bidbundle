import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "amber" | "warm";
type ButtonAs = "button" | "span";

type ButtonProps = {
  as?: ButtonAs;
  children: ReactNode;
  className?: string;
  variant?: ButtonVariant;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children">;

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-[#2563eb] text-white shadow-sm hover:bg-[#1d4ed8] active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563eb] disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none",
  amber:
    "bg-[#f59e0b] text-white shadow-sm hover:bg-[#d97706] active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f59e0b] disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none",
  warm:
    "bg-[linear-gradient(90deg,#0F9D8A,#35B7A5)] text-white shadow-[0_20px_50px_rgba(15,157,138,0.3)] hover:-translate-y-[3px] hover:scale-[1.02] active:scale-[0.98] active:translate-y-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--terracotta-600)] disabled:bg-[var(--cream-200)] disabled:text-[var(--ink-400)] disabled:shadow-none disabled:translate-y-0 disabled:scale-100 disabled:cursor-not-allowed disabled:pointer-events-none",
  secondary:
    "bg-white border border-[#e2e8f0] text-[#0f172a] hover:bg-[#f8fafc] hover:border-[#cbd5e1] active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563eb] disabled:opacity-40 disabled:cursor-not-allowed",
  ghost:
    "bg-transparent text-[#2563eb] hover:bg-[#eff6ff] active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563eb] disabled:opacity-40",
  danger:
    "bg-[#fef2f2] text-[#dc2626] hover:bg-red-100 active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500 disabled:opacity-40",
};

export function Button({
  as = "button",
  children,
  className = "",
  type = "button",
  variant = "primary",
  ...props
}: ButtonProps) {
  const classes = [
    "inline-flex items-center justify-center rounded-lg px-4 h-9 text-[13px] font-medium tracking-[-0.01em] transition-all duration-150",
    variantClasses[variant],
    className,
  ]
    .filter(Boolean)
    .join(" ");

  if (as === "span") {
    return <span className={classes}>{children}</span>;
  }

  return (
    <button className={classes} type={type} {...props}>
      {children}
    </button>
  );
}
