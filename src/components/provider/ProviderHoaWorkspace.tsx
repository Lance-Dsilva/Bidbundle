"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";

import type {
  OccurrenceSummary,
  ProviderFeedItem,
  ProviderHoaWorkspace,
  VisitSummary,
} from "@/lib/hoa-types";

type ActionState = { busy: boolean; error: string | null; success: string | null };
const IDLE: ActionState = { busy: false, error: null, success: null };

async function sendJson(method: string, path: string, body?: unknown): Promise<void> {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    ...(body !== undefined
      ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
      : {}),
  });
  const result = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok) throw new Error(result?.error ?? "Something went wrong. Please try again.");
}

function money(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

function dateLabel(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString() : "—";
}

export function ProviderHoaWorkspaceView({ workspace }: { workspace: ProviderHoaWorkspace }) {
  const router = useRouter();
  const [areaState, setAreaState] = useState(IDLE);
  const [bidState, setBidState] = useState(IDLE);
  const [planState, setPlanState] = useState(IDLE);

  const run = async (
    setter: (state: ActionState) => void,
    success: string,
    action: () => Promise<void>,
  ) => {
    setter({ busy: true, error: null, success: null });
    try {
      await action();
      setter({ busy: false, error: null, success });
      router.refresh();
    } catch (error) {
      setter({
        busy: false,
        error: error instanceof Error ? error.message : "Something went wrong.",
        success: null,
      });
    }
  };

  const submitArea = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const lat = String(data.get("centerLatitude") ?? "").trim();
    const lng = String(data.get("centerLongitude") ?? "").trim();
    const radius = String(data.get("radiusMiles") ?? "").trim();
    const postal = String(data.get("postalCodes") ?? "")
      .split(",")
      .map((code) => code.trim())
      .filter(Boolean);
    void run(setAreaState, "Service area saved.", async () => {
      await sendJson("POST", "/api/provider/hoa/service-areas", {
        label: data.get("label"),
        centerLatitude: lat ? Number(lat) : null,
        centerLongitude: lng ? Number(lng) : null,
        radiusMiles: radius ? Number(radius) : null,
        postalCodes: postal,
      });
      form.reset();
    });
  };

  return (
    <div className="space-y-7">
      <header>
        <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#0f8f83]">HOA marketplace</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-[#102a43]">HOA jobs</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[#64748b]">
          Bid on whole-community procurements, then plan and complete each service day home by home.
        </p>
      </header>

      {!workspace.eligible ? (
        <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800" role="status">
          {workspace.ineligibleReason} You can still prepare your service areas below.
        </p>
      ) : null}

      {/* ── Coverage ─────────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-[#dce7e4] bg-white p-5 shadow-sm sm:p-6">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#0f8f83]">Coverage</p>
        <h2 className="mt-1 text-xl font-bold text-[#102a43]">Service categories & areas</h2>
        <p className="mt-2 text-sm text-[#64748b]">
          You only see HOA requests that match a service you offer{" "}
          {workspace.categories.length > 0 ? (
            <>
              (currently: <strong>{workspace.categories.join(", ")}</strong>; edit in your profile)
            </>
          ) : (
            <>— add your trades in your profile first</>
          )}{" "}
          and fall inside an active service area.
        </p>
        <div className="mt-4 grid gap-6 lg:grid-cols-2">
          <form className="space-y-3" onSubmit={submitArea}>
            <Field name="label" label="Area name" placeholder="North Austin" />
            <div className="grid grid-cols-3 gap-2">
              <Field name="centerLatitude" label="Latitude" placeholder="30.40" required={false} />
              <Field name="centerLongitude" label="Longitude" placeholder="-97.72" required={false} />
              <Field name="radiusMiles" label="Radius (mi)" placeholder="15" required={false} />
            </div>
            <Field
              name="postalCodes"
              label="Postal codes (comma separated, optional)"
              placeholder="78758, 78727"
              required={false}
            />
            <button className={primaryButton} disabled={areaState.busy} type="submit">
              {areaState.busy ? "Saving…" : "Add service area"}
            </button>
            <ActionMessage state={areaState} />
          </form>
          <div className="rounded-xl bg-[#f6faf9] p-4">
            <h3 className="text-sm font-semibold text-[#102a43]">Active areas</h3>
            {workspace.serviceAreas.length === 0 ? (
              <p className="mt-2 text-sm text-[#64748b]">
                No service areas yet — add one to see eligible HOA requests.
              </p>
            ) : (
              <ul className="mt-2 space-y-2 text-sm">
                {workspace.serviceAreas.map((area) => (
                  <li className="flex items-center justify-between gap-2 rounded-lg bg-white px-3 py-2" key={area.id}>
                    <span className="min-w-0 truncate text-[#334e68]">
                      <strong>{area.label}</strong>
                      {area.radiusMiles ? ` · ${area.radiusMiles} mi circle` : ""}
                      {area.postalCodes.length > 0 ? ` · ${area.postalCodes.join(", ")}` : ""}
                    </span>
                    <button
                      className="text-[11px] font-semibold text-red-600"
                      disabled={areaState.busy}
                      onClick={() =>
                        void run(setAreaState, "Service area removed.", () =>
                          sendJson("DELETE", `/api/provider/hoa/service-areas/${area.id}`),
                        )
                      }
                      type="button"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      {/* ── Eligible requests ────────────────────────────────────────── */}
      <section className="rounded-2xl border border-[#dce7e4] bg-white p-5 shadow-sm sm:p-6">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#0f8f83]">Open procurements</p>
        <h2 className="mt-1 text-xl font-bold text-[#102a43]">Eligible HOA requests</h2>
        {workspace.feed.length === 0 ? (
          <Empty
            text={
              workspace.eligible
                ? "No open HOA requests match your categories and service areas right now."
                : "Requests appear here once your account is active and verified."
            }
          />
        ) : (
          <div className="mt-4 space-y-4">
            {workspace.feed.map((item) => (
              <FeedCard
                key={item.requestId}
                item={item}
                busy={bidState.busy}
                onBid={(body) =>
                  void run(setBidState, "Bid submitted.", () =>
                    sendJson("PUT", `/api/provider/hoa/requests/${item.requestId}/bid`, body),
                  )
                }
                onWithdraw={() =>
                  void run(setBidState, "Bid withdrawn.", () =>
                    sendJson("DELETE", `/api/provider/hoa/requests/${item.requestId}/bid`),
                  )
                }
              />
            ))}
            <ActionMessage state={bidState} />
          </div>
        )}
      </section>

      {/* ── My bids ──────────────────────────────────────────────────── */}
      {workspace.bids.length > 0 ? (
        <section className="rounded-2xl border border-[#dce7e4] bg-white p-5 shadow-sm sm:p-6">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#0f8f83]">History</p>
          <h2 className="mt-1 text-xl font-bold text-[#102a43]">My HOA bids</h2>
          <ul className="mt-3 space-y-2">
            {workspace.bids.map((bid) => (
              <li className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#e1e8e6] px-4 py-3 text-sm" key={bid.id}>
                <span className="min-w-0 truncate text-[#334e68]">
                  {money(bid.amountCents, bid.currency)}{" "}
                  {bid.pricingBasis === "per_home" ? "per home" : bid.pricingBasis === "per_visit" ? "per visit" : "total"}{" "}
                  · v{bid.version} · submitted {dateLabel(bid.submittedAt)}
                </span>
                <Badge
                  tone={bid.status === "accepted" ? "green" : bid.status === "submitted" ? "amber" : "gray"}
                >
                  {bid.status}
                </Badge>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* ── Won agreements & day planner ─────────────────────────────── */}
      <section className="rounded-2xl border border-[#dce7e4] bg-white p-5 shadow-sm sm:p-6">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#0f8f83]">Awarded work</p>
        <h2 className="mt-1 text-xl font-bold text-[#102a43]">Agreements & day planner</h2>
        {workspace.agreements.length === 0 ? (
          <Empty text="No awarded HOA agreements yet." />
        ) : (
          <div className="mt-4 space-y-5">
            {workspace.agreements.map((agreement) => (
              <article className="rounded-xl border border-[#e1e8e6] p-4" key={agreement.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-[#102a43]">
                      {agreement.requestTitle} · {agreement.communityName}
                    </h3>
                    <p className="mt-1 text-sm text-[#64748b]">
                      {money(agreement.amountCents, agreement.currency)}{" "}
                      {agreement.pricingBasis === "per_home" ? "per home" : agreement.pricingBasis === "per_visit" ? "per visit" : "total"}{" "}
                      · {agreement.lockedHomeCount} homes · starts {dateLabel(agreement.startDate)}
                    </p>
                  </div>
                  <Badge tone={agreement.status === "active" ? "green" : "gray"}>{agreement.status}</Badge>
                </div>
                {(workspace.occurrencesByAgreement[agreement.id] ?? []).map((occurrence) => (
                  <DayPlanner
                    key={occurrence.id}
                    occurrence={occurrence}
                    busy={planState.busy}
                    onSave={(stops, publish) =>
                      void run(
                        setPlanState,
                        publish ? "Plan published — homes notified." : "Plan saved.",
                        () =>
                          sendJson("POST", `/api/provider/hoa/occurrences/${occurrence.id}/plan`, {
                            stops,
                            publish,
                          }),
                      )
                    }
                    onVisitStatus={(visitId, status, completionNote) =>
                      void run(setPlanState, "Visit updated.", () =>
                        sendJson("POST", `/api/provider/hoa/visits/${visitId}/status`, {
                          status,
                          completionNote: completionNote ?? null,
                        }),
                      )
                    }
                  />
                ))}
                <ActionMessage state={planState} />
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/* ── Feed card with inline bid editor ────────────────────────────────────── */

function FeedCard({
  item,
  busy,
  onBid,
  onWithdraw,
}: {
  item: ProviderFeedItem;
  busy: boolean;
  onBid: (body: Record<string, unknown>) => void;
  onWithdraw: () => void;
}) {
  const [open, setOpen] = useState(false);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const amount = Number(String(data.get("amount") ?? "0"));
    const startDateRaw = String(data.get("proposedStartDate") ?? "").trim();
    onBid({
      amountCents: Math.round(amount * 100),
      pricingBasis: data.get("pricingBasis"),
      proposedStartDate: startDateRaw ? new Date(startDateRaw).toISOString() : null,
      estimatedDurationLabel: (data.get("estimatedDurationLabel") as string) || null,
      scope: data.get("scope"),
      exclusions: (data.get("exclusions") as string) || null,
      cadenceLabel: item.recurrenceLabel,
      validUntil: null,
    });
    setOpen(false);
  };

  return (
    <article className="rounded-xl border border-[#e1e8e6] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-[#0f8f83]">
            {item.category} · {item.communityName}
            {item.locality ? ` · ${item.locality}, ${item.region ?? ""}` : ""}
          </p>
          <h3 className="mt-1 font-semibold text-[#102a43]">{item.title}</h3>
        </div>
        <div className="text-right text-xs text-[#64748b]">
          <p>
            <strong className="text-[#102a43]">{item.homeCount}</strong> homes ·{" "}
            {item.totalOccurrences} {item.totalOccurrences === 1 ? "visit" : "cycles"}
          </p>
          <p>Bids close {dateLabel(item.biddingClosesAt)}</p>
        </div>
      </div>
      <p className="mt-2 line-clamp-3 text-sm text-[#64748b]">{item.description}</p>
      {item.recurrenceLabel ? (
        <p className="mt-1 text-xs text-[#64748b]">Cadence: {item.recurrenceLabel}</p>
      ) : null}

      {item.myBid ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[#f6faf9] px-3 py-2 text-sm">
          <span className="text-[#334e68]">
            Your bid: <strong>{money(item.myBid.amountCents, item.myBid.currency)}</strong>{" "}
            {item.myBid.pricingBasis === "per_home" ? "per home" : item.myBid.pricingBasis === "per_visit" ? "per visit" : "total"}{" "}
            · v{item.myBid.version} · {item.myBid.status}
          </span>
          {item.myBid.status === "submitted" ? (
            <span className="flex gap-2">
              <button
                className="rounded-lg border border-[#b9d9d2] px-3 py-1.5 text-xs font-semibold text-[#0f756c]"
                disabled={busy}
                onClick={() => setOpen((value) => !value)}
                type="button"
              >
                Revise
              </button>
              <button
                className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600"
                disabled={busy}
                onClick={onWithdraw}
                type="button"
              >
                Withdraw
              </button>
            </span>
          ) : null}
        </div>
      ) : (
        <button
          className="mt-3 rounded-lg bg-[#0f8f83] px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
          disabled={busy}
          onClick={() => setOpen((value) => !value)}
          type="button"
        >
          {open ? "Hide bid form" : "Bid on this request"}
        </button>
      )}

      {open ? (
        <form className="mt-4 grid gap-3 rounded-xl bg-[#f6faf9] p-4 md:grid-cols-2" onSubmit={submit}>
          <Field
            name="amount"
            label="Price (USD)"
            type="number"
            placeholder="450.00"
            step="0.01"
            defaultValue={item.myBid ? String(item.myBid.amountCents / 100) : undefined}
          />
          <label>
            <span className="mb-1 block text-xs font-semibold text-[#334e68]">Pricing basis</span>
            <select className={inputClass} defaultValue={item.myBid?.pricingBasis ?? "per_visit"} name="pricingBasis">
              <option value="per_visit">Per visit/cycle</option>
              <option value="per_home">Per home</option>
              <option value="total">Total contract</option>
            </select>
          </label>
          <Field name="proposedStartDate" label="Proposed start" type="date" required={false} />
          <Field
            name="estimatedDurationLabel"
            label="Estimated duration"
            placeholder="1 day per cycle"
            required={false}
          />
          <label className="md:col-span-2">
            <span className="mb-1 block text-xs font-semibold text-[#334e68]">Scope included</span>
            <textarea
              className={`${inputClass} min-h-20 py-3`}
              defaultValue={item.myBid?.scope}
              name="scope"
              placeholder="What your crew covers on each visit."
              required
            />
          </label>
          <label className="md:col-span-2">
            <span className="mb-1 block text-xs font-semibold text-[#334e68]">Exclusions (optional)</span>
            <input className={inputClass} defaultValue={item.myBid?.exclusions ?? ""} name="exclusions" placeholder="What is not included." />
          </label>
          <div className="md:col-span-2">
            <button className={primaryButton} disabled={busy} type="submit">
              {busy ? "Submitting…" : item.myBid ? "Submit revision" : "Submit bid"}
            </button>
          </div>
        </form>
      ) : null}
    </article>
  );
}

/* ── Day planner: accessible ordered list with rank controls ─────────────── */

type PlannedStop = {
  visitId: string;
  unitLabel: string;
  status: VisitSummary["status"];
  windowStart: string;
  windowEnd: string;
};

function DayPlanner({
  occurrence,
  busy,
  onSave,
  onVisitStatus,
}: {
  occurrence: OccurrenceSummary;
  busy: boolean;
  onSave: (
    stops: Array<{
      visitId: string;
      stopRank: number;
      windowStart: string | null;
      windowEnd: string | null;
    }>,
    publish: boolean,
  ) => void;
  onVisitStatus: (visitId: string, status: string, completionNote?: string) => void;
}) {
  const [stops, setStops] = useState<PlannedStop[]>(() =>
    occurrence.visits.map((visit) => ({
      visitId: visit.id,
      unitLabel: visit.unitLabel,
      status: visit.status,
      windowStart: visit.windowStart ?? "",
      windowEnd: visit.windowEnd ?? "",
    })),
  );
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= stops.length) return;
    const next = [...stops];
    [next[index], next[target]] = [next[target], next[index]];
    setStops(next);
  };

  const setWindow = (index: number, key: "windowStart" | "windowEnd", value: string) => {
    setStops((current) =>
      current.map((stop, stopIndex) => (stopIndex === index ? { ...stop, [key]: value } : stop)),
    );
  };

  const buildPayload = () =>
    stops.map((stop, index) => ({
      visitId: stop.visitId,
      stopRank: index + 1,
      windowStart: stop.windowStart || null,
      windowEnd: stop.windowEnd || null,
    }));

  const dayLabel = new Date(occurrence.serviceDate).toLocaleDateString();
  const planEditable = occurrence.status === "planned" || occurrence.status === "in_progress";

  return (
    <div className="mt-4 rounded-xl bg-[#f6faf9] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-[#102a43]">
          Cycle {occurrence.sequence} · {dayLabel}
        </p>
        <span className="flex items-center gap-2">
          {occurrence.schedulePublishedAt ? <Badge tone="green">Published</Badge> : <Badge tone="amber">Unpublished</Badge>}
          <Badge tone={occurrence.status === "completed" ? "green" : "gray"}>
            {occurrence.status.replace("_", " ")}
          </Badge>
        </span>
      </div>

      <ol className="mt-3 space-y-2" aria-label={`Stop order for ${dayLabel}`}>
        {stops.map((stop, index) => (
          <li className="rounded-lg bg-white p-3" key={stop.visitId}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#0f8f83] text-xs font-bold text-white">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-[#102a43]">
                {stop.unitLabel}
              </span>
              <Badge
                tone={stop.status === "completed" ? "green" : ["skipped", "blocked"].includes(stop.status) ? "amber" : "gray"}
              >
                {stop.status.replace("_", " ")}
              </Badge>
              {planEditable ? (
                <span className="flex gap-1">
                  <button
                    aria-label={`Move ${stop.unitLabel} earlier`}
                    className="h-7 w-7 rounded border border-[#d8e2e0] text-xs font-bold text-[#334e68] disabled:opacity-40"
                    disabled={busy || index === 0}
                    onClick={() => move(index, -1)}
                    type="button"
                  >
                    ↑
                  </button>
                  <button
                    aria-label={`Move ${stop.unitLabel} later`}
                    className="h-7 w-7 rounded border border-[#d8e2e0] text-xs font-bold text-[#334e68] disabled:opacity-40"
                    disabled={busy || index === stops.length - 1}
                    onClick={() => move(index, 1)}
                    type="button"
                  >
                    ↓
                  </button>
                </span>
              ) : null}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1 text-xs text-[#64748b]">
                From
                <input
                  className="h-8 rounded border border-[#d8e2e0] px-2 text-xs"
                  onChange={(event) => setWindow(index, "windowStart", event.currentTarget.value)}
                  type="time"
                  value={stop.windowStart}
                />
              </label>
              <label className="flex items-center gap-1 text-xs text-[#64748b]">
                to
                <input
                  className="h-8 rounded border border-[#d8e2e0] px-2 text-xs"
                  onChange={(event) => setWindow(index, "windowEnd", event.currentTarget.value)}
                  type="time"
                  value={stop.windowEnd}
                />
              </label>
              {["scheduled", "en_route", "in_progress"].includes(stop.status) ? (
                <span className="ml-auto flex flex-wrap gap-1">
                  {stop.status === "scheduled" ? (
                    <SmallAction disabled={busy} onClick={() => onVisitStatus(stop.visitId, "en_route")}>
                      En route
                    </SmallAction>
                  ) : null}
                  {stop.status !== "in_progress" ? (
                    <SmallAction disabled={busy} onClick={() => onVisitStatus(stop.visitId, "in_progress")}>
                      Start
                    </SmallAction>
                  ) : null}
                  <SmallAction disabled={busy} onClick={() => onVisitStatus(stop.visitId, "completed")}>
                    Complete
                  </SmallAction>
                  <SmallAction disabled={busy} onClick={() => setNoteFor(noteFor === stop.visitId ? null : stop.visitId)}>
                    Skip/Block
                  </SmallAction>
                </span>
              ) : null}
            </div>
            {noteFor === stop.visitId ? (
              <div className="mt-2 flex flex-wrap gap-2">
                <input
                  className="h-8 min-w-0 flex-1 rounded border border-[#d8e2e0] px-2 text-xs"
                  onChange={(event) => setNote(event.currentTarget.value)}
                  placeholder="Why is this stop skipped or blocked?"
                  value={note}
                />
                <SmallAction
                  disabled={busy || !note.trim()}
                  onClick={() => {
                    onVisitStatus(stop.visitId, "skipped", note.trim());
                    setNoteFor(null);
                    setNote("");
                  }}
                >
                  Skip
                </SmallAction>
                <SmallAction
                  disabled={busy || !note.trim()}
                  onClick={() => {
                    onVisitStatus(stop.visitId, "blocked", note.trim());
                    setNoteFor(null);
                    setNote("");
                  }}
                >
                  Blocked
                </SmallAction>
              </div>
            ) : null}
          </li>
        ))}
      </ol>

      {planEditable ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            className="rounded-lg border border-[#b9d9d2] px-4 py-2 text-xs font-semibold text-[#0f756c] disabled:opacity-50"
            disabled={busy}
            onClick={() => onSave(buildPayload(), false)}
            type="button"
          >
            Save order
          </button>
          <button
            className="rounded-lg bg-[#0f8f83] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
            disabled={busy}
            onClick={() => onSave(buildPayload(), true)}
            type="button"
          >
            Publish schedule
          </button>
        </div>
      ) : null}
    </div>
  );
}

/* ── Shared bits ─────────────────────────────────────────────────────────── */

const inputClass =
  "h-11 w-full rounded-xl border border-[#d8e2e0] bg-white px-3 text-sm text-[#102a43] outline-none focus:border-[#0f8f83]";
const primaryButton =
  "h-11 rounded-xl bg-[#0f8f83] px-5 text-sm font-semibold text-white disabled:opacity-60";

function Field({
  name,
  label,
  placeholder,
  type = "text",
  defaultValue,
  required = true,
  step,
}: {
  name: string;
  label: string;
  placeholder?: string;
  type?: string;
  defaultValue?: string;
  required?: boolean;
  step?: string;
}) {
  return (
    <label>
      <span className="mb-1 block text-xs font-semibold text-[#334e68]">{label}</span>
      <input
        className={inputClass}
        defaultValue={defaultValue}
        name={name}
        placeholder={placeholder}
        required={required}
        step={step}
        type={type}
      />
    </label>
  );
}

function ActionMessage({ state }: { state: ActionState }) {
  if (state.error)
    return (
      <p className="mt-3 text-sm font-medium text-red-600" role="alert">
        {state.error}
      </p>
    );
  if (state.success)
    return (
      <p className="mt-3 text-sm font-medium text-green-700" role="status">
        {state.success}
      </p>
    );
  return null;
}

function Empty({ text }: { text: string }) {
  return <p className="mt-4 rounded-xl bg-[#f6faf9] p-4 text-sm text-[#64748b]">{text}</p>;
}

function Badge({ children, tone }: { children: ReactNode; tone: "green" | "amber" | "gray" }) {
  const tones = {
    green: "bg-[#e8f7ee] text-[#16803c]",
    amber: "bg-[#fff5df] text-[#a15c00]",
    gray: "bg-[#eef1f4] text-[#64748b]",
  } as const;
  return (
    <span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase ${tones[tone]}`}>
      {children}
    </span>
  );
}

function SmallAction({
  children,
  disabled,
  onClick,
}: {
  children: ReactNode;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className="rounded border border-[#b9d9d2] px-2 py-1 text-[11px] font-semibold text-[#0f756c] disabled:opacity-50"
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}
