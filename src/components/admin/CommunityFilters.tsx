"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { Icon } from "@/components/ui/Icon";
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

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50/70 px-4 py-3">
      <label className="flex h-9 min-w-[220px] flex-1 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-slate-400 focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-100">
        <Icon name="search" size={15} />
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search customer accounts"
          aria-label="Search communities by name"
          className="min-w-0 flex-1 bg-transparent text-[12px] text-slate-800 outline-none placeholder:text-slate-400"
        />
      </label>

      <select
        value={query.type ?? ""}
        onChange={(event) => apply({ type: event.target.value || null })}
        aria-label="Filter by community type"
        className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-[11px] font-semibold text-slate-700 outline-none focus:border-emerald-500"
      >
        <option value="">All types</option>
        <option value="hoa">HOA</option>
        <option value="neighborhood">Neighborhood</option>
      </select>

      <select
        value={query.status ?? ""}
        onChange={(event) => apply({ status: event.target.value || null })}
        aria-label="Filter by status"
        className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-[11px] font-semibold text-slate-700 outline-none focus:border-emerald-500"
      >
        <option value="">All statuses</option>
        <option value="active">Active</option>
        <option value="archived">Archived</option>
      </select>

      <select
        value={query.managerState ?? ""}
        onChange={(event) => apply({ managerState: event.target.value || null })}
        aria-label="Filter by manager state"
        className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-[11px] font-semibold text-slate-700 outline-none focus:border-emerald-500"
      >
        <option value="">Any manager state</option>
        <option value="assigned">Has a manager</option>
        <option value="unassigned">No manager</option>
      </select>
    </div>
  );
}
