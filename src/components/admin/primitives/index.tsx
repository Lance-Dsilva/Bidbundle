import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The shared admin CRM primitives.
 *
 * Every internal-portal screen is assembled from these rather than from
 * one-off layouts, so status, owner, last activity, and next action sit in the
 * same place on every module and a new feature inherits the pagination, empty,
 * and error states instead of reinventing them.
 *
 * Server components by default — none of these hold state — so a list page can
 * render straight from a database read without shipping the roster to the
 * browser as JSON.
 */

export type Tone = "neutral" | "positive" | "warning" | "danger" | "info" | "accent";

const TONE_STYLE: Record<Tone, { background: string; color: string; dot: string }> = {
  neutral: { background: "#f1f5f9", color: "#475569", dot: "#94a3b8" },
  positive: { background: "#ecfdf5", color: "#047857", dot: "#10b981" },
  warning: { background: "#fffbeb", color: "#b45309", dot: "#f59e0b" },
  danger: { background: "#fff1f2", color: "#be123c", dot: "#f43f5e" },
  info: { background: "#eff6ff", color: "#1d4ed8", dot: "#3b82f6" },
  accent: { background: "#f5f3ff", color: "#6d28d9", dot: "#8b5cf6" },
};

/* ── Page chrome ─────────────────────────────────────────────────────────── */

