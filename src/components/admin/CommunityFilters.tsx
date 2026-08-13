"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import type { CommunityListQuery } from "@/lib/validation/community";

/**
 * Search and filter controls for the community list.
 *
 * Writes to the URL rather than to local state, so the server component
 * re-runs the query and the browser back button undoes a filter. The search
 * box is debounced because every keystroke would otherwise be a database
 * round trip.
 */
export function CommunityFilters({ query }: { query: CommunityListQuery }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState(query.search);

  // Keep the input in step when navigation changes the URL from elsewhere,
  // such as a link from the overview tiles or the back button.
  useEffect(() => setSearch(query.search), [query.search]);

  function apply(changes: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }
    // Any filter change invalidates the current page number.
    next.delete("page");
    router.replace(next.size > 0 ? `${pathname}?${next}` : pathname);
  }

  useEffect(() => {
    if (search === query.search) return;
    const timer = setTimeout(() => apply({ search: search || null }), 300);
    return () => clearTimeout(timer);
    // `apply` closes over the current params, which is what we want at fire time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const selectStyle = {
    background: "var(--paper)",
    borderColor: "var(--line)",
    color: "var(--ink-900)",
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search by community name"
        aria-label="Search communities by name"
        className="h-9 min-w-0 flex-1 rounded-xl border px-3 text-[13px] outline-none"
        style={selectStyle}
      />

      <select
        value={query.type ?? ""}
        onChange={(event) => apply({ type: event.target.value || null })}
        aria-label="Filter by community type"
        className="h-9 rounded-xl border px-2 text-[13px]"
        style={selectStyle}
      >
        <option value="">All types</option>
        <option value="hoa">HOA</option>
        <option value="neighborhood">Neighborhood</option>
      </select>

      <select
        value={query.status ?? ""}
        onChange={(event) => apply({ status: event.target.value || null })}
        aria-label="Filter by status"
        className="h-9 rounded-xl border px-2 text-[13px]"
        style={selectStyle}
      >
        <option value="">All statuses</option>
        <option value="active">Active</option>
        <option value="archived">Archived</option>
      </select>

      <select
        value={query.managerState ?? ""}
        onChange={(event) => apply({ managerState: event.target.value || null })}
        aria-label="Filter by manager state"
        className="h-9 rounded-xl border px-2 text-[13px]"
        style={selectStyle}
      >
        <option value="">Any manager state</option>
        <option value="assigned">Has a manager</option>
        <option value="unassigned">No manager</option>
      </select>
    </div>
  );
}
