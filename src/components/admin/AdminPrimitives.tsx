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
  neutral: { background: "var(--navy-50)", color: "var(--navy-700)", dot: "var(--ink-400)" },
  positive: { background: "var(--teal-50)", color: "var(--teal-800)", dot: "var(--teal-600)" },
  warning: { background: "var(--gold-50)", color: "var(--gold-600)", dot: "var(--gold-500)" },
  danger: { background: "#FEF3F2", color: "var(--danger-600)", dot: "var(--danger-600)" },
  info: { background: "var(--navy-50)", color: "var(--navy-500)", dot: "var(--navy-500)" },
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
      className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold"
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
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.34),
        background: "var(--teal-50)",
        color: "var(--teal-800)",
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
        <p className="truncate text-[14px] font-semibold" style={{ color: "var(--ink-900)" }}>
          {person.fullName}
        </p>
        <p className="truncate text-[12px]" style={{ color: "var(--muted)" }}>
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
    "block rounded-2xl border p-4 shadow-card transition-all hover:-translate-y-0.5 hover:shadow-card-hover";
  const style = { background: "var(--paper)", borderColor: "var(--line)" };

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
    <section
      className="rounded-2xl border p-5 shadow-card"
      style={{ background: "var(--paper)", borderColor: "var(--line)" }}
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold" style={{ color: "var(--ink-900)" }}>
            {title}
          </h2>
          {subtitle && (
            <p className="mt-0.5 text-[12px]" style={{ color: "var(--muted)" }}>
              {subtitle}
            </p>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children}
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
      className="rounded-2xl border border-dashed px-6 py-10 text-center"
      style={{ borderColor: "var(--line)" }}
    >
      <p className="text-[14px] font-semibold" style={{ color: "var(--ink-900)" }}>
        {title}
      </p>
      <p className="mx-auto mt-1 max-w-sm text-[12px]" style={{ color: "var(--muted)" }}>
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
