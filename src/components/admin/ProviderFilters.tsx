"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { Icon } from "@/components/ui/Icon";
import type { ProviderListQuery } from "@/lib/validation/community";

/** Search and filter controls for the provider list. See `CommunityFilters`. */
export function ProviderFilters({ query }: { query: ProviderListQuery }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState(query.search);

  useEffect(() => setSearch(query.search), [query.search]);

  function apply(changes: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }
    next.delete("page");
    router.replace(next.size > 0 ? `${pathname}?${next}` : pathname);
  }

  useEffect(() => {
    if (search === query.search) return;
    const timer = setTimeout(() => apply({ search: search || null }), 300);
    return () => clearTimeout(timer);
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
          placeholder="Search company, contact, email, or trade"
          aria-label="Search providers"
          className="min-w-0 flex-1 bg-transparent text-[12px] text-slate-800 outline-none placeholder:text-slate-400"
        />
      </label>

      <select
        value={query.status ?? ""}
        onChange={(event) => apply({ status: event.target.value || null })}
        aria-label="Filter by account status"
        className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-[11px] font-semibold text-slate-700 outline-none focus:border-emerald-500"
      >
        <option value="">All statuses</option>
        <option value="pending">Pending</option>
        <option value="active">Active</option>
        <option value="suspended">Suspended</option>
      </select>

      <select
        value={query.verification ?? ""}
        onChange={(event) => apply({ verification: event.target.value || null })}
        aria-label="Filter by verification state"
        className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-[11px] font-semibold text-slate-700 outline-none focus:border-emerald-500"
      >
        <option value="">Any verification</option>
        <option value="verified">Licence and insurance verified</option>
        <option value="unverified">Missing a verification</option>
      </select>
    </div>
  );
}