export function AdminPageHeader({
  eyebrow,
  title,
  description,
  actions,
  breadcrumb,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  breadcrumb?: { label: string; href: string };
}) {
  return (
    <header className="border-b border-slate-200 bg-white px-4 py-5 md:px-6 xl:px-8">
      {breadcrumb ? (
        <Link
          href={breadcrumb.href}
          className="mb-2 inline-flex items-center gap-1 text-[11px] font-bold text-slate-500 transition hover:text-slate-800"
        >
          <span aria-hidden="true">←</span> {breadcrumb.label}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {eyebrow ? (
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
              {eyebrow}
            </p>
          ) : null}
          <h1 className="mt-0.5 text-[20px] font-extrabold tracking-[-0.02em] text-slate-900">
            {title}
          </h1>
          {description ? (
            <p className="mt-1 max-w-2xl text-[12px] leading-5 text-slate-500">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

/** Standard content padding, so every module's body lines up with every other. */
export function AdminPageBody({ children }: { children: ReactNode }) {
  return <div className="space-y-5 px-4 py-5 md:px-6 xl:px-8">{children}</div>;
}

export function AdminMetricCard({
  label,
  value,
  hint,
  href,
  tone = "neutral",
}: {
  label: string;
  value: number | string;
  hint?: string;
  href?: string;
  tone?: Tone;
}) {
  const style = TONE_STYLE[tone];
  const body = (
    <>
      <p className="text-[26px] font-extrabold leading-none tracking-[-0.02em]" style={{ color: style.color }}>
        {value}
      </p>
      <p className="mt-2 text-[12px] font-bold text-slate-800">{label}</p>
      {hint ? <p className="mt-0.5 text-[11px] text-slate-500">{hint}</p> : null}
    </>
  );
  const className =
    "block rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300 hover:shadow-md";

  return href ? (
    <Link href={href} className={className}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

export function AdminMetricRow({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{children}</div>
  );
}

export function AdminStatusBadge({
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
      {withDot ? (
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: style.dot }} />
      ) : null}
      {label}
    </span>
  );
}

export function AdminEmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50/60 px-6 py-12 text-center">
      <p className="text-[13px] font-bold text-slate-800">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-[11px] leading-5 text-slate-500">{body}</p>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function AdminErrorState({
  title = "Something went wrong",
  body,
  retry,
}: {
  title?: string;
  body: string;
  retry?: ReactNode;
}) {
  return (
    <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-6 py-8 text-center">
      <p className="text-[13px] font-bold text-rose-800">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-[11px] leading-5 text-rose-700">{body}</p>
      {retry ? <div className="mt-4 flex justify-center">{retry}</div> : null}
    </div>
  );
}

export function AdminLoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div role="status" className="rounded-lg border border-slate-200 bg-white px-6 py-12 text-center">
      <p className="text-[12px] font-medium text-slate-500">{label}</p>
    </div>
  );
}

/* ── Tables ──────────────────────────────────────────────────────────────── */

export type AdminTableColumn<TRow> = {
  key: string;
  header: string;
  /** Rendered into a `<td>`. Keep cells compact — the queue is scanned, not read. */
  cell: (row: TRow) => ReactNode;
  /** Hides the column below `lg` so a laptop shows the columns that matter. */
  secondary?: boolean;
  align?: "left" | "right";
  width?: string;
};

/**
 * The one table.
 *
 * Horizontal overflow is confined to this component's own scroll container, so
 * a wide table never makes the whole admin page scroll sideways on a laptop —
 * the specific failure the redesign brief called out.
 */
export function AdminDataTable<TRow>({
  columns,
  rows,
  rowKey,
  rowHref,
  empty,
  caption,
}: {
  columns: readonly AdminTableColumn<TRow>[];
  rows: readonly TRow[];
  rowKey: (row: TRow) => string;
  rowHref?: (row: TRow) => string;
  empty: ReactNode;
  caption?: string;
}) {
  if (rows.length === 0) return <>{empty}</>;

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-left">
          {caption ? <caption className="sr-only">{caption}</caption> : null}
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/80">
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  style={column.width ? { width: column.width } : undefined}
                  className={`px-4 py-2.5 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500 ${
                    column.align === "right" ? "text-right" : ""
                  } ${column.secondary ? "hidden lg:table-cell" : ""}`}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const href = rowHref?.(row);
              return (
                <tr
                  key={rowKey(row)}
                  className="border-b border-slate-100 last:border-0 transition hover:bg-slate-50/70"
                >
                  {columns.map((column, index) => (
                    <td
                      key={column.key}
                      className={`px-4 py-3 align-middle text-[12px] text-slate-700 ${
                        column.align === "right" ? "text-right" : ""
                      } ${column.secondary ? "hidden lg:table-cell" : ""}`}
                    >
                      {/* The first cell carries the row link, so the whole row
                          is reachable by keyboard through one real anchor
                          rather than a click handler on the <tr>. */}
                      {index === 0 && href ? (
                        <Link href={href} className="block focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500">
                          {column.cell(row)}
                        </Link>
                      ) : (
                        column.cell(row)
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function AdminPagination({
  page,
  pageCount,
  total,
  onPageChange,
}: {
  page: number;
  pageCount: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-1">
      <p className="text-[11px] text-slate-500">
        Page {page} of {pageCount} · {total.toLocaleString()} total
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="h-8 rounded-lg border border-slate-300 bg-white px-3 text-[12px] font-semibold text-slate-700 disabled:opacity-40"
        >
          Previous
        </button>
        <button
          type="button"
          disabled={page >= pageCount}
          onClick={() => onPageChange(page + 1)}
          className="h-8 rounded-lg border border-slate-300 bg-white px-3 text-[12px] font-semibold text-slate-700 disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  );
}

/* ── Detail layout ───────────────────────────────────────────────────────── */

/**
 * Two-column record view: the conversation or main content on the left, the
 * properties and actions rail on the right. Collapses to one column below
 * `xl`, which is where the rail stops fitting on a laptop.
 */
export function AdminDetailLayout({
  main,
  aside,
}: {
  main: ReactNode;
  aside: ReactNode;
}) {
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-5">{main}</div>
      <div className="min-w-0 space-y-4">{aside}</div>
    </div>
  );
}

export function AdminCard({
  title,
  subtitle,
  action,
  children,
  padded = true,
}: {
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  padded?: boolean;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
      {title ? (
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-5 py-3.5">
          <div className="min-w-0">
            <h2 className="text-[13px] font-extrabold text-slate-900">{title}</h2>
            {subtitle ? <p className="mt-0.5 text-[10px] text-slate-500">{subtitle}</p> : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      ) : null}
      <div className={padded ? "p-5" : ""}>{children}</div>
    </section>
  );
}

export function AdminPropertyRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-2">
      <dt className="shrink-0 text-[11px] font-semibold text-slate-500">{label}</dt>
      <dd className="min-w-0 text-right text-[12px] font-medium text-slate-900">{children}</dd>
    </div>
  );
}

/* ── Formatting ──────────────────────────────────────────────────────────── */

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

/** "3h ago" / "2d ago" — the queue's scan-friendly age. */
export function formatRelative(iso: string | null): string {
  if (!iso) return "—";
  const deltaMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(deltaMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
