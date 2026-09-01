"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  AdminDataTable,
  AdminEmptyState,
  AdminErrorState,
  AdminLoadingState,
  AdminMetricCard,
  AdminMetricRow,
  AdminPagination,
  AdminStatusBadge,
  formatRelative,
  type AdminTableColumn,
} from "@/components/admin/primitives";
import {
  AdminFilterBar,
  AdminFilterSelect,
  AdminSearchInput,
} from "@/components/admin/primitives/AdminFilterBar";
import {
  CATEGORY_LABELS,
  PRIORITY_LABELS,
  PRIORITY_TONES,
  STATUS_LABELS,
  STATUS_TONES,
  optionsFrom,
} from "@/components/admin/support/supportPresentation";
import type {
  SupportTicketCategoryValue,
  SupportTicketPriorityValue,
  SupportTicketStatusValue,
  TicketSortOption,
} from "@/lib/validation/support";

/**
 * The admin ticket queue.
 *
 * Every filter, sort, and page is a server query parameter — the browser never
 * receives more of the queue than the page it is showing, which is what keeps
 * this usable once support history is measured in thousands of rows.
 */

type QueueTicket = {
  id: string;
  ticketNumber: string;
  subject: string;
  category: SupportTicketCategoryValue;
  status: SupportTicketStatusValue;
  priority: SupportTicketPriorityValue;
  requesterName: string;
  requesterEmail: string;
  requesterRole: string;
  communityName: string | null;
  assignedAdminName: string | null;
  messageCount: number;
  awaitingAdminReply: boolean;
  firstResponseOverdue: boolean;
  ageHours: number;
  lastActivityAt: string;
  createdAt: string;
};

type QueueResponse = {
  tickets: QueueTicket[];
  total: number;
  page: number;
  pageCount: number;
  stats: { open: number; unassigned: number; awaitingReply: number; urgent: number };
  assignees: { id: string; name: string; email: string }[];
};

type Filters = {
  search: string;
  status: string;
  priority: string;
  category: string;
  requesterRole: string;
  assignee: string;
  minAgeDays: string;
  sort: TicketSortOption;
  page: number;
};

const EMPTY_FILTERS: Filters = {
  search: "",
  status: "",
  priority: "",
  category: "",
  requesterRole: "",
  assignee: "",
  minAgeDays: "",
  sort: "recent_activity",
  page: 1,
};

const SORT_LABELS: Record<TicketSortOption, string> = {
  recent_activity: "Recent activity",
  newest: "Newest first",
  oldest_unanswered: "Oldest unanswered",
  priority: "Priority",
};

const AGE_OPTIONS = [
  { value: "1", label: "Older than 1 day" },
  { value: "3", label: "Older than 3 days" },
  { value: "7", label: "Older than 7 days" },
];

