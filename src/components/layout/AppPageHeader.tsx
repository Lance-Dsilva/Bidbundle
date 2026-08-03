import type { ReactNode } from "react";

interface AppPageHeaderProps {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  badge?: ReactNode;
}

export function AppPageHeader({ title, subtitle, action, badge }: AppPageHeaderProps) {
  return (
    <div
      className="sticky top-0 z-20 flex h-14 items-center justify-between border-b px-4"
      style={{
        background: "rgba(255,253,250,.88)",
        borderColor: "var(--line)",
        backdropFilter: "blur(12px)",
      }}
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-[15px] font-semibold tracking-[-0.01em]" style={{ color: "var(--ink-900)" }}>
              {title}
            </h1>
            {badge}
          </div>
          {subtitle && (
            <p className="mt-0 truncate text-[12px]" style={{ color: "var(--muted)" }}>{subtitle}</p>
          )}
        </div>
      </div>
      {action && <div className="ml-4 shrink-0">{action}</div>}
    </div>
  );
}
