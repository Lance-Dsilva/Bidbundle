"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { apiFetch } from "@/lib/api";
import type { CommunityInterestList } from "@/lib/community-interest-types";
import { COMMUNITY_INTEREST_ROLE_LABELS, communityInterestListSchema } from "@/lib/validation/community-interest";

const PAGE_SIZE = 20;
type QueueState = { status: "loading" | "ready" | "error"; data: CommunityInterestList | null; error: string | null };

export function CommunityInterestQueue() {
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<QueueState>({ status: "loading", data: null, error: null });
  const pending = useRef(false);
  const requestNumber = useRef(0);
  const focusAfterLoad = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const alert = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const number = ++requestNumber.current;
    const controller = new AbortController();
    let active = true;
    pending.current = true;
    setState({ status: "loading", data: null, error: null });
    void (async () => {
      try {
        const result = await apiFetch<unknown>(`/admin/community-interest?page=${page}&pageSize=${PAGE_SIZE}`, { cache: "no-store", signal: controller.signal });
        const parsed = communityInterestListSchema.safeParse(result);
        if (!parsed.success || parsed.data.page !== page || parsed.data.pageSize !== PAGE_SIZE) throw new Error("The community interest queue could not be read. Please try again.");
        if (active && !controller.signal.aborted && requestNumber.current === number) setState({ status: "ready", data: parsed.data, error: null });
      } catch (caught) {
        if (active && !controller.signal.aborted && requestNumber.current === number) setState({ status: "error", data: null, error: caught instanceof Error ? caught.message : "The community interest queue could not be loaded. Please try again." });
      } finally {
        if (active && requestNumber.current === number) pending.current = false;
      }
    })();
    return () => { active = false; controller.abort(); };
  }, [page, attempt]);

  useEffect(() => {
    if (state.status === "error") alert.current?.focus();
    else if (state.status === "ready" && focusAfterLoad.current) heading.current?.focus();
    if (state.status !== "loading") focusAfterLoad.current = false;
  }, [state.status]);

  const reload = () => {
    if (pending.current) return;
    pending.current = true;
    focusAfterLoad.current = true;
    setAttempt((current) => current + 1);
  };
  const changePage = (next: number) => {
    if (pending.current || state.status !== "ready" || next < 1) return;
    pending.current = true;
    focusAfterLoad.current = true;
    setPage(next);
  };
  const lastPage = Math.max(1, Math.ceil((state.data?.total ?? 0) / PAGE_SIZE));
  const loading = state.status === "loading";
  const refreshLabel = loading ? "Loading…" : state.status === "error" ? "Try again" : "Refresh";

  return (
    <div className="px-4 py-6 md:px-6 xl:px-8 xl:py-7">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">Customers</p>
            <h1 ref={heading} tabIndex={-1} className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">Community interest</h1>
          </div>
          <Button className="min-h-11" disabled={loading} onClick={(event) => { if (event.detail <= 1) reload(); }} variant="secondary">
            <span className="grid">{["Refresh", "Try again", "Loading…"].map((label) => <span key={label} aria-hidden={label !== refreshLabel} className={`col-start-1 row-start-1${label !== refreshLabel ? " invisible" : ""}`}>{label}</span>)}</span>
          </Button>
        </header>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">These are unverified, self-reported contact details from the public interest form. A submission is not an account, a verified community representative, or permission to grant access. Review the details before following the existing community setup and invitation process.</p>
        <section aria-label="Community interest submissions" aria-busy={loading} className="mt-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          {loading ? <p role="status" className="py-8 text-sm text-slate-600">Loading community interest…</p>
            : state.status === "error" ? <p ref={alert} tabIndex={-1} role="alert" className="py-8 text-sm leading-6 text-red-700">{state.error}</p>
              : state.data?.items.length === 0 ? <p className="py-8 text-sm text-slate-600">No community interest submissions on this page.</p>
                : <ul className="grid gap-4 lg:grid-cols-2">
                  {state.data?.items.map((item) => (
                    <li key={item.id} className="min-w-0 rounded-xl border border-slate-200 p-4">
                      <h2 className="break-words text-base font-semibold text-slate-900">{item.communityName}</h2>
                      <p className="mt-1 text-sm text-slate-600">{item.numberOfHomes.toLocaleString()} {item.numberOfHomes === 1 ? "home" : "homes"}</p>
                      <dl className="mt-4 space-y-3 text-sm">
                        <div><dt className="font-medium text-slate-500">Contact</dt><dd className="break-words text-slate-900">{item.contactName}</dd></div>
                        <div><dt className="font-medium text-slate-500">Self-reported connection</dt><dd className="text-slate-900">{COMMUNITY_INTEREST_ROLE_LABELS[item.contactRole]}</dd></div>
                        <div><dt className="font-medium text-slate-500">Email</dt><dd className="break-all text-slate-900">{item.email}</dd></div>
                        <div><dt className="font-medium text-slate-500">Phone</dt><dd className="break-words text-slate-900">{item.phone || "Not provided"}</dd></div>
                        <div><dt className="font-medium text-slate-500">Received</dt><dd className="text-slate-900"><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</time></dd></div>
                      </dl>
                    </li>
                  ))}
                </ul>}
          <nav aria-label="Community interest pages" className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4">
            <Button className="min-h-11" disabled={state.status !== "ready" || page <= 1} onClick={(event) => { if (event.detail <= 1) changePage(page - 1); }} variant="secondary">Previous page</Button>
            <p className="text-sm text-slate-600">{state.data ? `Page ${state.data.page} of ${lastPage} · ${state.data.total} submissions` : `Page ${page}`}</p>
            <Button className="min-h-11" disabled={state.status !== "ready" || page >= lastPage} onClick={(event) => { if (event.detail <= 1) changePage(page + 1); }} variant="secondary">Next page</Button>
          </nav>
        </section>
      </div>
    </div>
  );
}
