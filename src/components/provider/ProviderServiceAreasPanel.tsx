"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  ProviderServiceAreaEditor,
  isServiceAreaDraftValid,
  type ContextCircle,
  type ServiceAreaDraft,
} from "@/components/provider/ProviderServiceAreaEditor";
import {
  MAX_ACTIVE_SERVICE_AREAS,
  SERVICE_RADIUS_DEFAULT_MILES,
  coverageListLabel,
  coverageSummary,
} from "@/lib/provider-coverage";

/**
 * The canonical place a provider manages coverage for the rest of the account's
 * life. Onboarding creates the first circle; everything after that happens
 * here, using the same {@link ProviderServiceAreaEditor}.
 *
 * Reads and writes go through `/api/provider/service-areas`, which re-derives
 * ownership from the Clerk session — an id in a URL is never authorization.
 */

type ServiceAreaRecord = ServiceAreaDraft & {
  id: string;
  isPrimary: boolean;
  status: "active" | "removed";
};

type ApiArea = {
  id: string;
  label: string;
  centerLatitude: number | null;
  centerLongitude: number | null;
  radiusMiles: number | null;
  isPrimary: boolean;
  formattedAddress: string | null;
  locality: string | null;
  region: string | null;
  postalCode: string | null;
  countryCode: string | null;
  status: "active" | "removed";
};

type Feedback = { tone: "success" | "error"; message: string } | null;

/** Areas without a full circle predate the map editor and cannot be drawn. */
function toRecord(area: ApiArea): ServiceAreaRecord | null {
  if (area.centerLatitude == null || area.centerLongitude == null || area.radiusMiles == null) {
    return null;
  }
  return {
    id: area.id,
    label: area.label,
    centerLatitude: area.centerLatitude,
    centerLongitude: area.centerLongitude,
    radiusMiles: area.radiusMiles,
    formattedAddress: area.formattedAddress,
    locality: area.locality,
    region: area.region,
    postalCode: area.postalCode,
    countryCode: area.countryCode,
    isPrimary: area.isPrimary,
    status: area.status,
  };
}

function draftPayload(draft: ServiceAreaDraft, isPrimary?: boolean) {
  return {
    label: draft.label.trim(),
    centerLatitude: draft.centerLatitude,
    centerLongitude: draft.centerLongitude,
    radiusMiles: draft.radiusMiles,
    formattedAddress: draft.formattedAddress,
    locality: draft.locality,
    region: draft.region,
    postalCode: draft.postalCode,
    countryCode: draft.countryCode,
    ...(isPrimary === undefined ? {} : { isPrimary }),
  };
}