export function AdminSupportQueue() {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [data, setData] = useState<QueueResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value === "" || value === undefined) continue;
      params.set(key, String(value));
    }
    return params.toString();
  }, [filters]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/support/tickets?${query}`, {
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error("load failed");
      setData((await response.json()) as QueueResponse);
    } catch {
      setError("The ticket queue could not be loaded. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    void load();
  }, [load]);

  const update = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    // Any filter change resets to page 1: staying on page 4 of a result set
    // that now has two pages shows an empty table for no reason.
    setFilters((current) => ({ ...current, [key]: value, page: key === "page" ? (value as number) : 1 }));
  };

  const activeFilterCount = [
    filters.search,
    filters.status,
    filters.priority,
    filters.category,
    filters.requesterRole,
    filters.assignee,
    filters.minAgeDays,
  ].filter(Boolean).length;

  const columns: AdminTableColumn<QueueTicket>[] = [
    {
      key: "ticket",
      header: "Ticket",
      width: "34%",
      cell: (ticket) => (
        <span className="block min-w-0">
          <span className="flex items-center gap-2">
            <span className="truncate text-[12px] font-bold text-slate-900">{ticket.subject}</span>
            {ticket.awaitingAdminReply ? (
              <span
                title="The customer replied and is waiting"
                className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500"
              />
            ) : null}
          </span>
          <span className="mt-0.5 block truncate text-[10px] text-slate-500">
            {ticket.ticketNumber} · {CATEGORY_LABELS[ticket.category]} · {ticket.messageCount}{" "}
            message{ticket.messageCount === 1 ? "" : "s"}
          </span>
        </span>
      ),
    },
    {
      key: "requester",
      header: "Requester",
      cell: (ticket) => (
        <span className="block min-w-0">
          <span className="block truncate font-semibold text-slate-800">{ticket.requesterName}</span>
          <span className="block truncate text-[10px] capitalize text-slate-500">
            {ticket.requesterRole}
            {ticket.communityName ? ` · ${ticket.communityName}` : ""}
          </span>
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (ticket) => (
        <AdminStatusBadge label={STATUS_LABELS[ticket.status]} tone={STATUS_TONES[ticket.status]} />
      ),
    },
    {
      key: "priority",
      header: "Priority",
      secondary: true,
      cell: (ticket) => (
        <AdminStatusBadge
          label={PRIORITY_LABELS[ticket.priority]}
          tone={PRIORITY_TONES[ticket.priority]}
          withDot={false}
        />
      ),
    },
    {
      key: "owner",
      header: "Owner",
      secondary: true,
      cell: (ticket) => (
        <span className="text-slate-700">
          {ticket.assignedAdminName ?? <span className="text-slate-400">Unassigned</span>}
        </span>
      ),
    },
    {
      key: "age",
      header: "Age",
      align: "right",
      cell: (ticket) => (
        <span className="whitespace-nowrap">
          {ticket.firstResponseOverdue ? (
            <span
              title="No first response within the SLA for this priority"
              className="mr-1.5 inline-block rounded bg-rose-100 px-1.5 py-0.5 text-[9px] font-bold text-rose-700"
            >
              SLA
            </span>
          ) : null}
          <span className="text-slate-500">{formatRelative(ticket.lastActivityAt)}</span>
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <AdminMetricRow>
        <AdminMetricCard
          label="Open tickets"
          value={data?.stats.open ?? "—"}
          hint="Not resolved or closed"
        />
        <AdminMetricCard
          label="Never answered"
          value={data?.stats.awaitingReply ?? "—"}
          hint="No first response yet"
          tone={data && data.stats.awaitingReply > 0 ? "warning" : "neutral"}
        />
        <AdminMetricCard
          label="Unassigned"
          value={data?.stats.unassigned ?? "—"}
          hint="Nobody owns these"
          tone={data && data.stats.unassigned > 0 ? "warning" : "neutral"}
        />
        <AdminMetricCard
          label="Urgent"
          value={data?.stats.urgent ?? "—"}
          hint="Highest priority, still open"
          tone={data && data.stats.urgent > 0 ? "danger" : "neutral"}
        />
      </AdminMetricRow>

      <AdminFilterBar
        activeCount={activeFilterCount}
        onReset={() => setFilters(EMPTY_FILTERS)}
      >
        <AdminSearchInput
          value={filters.search}
          onChange={(value) => update("search", value)}
          placeholder="Ticket number, subject, requester, or community"
        />
        <AdminFilterSelect
          label="Status"
          value={filters.status}
          options={optionsFrom(STATUS_LABELS)}
          onChange={(value) => update("status", value)}
          allLabel="Any status"
        />
        <AdminFilterSelect
          label="Priority"
          value={filters.priority}
          options={optionsFrom(PRIORITY_LABELS)}
          onChange={(value) => update("priority", value)}
          allLabel="Any priority"
        />
        <AdminFilterSelect
          label="Category"
          value={filters.category}
          options={optionsFrom(CATEGORY_LABELS)}
          onChange={(value) => update("category", value)}
          allLabel="Any category"
        />
        <AdminFilterSelect
          label="Requester"
          value={filters.requesterRole}
          options={[
            { value: "homeowner", label: "Homeowner" },
            { value: "hoa_staff", label: "HOA manager / team" },
            { value: "provider", label: "Provider" },
          ]}
          onChange={(value) => update("requesterRole", value)}
          allLabel="Any role"
        />
        <AdminFilterSelect
          label="Assignee"
          value={filters.assignee}
          options={[
            { value: "unassigned", label: "Unassigned" },
            ...(data?.assignees ?? []).map((admin) => ({ value: admin.id, label: admin.name })),
          ]}
          onChange={(value) => update("assignee", value)}
          allLabel="Anyone"
        />
        <AdminFilterSelect
          label="Age"
          value={filters.minAgeDays}
          options={AGE_OPTIONS}
          onChange={(value) => update("minAgeDays", value)}
          allLabel="Any age"
        />
        <AdminFilterSelect
          label="Sort"
          value={filters.sort}
          options={(Object.keys(SORT_LABELS) as TicketSortOption[]).map((value) => ({
            value,
            label: SORT_LABELS[value],
          }))}
          onChange={(value) => update("sort", (value || "recent_activity") as TicketSortOption)}
          allLabel="Recent activity"
        />
      </AdminFilterBar>

      {error ? (
        <AdminErrorState
          body={error}
          retry={
            <button
              type="button"
              onClick={() => void load()}
              className="h-9 rounded-lg bg-rose-600 px-4 text-[12px] font-bold text-white"
            >
              Try again
            </button>
          }
        />
      ) : loading && !data ? (
        <AdminLoadingState label="Loading the ticket queue…" />
      ) : (
        <>
          <AdminDataTable
            caption="Support tickets"
            columns={columns}
            rows={data?.tickets ?? []}
            rowKey={(ticket) => ticket.id}
            rowHref={(ticket) => `/app/admin/support/${ticket.id}`}
            empty={
              <AdminEmptyState
                title={
                  activeFilterCount > 0 ? "No tickets match these filters" : "No support tickets yet"
                }
                body={
                  activeFilterCount > 0
                    ? "Clear a filter to widen the search."
                    : "Tickets raised by homeowners, HOA managers, and providers land here."
                }
              />
            }
          />
          {data && data.pageCount > 1 ? (
            <AdminPagination
              page={data.page}
              pageCount={data.pageCount}
              total={data.total}
              onPageChange={(page) => update("page", page)}
            />
          ) : null}
        </>
      )}

      <p className="px-1 text-[11px] text-slate-400">
        Need the full conversation?{" "}
        <Link className="font-semibold text-slate-600 underline" href="/app/admin/audit">
          The audit trail
        </Link>{" "}
        records every status change, assignment, and approved AI reply.
      </p>
    </div>
  );
}
