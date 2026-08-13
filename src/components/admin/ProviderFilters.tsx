"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

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

  const controlStyle = {
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
        placeholder="Search by company, name, email, or trade"
        aria-label="Search providers"
        className="h-9 min-w-0 flex-1 rounded-xl border px-3 text-[13px] outline-none"
        style={controlStyle}
      />

      <select
        value={query.status ?? ""}
        onChange={(event) => apply({ status: event.target.value || null })}
        aria-label="Filter by account status"
        className="h-9 rounded-xl border px-2 text-[13px]"
        style={controlStyle}
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
        className="h-9 rounded-xl border px-2 text-[13px]"
        style={controlStyle}
      >
        <option value="">Any verification</option>
        <option value="verified">Licence and insurance verified</option>
        <option value="unverified">Missing a verification</option>
      </select>
    </div>
  );
}