export function ProviderServiceAreasPanel({
  onAreasChanged,
}: {
  /** Lets the page refresh matched opportunities right after a saved edit. */
  onAreasChanged?: () => void;
}) {
  const [areas, setAreas] = useState<ServiceAreaRecord[]>([]);
  const [unmappable, setUnmappable] = useState<ApiArea[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ServiceAreaDraft | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);

  const load = useCallback(async (options?: { keepSelection?: boolean }) => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch("/api/provider/service-areas", {
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error("load failed");
      const payload = (await response.json()) as { areas: ApiArea[] };
      const records = payload.areas
        .map(toRecord)
        .filter((record): record is ServiceAreaRecord => record !== null);
      setAreas(records);
      setUnmappable(
        payload.areas.filter(
          (area) =>
            area.centerLatitude == null ||
            area.centerLongitude == null ||
            area.radiusMiles == null,
        ),
      );
      setSelectedId((current) => {
        if (options?.keepSelection && current && records.some((r) => r.id === current)) {
          return current;
        }
        return records.find((record) => record.isPrimary)?.id ?? records[0]?.id ?? null;
      });
    } catch {
      setLoadError("We could not load your service areas. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = useMemo(
    () => areas.find((area) => area.id === selectedId) ?? null,
    [areas, selectedId],
  );

  // The editor works on a copy so an abandoned edit never rewrites the list.
  useEffect(() => {
    if (creating) return;
    setDraft(selected ? { ...selected } : null);
  }, [selected, creating]);

  const contextCircles: readonly ContextCircle[] = useMemo(
    () =>
      areas
        .filter((area) => (creating ? true : area.id !== selectedId))
        .map((area) => ({
          id: area.id,
          label: area.label,
          centerLatitude: area.centerLatitude,
          centerLongitude: area.centerLongitude,
          radiusMiles: area.radiusMiles,
        })),
    [areas, selectedId, creating],
  );

  const startCreate = () => {
    setCreating(true);
    setConfirmRemoveId(null);
    setFeedback(null);
    const seed = areas.find((area) => area.isPrimary) ?? areas[0] ?? null;
    setDraft(
      seed
        ? {
            label: "",
            centerLatitude: seed.centerLatitude,
            centerLongitude: seed.centerLongitude,
            radiusMiles: SERVICE_RADIUS_DEFAULT_MILES,
            formattedAddress: seed.formattedAddress,
            locality: seed.locality,
            region: seed.region,
            postalCode: seed.postalCode,
            countryCode: seed.countryCode,
          }
        : null,
    );
  };

  const cancelEdit = () => {
    setCreating(false);
    setFeedback(null);
    setDraft(selected ? { ...selected } : null);
  };

  const save = async () => {
    if (!isServiceAreaDraftValid(draft)) {
      setFeedback({
        tone: "error",
        message: "Pick an address, set a radius, and name the area before saving.",
      });
      return;
    }
    setSaving(true);
    setFeedback(null);

    const url = creating
      ? "/api/provider/service-areas"
      : `/api/provider/service-areas/${selectedId}`;
    const method = creating ? "POST" : "PUT";

    // Optimistic only for an edit, where the previous row is known and can be
    // put back verbatim. A create has nothing to roll back to.
    const previous = areas;
    if (!creating && selectedId) {
      setAreas((current) =>
        current.map((area) => (area.id === selectedId ? { ...area, ...draft } : area)),
      );
    }

    try {
      const response = await fetch(url, {
        method,
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draftPayload(draft)),
      });
      const payload = (await response.json().catch(() => null)) as
        | { area?: ApiArea; error?: string; fields?: Record<string, string> }
        | null;

      if (!response.ok || !payload?.area) {
        setAreas(previous);
        const firstFieldError = payload?.fields ? Object.values(payload.fields)[0] : undefined;
        setFeedback({
          tone: "error",
          message:
            response.status === 409
              ? (payload?.error ??
                "Someone changed this area at the same time. Reload and try again.")
              : (firstFieldError ??
                payload?.error ??
                "We could not save this service area. Please try again."),
        });
        return;
      }

      setCreating(false);
      setFeedback({
        tone: "success",
        message: creating ? "Service area added." : "Service area updated.",
      });
      setSelectedId(payload.area.id);
      await load({ keepSelection: true });
      onAreasChanged?.();
    } catch {
      setAreas(previous);
      setFeedback({
        tone: "error",
        message: "We could not reach Bundleen. Check your connection and try again.",
      });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (areaId: string) => {
    setSaving(true);
    setFeedback(null);
    try {
      const response = await fetch(`/api/provider/service-areas/${areaId}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; error?: string }
        | null;
      if (!response.ok) {
        setFeedback({
          tone: "error",
          message: payload?.error ?? "We could not remove this service area. Please try again.",
        });
        return;
      }
      setConfirmRemoveId(null);
      setFeedback({ tone: "success", message: "Service area removed." });
      await load();
      onAreasChanged?.();
    } catch {
      setFeedback({
        tone: "error",
        message: "We could not reach Bundleen. Check your connection and try again.",
      });
    } finally {
      setSaving(false);
    }
  };

  const atMax = areas.length >= MAX_ACTIVE_SERVICE_AREAS;
  const isLastArea = areas.length === 1;

  return (
    <section
      id="service-areas"
      aria-labelledby="service-areas-heading"
      className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-teal-700">
            Coverage
          </p>
          <h2 id="service-areas-heading" className="mt-1 text-xl font-bold text-slate-900">
            Service areas
          </h2>
          <p className="mt-1 max-w-prose text-[13px] leading-5 text-slate-500">
            You only see open service requests that fall inside one of these circles and match a
            trade you offer. Changes take effect on your next opportunity list.
          </p>
        </div>
        <button
          type="button"
          onClick={startCreate}
          disabled={loading || saving || atMax || creating}
          className="h-10 shrink-0 rounded-xl bg-teal-600 px-4 text-[13px] font-bold text-white transition hover:bg-teal-700 disabled:opacity-40"
        >
          Add area
        </button>
      </header>

      {atMax ? (
        <p className="mt-3 rounded-xl bg-amber-50 px-3.5 py-2.5 text-[12px] font-medium text-amber-800">
          You have the maximum of {MAX_ACTIVE_SERVICE_AREAS} active areas. Remove one before adding
          another.
        </p>
      ) : null}

      {loading ? (
        <p role="status" className="mt-6 text-[13px] text-slate-500">
          Loading your service areas…
        </p>
      ) : loadError ? (
        <div role="alert" className="mt-6 rounded-xl bg-red-50 px-4 py-3">
          <p className="text-[13px] font-medium text-red-700">{loadError}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-2 text-[12px] font-bold text-red-700 underline"
          >
            Try again
          </button>
        </div>
      ) : (
        <div className="mt-5 grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
          {/* ── List ─────────────────────────────────────────────────────── */}
          <div className="min-w-0">
            {areas.length === 0 && !creating ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center">
                <p className="text-[13px] font-bold text-slate-800">No active service areas</p>
                <p className="mx-auto mt-1 max-w-[220px] text-[12px] text-slate-500">
                  Add one so Bundleen can match you with nearby work.
                </p>
              </div>
            ) : (
              <ul className="space-y-2">
                {areas.map((area) => {
                  const active = !creating && area.id === selectedId;
                  return (
                    <li key={area.id}>
                      <div
                        className={`rounded-xl border p-3 transition ${
                          active
                            ? "border-teal-500 bg-teal-50/60 ring-1 ring-inset ring-teal-200"
                            : "border-slate-200 bg-white hover:border-slate-300"
                        }`}
                      >
                        <button
                          type="button"
                          aria-current={active ? "true" : undefined}
                          onClick={() => {
                            setCreating(false);
                            setConfirmRemoveId(null);
                            setFeedback(null);
                            setSelectedId(area.id);
                          }}
                          className="block w-full text-left"
                        >
                          <span className="flex items-center gap-2">
                            <span className="min-w-0 truncate text-[13px] font-bold text-slate-900">
                              {area.label}
                            </span>
                            {area.isPrimary ? (
                              <span className="shrink-0 rounded-md bg-teal-600 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">
                                Primary
                              </span>
                            ) : null}
                          </span>
                          <span className="mt-0.5 block truncate text-[11px] text-slate-500">
                            {coverageListLabel({ radiusMiles: area.radiusMiles, place: area })}
                          </span>
                        </button>

                        {confirmRemoveId === area.id ? (
                          <div className="mt-3 rounded-lg bg-red-50 p-3">
                            <p className="text-[12px] font-medium leading-5 text-red-800">
                              {isLastArea
                                ? "This is your only active area. Removing it stops every matched opportunity from reaching you until you add another."
                                : `Remove “${area.label}”? Requests only inside this circle will stop reaching you.`}
                            </p>
                            <div className="mt-2 flex gap-2">
                              <button
                                type="button"
                                disabled={saving}
                                onClick={() => void remove(area.id)}
                                className="h-8 rounded-lg bg-red-600 px-3 text-[12px] font-bold text-white disabled:opacity-40"
                              >
                                {saving ? "Removing…" : "Remove"}
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmRemoveId(null)}
                                className="h-8 rounded-lg border border-slate-300 bg-white px-3 text-[12px] font-semibold text-slate-700"
                              >
                                Keep it
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => setConfirmRemoveId(area.id)}
                            className="mt-2 text-[11px] font-bold text-red-600 hover:underline disabled:opacity-40"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
                {creating ? (
                  <li className="rounded-xl border border-dashed border-teal-400 bg-teal-50/50 p-3">
                    <p className="text-[13px] font-bold text-teal-900">New service area</p>
                    <p className="mt-0.5 text-[11px] text-teal-700">Unsaved</p>
                  </li>
                ) : null}
              </ul>
            )}

            {unmappable.length > 0 ? (
              <div className="mt-4 rounded-xl bg-slate-50 p-3">
                <p className="text-[12px] font-bold text-slate-700">Postal-code areas</p>
                <p className="mt-0.5 text-[11px] leading-4 text-slate-500">
                  These were saved before the coverage map and have no circle to draw. They still
                  match requests.
                </p>
                <ul className="mt-2 space-y-1">
                  {unmappable.map((area) => (
                    <li
                      key={area.id}
                      className="flex items-center justify-between gap-2 text-[12px] text-slate-700"
                    >
                      <span className="min-w-0 truncate">{area.label}</span>
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => void remove(area.id)}
                        className="shrink-0 text-[11px] font-bold text-red-600 hover:underline disabled:opacity-40"
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>

          {/* ── Editor ───────────────────────────────────────────────────── */}
          <div className="min-w-0">
            {draft || creating ? (
              <>
                <ProviderServiceAreaEditor
                  value={draft}
                  onChange={setDraft}
                  contextCircles={contextCircles}
                  disabled={saving}
                />

                {feedback ? (
                  <p
                    role={feedback.tone === "error" ? "alert" : "status"}
                    className={`mt-3 rounded-xl px-3.5 py-2.5 text-[13px] font-medium ${
                      feedback.tone === "error"
                        ? "bg-red-50 text-red-700"
                        : "bg-emerald-50 text-emerald-800"
                    }`}
                  >
                    {feedback.message}
                  </p>
                ) : null}

                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={saving || !isServiceAreaDraftValid(draft)}
                    onClick={() => void save()}
                    className="h-11 rounded-xl bg-teal-600 px-5 text-[13px] font-bold text-white transition hover:bg-teal-700 disabled:opacity-40"
                  >
                    {saving
                      ? "Saving…"
                      : creating
                        ? "Save new area"
                        : "Save changes"}
                  </button>
                  {creating || (selected && draft && selected.radiusMiles !== draft.radiusMiles) ? (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={cancelEdit}
                      className="h-11 rounded-xl border border-slate-300 bg-white px-5 text-[13px] font-semibold text-slate-700"
                    >
                      Cancel
                    </button>
                  ) : null}
                  {!creating && selected && !selected.isPrimary ? (
                    <button
                      type="button"
                      disabled={saving || !isServiceAreaDraftValid(draft)}
                      onClick={() => {
                        if (!isServiceAreaDraftValid(draft) || !selectedId) return;
                        setSaving(true);
                        void fetch(`/api/provider/service-areas/${selectedId}`, {
                          method: "PUT",
                          credentials: "same-origin",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify(draftPayload(draft, true)),
                        })
                          .then(async (response) => {
                            if (!response.ok) throw new Error("failed");
                            setFeedback({ tone: "success", message: "Primary area updated." });
                            await load({ keepSelection: true });
                            onAreasChanged?.();
                          })
                          .catch(() =>
                            setFeedback({
                              tone: "error",
                              message: "We could not make this your primary area. Please try again.",
                            }),
                          )
                          .finally(() => setSaving(false));
                      }}
                      className="h-11 rounded-xl border border-teal-300 bg-teal-50 px-5 text-[13px] font-bold text-teal-800"
                    >
                      Make primary
                    </button>
                  ) : null}
                </div>

                {selected && !creating ? (
                  <p className="mt-3 text-[12px] text-slate-500">
                    Last saved: {coverageSummary({ radiusMiles: selected.radiusMiles, place: selected, label: selected.label })}.
                  </p>
                ) : null}
              </>
            ) : (
              <div className="grid h-full min-h-[220px] place-items-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-6 text-center">
                <p className="max-w-xs text-[13px] text-slate-600">
                  Add a service area to draw the region you cover on the map.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
