import Link from "next/link";
import type { ReactNode } from "react";

import type { AdminPersonSummary } from "@/lib/community-types";

/**
 * The small, shared pieces every internal-portal screen is built from.
 *
 * Server components by default — none of them hold state — so a list page can
 * render straight from a database read without shipping the roster to the
 * browser as JSON.
 */

export type Tone = "neutral" | "positive" | "warning" | "danger" | "info";

/** Shared so the provider list and detail page cannot drift apart. */
export const PROVIDER_STATUS_TONE: Record<"pending" | "active" | "suspended", Tone> = {
  active: "positive",
  pending: "warning",
  suspended: "danger",
};

const TONE_STYLE: Record<Tone, { background: string; color: string; dot: string }> = {
  neutral: { background: "#f1f5f9", color: "#475569", dot: "#94a3b8" },
  positive: { background: "#ecfdf5", color: "#047857", dot: "#10b981" },
  warning: { background: "#fffbeb", color: "#b45309", dot: "#f59e0b" },
  danger: { background: "#fff1f2", color: "#be123c", dot: "#f43f5e" },
  info: { background: "#eff6ff", color: "#1d4ed8", dot: "#3b82f6" },
};

export function StatusPill({
  label,
  tone = "neutral",
  withDot = true,
}: {
  label: string;
  tone?: Tone;
  withDot?: boolean;
}) {
  const style = TONE_STYLE[tone];
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1 text-[10px] font-bold ring-1 ring-inset ring-black/[0.04]"
      style={{ background: style.background, color: style.color }}
    >
      {withDot && (
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: style.dot }} />
      )}
      {label}
    </span>
  );
}

export function Avatar({ person, size = 40 }: { person: AdminPersonSummary; size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-lg font-bold"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.34),
        background: "#ecfdf5",
        color: "#047857",
      }}
    >
      {person.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- Blob-hosted avatars are already sized on upload.
        <img alt="" src={person.avatarUrl} className="h-full w-full object-cover" />
      ) : (
        person.initials
      )}
    </span>
  );
}

export function PersonLine({
  person,
  meta,
  size = 40,
}: {
  person: AdminPersonSummary;
  meta?: ReactNode;
  size?: number;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar person={person} size={size} />
      <div className="min-w-0">
        <p className="truncate text-[13px] font-bold text-slate-900">
          {person.fullName}
        </p>
        <p className="truncate text-[11px] text-slate-500">
          {meta ?? person.email}
        </p>
      </div>
    </div>
  );
}

/** A labelled count. Renders whatever number the database gave, including 0. */
export function StatTile({
  label,
  value,
  hint,
  href,
  accent = "var(--teal-800)",
}: {
  label: string;
  value: number | string;
  hint?: string;
  href?: string;
  accent?: string;
}) {
  const body = (
    <>
      <p className="font-display text-[1.7rem] font-bold italic leading-none" style={{ color: accent }}>
        {value}
      </p>
      <p className="mt-2 text-[12px] font-semibold" style={{ color: "var(--ink-900)" }}>
        {label}
      </p>
      {hint && (
        <p className="mt-0.5 text-[11px]" style={{ color: "var(--muted)" }}>
          {hint}
        </p>
      )}
    </>
  );

  const className =
    "block rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300 hover:shadow-md";
  const style = {};

  return href ? (
    <Link href={href} className={className} style={style}>
      {body}
    </Link>
  ) : (
    <div className={className} style={style}>
      {body}
    </div>
  );
}

export function SectionCard({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-[14px] font-extrabold text-slate-900">
            {title}
          </h2>
          {subtitle && (
            <p className="mt-0.5 text-[10px] text-slate-500">
              {subtitle}
            </p>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

/**
 * The honest empty state.
 *
 * Every list in this portal renders this rather than sample rows when a query
 * comes back empty — "no communities yet" is information, invented members are
 * not.
 */
export function AdminEmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div
      className="rounded-lg border border-dashed border-slate-300 bg-slate-50/60 px-6 py-10 text-center"
    >
      <p className="text-[13px] font-bold text-slate-800">
        {title}
      </p>
      <p className="mx-auto mt-1 max-w-sm text-[11px] text-slate-500">
        {body}
      </p>
    </div>
  );
}

export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
