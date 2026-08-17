"use client";

import { useEffect, useState, type FormEvent } from "react";

import type { HoaProfileSummary, UnitImportResult, UnitSummary } from "@/lib/hoa-types";

/**
 * Bundleen admin HOA onboarding: legal profile, onboarding pipeline stage,
 * unit inventory with small-batch creation, and idempotent CSV import with a
 * dry-run preview.
 */

async function requestJson<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    ...(body !== undefined
      ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
      : {}),
  });
  const result = (await response.json().catch(() => null)) as
    | (Record<string, unknown> & { error?: string })
    | null;
  if (!response.ok) {
    throw new Error(result?.error ?? "Something went wrong. Please try again.");
  }
  return (result ?? {}) as T;
}

const ONBOARDING_STAGES = [
  ["draft", "Draft"],
  ["manager_invited", "Manager invited"],
  ["manager_active", "Manager active"],
  ["residents_inviting", "Residents inviting"],
  ["live", "Live"],
  ["archived", "Archived"],
] as const;

export function HoaOnboardingPanel({ communityId }: { communityId: string }) {
  const [profile, setProfile] = useState<HoaProfileSummary | null>(null);
  const [units, setUnits] = useState<UnitSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [importPreview, setImportPreview] = useState<UnitImportResult | null>(null);
  const [csv, setCsv] = useState("");

  useEffect(() => {
    let active = true;
    void Promise.all([
      requestJson<{ profile: HoaProfileSummary | null }>(
        "GET",
        `/api/admin/communities/${communityId}/hoa-profile`,
      ),
      requestJson<{ units: UnitSummary[] }>(
        "GET",
        `/api/admin/communities/${communityId}/units`,
      ),
    ])
      .then(([profileResult, unitsResult]) => {
        if (!active) return;
        setProfile(profileResult.profile);
        setUnits(unitsResult.units);
      })
      .catch((caught) => {
        if (active) setError(caught instanceof Error ? caught.message : "Could not load HOA data.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [communityId]);

  const act = async (successText: string, action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await action();
      setSuccess(successText);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const saveProfile = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const text = (name: string) => String(data.get(name) ?? "").trim();
    const optional = (name: string) => text(name) || null;
    const lat = text("latitude");
    const lng = text("longitude");
    void act("HOA profile saved.", async () => {
      const result = await requestJson<{ profile: HoaProfileSummary }>(
        "PUT",
        `/api/admin/communities/${communityId}/hoa-profile`,
        {
          legalName: text("legalName"),
          displayName: optional("displayName"),
          addressLine1: text("addressLine1"),
          addressLine2: optional("addressLine2"),
          locality: text("locality"),
          region: text("region"),
          postalCode: text("postalCode"),
          country: text("country") || "US",
          latitude: lat ? Number(lat) : null,
          longitude: lng ? Number(lng) : null,
          timezone: text("timezone") || "America/Chicago",
          totalHomes: Number(text("totalHomes") || "1"),
          referenceCode: optional("referenceCode"),
          serviceNotes: optional("serviceNotes"),
        },
      );
      setProfile(result.profile);
    });
  };

  const setStage = (stage: string) => {
    void act("Onboarding stage updated.", async () => {
      await requestJson("PATCH", `/api/admin/communities/${communityId}/hoa-profile`, {
        onboardingStatus: stage,
      });
      setProfile((current) =>
        current
          ? { ...current, onboardingStatus: stage as HoaProfileSummary["onboardingStatus"] }
          : current,
      );
    });
  };

  const addUnit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    void act("Unit added.", async () => {
      const result = await requestJson<{ unit: UnitSummary }>(
        "POST",
        `/api/admin/communities/${communityId}/units`,
        {
          label: data.get("label"),
          addressLine1: (data.get("addressLine1") as string) || null,
        },
      );
      setUnits((current) =>
        [...current, result.unit].sort((a, b) => a.label.localeCompare(b.label)),
      );
      form.reset();
    });
  };

  const runImport = (commit: boolean) => {
    void act(commit ? "Units imported." : "Dry run complete — nothing written yet.", async () => {
      const result = await requestJson<{ result: UnitImportResult }>(
        "POST",
        `/api/admin/communities/${communityId}/units/import`,
        { csv, commit },
      );
      setImportPreview(result.result);
      if (result.result.committed) {
        const refreshed = await requestJson<{ units: UnitSummary[] }>(
          "GET",
          `/api/admin/communities/${communityId}/units`,
        );
        setUnits(refreshed.units);
        setCsv("");
      }
    });
  };

  if (loading) {
    return (
      <div className="rounded-xl border p-4 text-sm" style={{ borderColor: "var(--line)", color: "var(--muted)" }}>
        Loading HOA onboarding…
      </div>
    );
  }

  const occupied = units.filter((unit) => unit.occupancyStatus === "occupied").length;
  const invitePending = units.filter((unit) => unit.occupancyStatus === "invite_pending").length;

  return (
    <div className="space-y-5">
      {error ? (
        <p className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700" role="alert">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="rounded-xl bg-green-50 px-4 py-3 text-sm font-medium text-green-700" role="status">
          {success}
        </p>
      ) : null}

      {/* ── Profile ───────────────────────────────────────────────────── */}
      <div className="rounded-xl border p-4" style={{ borderColor: "var(--line)" }}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold" style={{ color: "var(--ink-900)" }}>
            HOA legal profile
          </h3>
          <label className="flex items-center gap-2 text-xs" style={{ color: "var(--muted)" }}>
            Onboarding stage
            <select
              className="h-9 rounded-lg border px-2 text-xs"
              style={{ borderColor: "var(--line)", background: "var(--paper)" }}
              disabled={busy || !profile}
              onChange={(event) => setStage(event.currentTarget.value)}
              value={profile?.onboardingStatus ?? "draft"}
            >
              {ONBOARDING_STAGES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <form className="mt-3 grid gap-3 md:grid-cols-2" onSubmit={saveProfile}>
          <AdminField name="legalName" label="Legal name" defaultValue={profile?.legalName} required />
          <AdminField name="displayName" label="Display name (optional)" defaultValue={profile?.displayName ?? ""} />
          <AdminField name="addressLine1" label="Street address" defaultValue={profile?.addressLine1} required />
          <AdminField name="addressLine2" label="Address line 2" defaultValue={profile?.addressLine2 ?? ""} />
          <AdminField name="locality" label="City" defaultValue={profile?.locality} required />
          <AdminField name="region" label="State/region" defaultValue={profile?.region} required />
          <AdminField name="postalCode" label="Postal code" defaultValue={profile?.postalCode} required />
          <AdminField name="country" label="Country (2 letters)" defaultValue={profile?.country ?? "US"} required />
          <AdminField name="latitude" label="Latitude" defaultValue={profile?.latitude?.toString() ?? ""} />
          <AdminField name="longitude" label="Longitude" defaultValue={profile?.longitude?.toString() ?? ""} />
          <AdminField name="timezone" label="Timezone (IANA)" defaultValue={profile?.timezone ?? "America/Chicago"} required />
          <AdminField name="totalHomes" label="Total homes" type="number" defaultValue={profile?.totalHomes?.toString() ?? ""} required />
          <AdminField name="referenceCode" label="HOA reference code" defaultValue={profile?.referenceCode ?? ""} />
          <AdminField name="serviceNotes" label="Service notes" defaultValue={profile?.serviceNotes ?? ""} />
          <div className="md:col-span-2">
            <button
              className="h-10 rounded-xl px-4 text-sm font-semibold text-white disabled:opacity-60"
              style={{ background: "var(--teal-800)" }}
              disabled={busy}
              type="submit"
            >
              {busy ? "Saving…" : profile ? "Update profile" : "Create profile"}
            </button>
            {!profile ? (
              <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
                The profile stores the verified HOA address and coordinates that provider matching
                uses. Create it before inviting the manager.
              </p>
            ) : null}
          </div>
        </form>
      </div>

      {/* ── Units ─────────────────────────────────────────────────────── */}
      <div className="rounded-xl border p-4" style={{ borderColor: "var(--line)" }}>
        <h3 className="text-sm font-semibold" style={{ color: "var(--ink-900)" }}>
          Unit inventory · {units.length} homes ({occupied} occupied, {invitePending} invite pending)
        </h3>
        {units.length > 0 ? (
          <div className="mt-3 max-h-64 overflow-y-auto rounded-lg border" style={{ borderColor: "var(--line)" }}>
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0" style={{ background: "var(--canvas)" }}>
                <tr style={{ color: "var(--muted)" }}>
                  <th className="px-3 py-2">Home</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Resident / invite</th>
                </tr>
              </thead>
              <tbody>
                {units.map((unit) => (
                  <tr key={unit.id} style={{ borderTop: "1px solid var(--line)" }}>
                    <td className="px-3 py-2 font-medium" style={{ color: "var(--ink-900)" }}>
                      {unit.label}
                    </td>
                    <td className="px-3 py-2" style={{ color: "var(--muted)" }}>
                      {unit.occupancyStatus.replace("_", " ")}
                    </td>
                    <td className="px-3 py-2" style={{ color: "var(--ink-700)" }}>
                      {unit.residentName ?? unit.pendingInviteEmail ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
            No homes yet. Add them below or import a CSV.
          </p>
        )}
        <form className="mt-3 flex flex-col gap-2 sm:flex-row" onSubmit={addUnit}>
          <input
            className="h-10 flex-1 rounded-xl border px-3 text-sm outline-none"
            style={{ borderColor: "var(--line)", background: "var(--paper)" }}
            name="label"
            placeholder="Unit label (Home 1)"
            required
          />
          <input
            className="h-10 flex-1 rounded-xl border px-3 text-sm outline-none"
            style={{ borderColor: "var(--line)", background: "var(--paper)" }}
            name="addressLine1"
            placeholder="Street address (optional)"
          />
          <button
            className="h-10 rounded-xl px-4 text-sm font-semibold text-white disabled:opacity-60"
            style={{ background: "var(--teal-800)" }}
            disabled={busy}
            type="submit"
          >
            Add unit
          </button>
        </form>

        <div className="mt-4 rounded-lg p-3" style={{ background: "var(--canvas)" }}>
          <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
            CSV import (label,addressLine1,locality,region,postalCode,latitude,longitude)
          </p>
          <textarea
            className="mt-2 min-h-24 w-full rounded-lg border p-3 font-mono text-xs outline-none"
            style={{ borderColor: "var(--line)", background: "var(--paper)" }}
            onChange={(event) => setCsv(event.currentTarget.value)}
            placeholder={"label,addressLine1\nHome 1,11801 Cedar Ln\nHome 2,11803 Cedar Ln"}
            value={csv}
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              className="h-9 rounded-lg border px-3 text-xs font-semibold disabled:opacity-60"
              style={{ borderColor: "var(--line)", color: "var(--ink-700)" }}
              disabled={busy || !csv.trim()}
              onClick={() => runImport(false)}
              type="button"
            >
              Dry run
            </button>
            <button
              className="h-9 rounded-lg px-3 text-xs font-semibold text-white disabled:opacity-60"
              style={{ background: "var(--teal-800)" }}
              disabled={busy || !csv.trim() || !importPreview || importPreview.committed}
              onClick={() => runImport(true)}
              type="button"
            >
              Commit import
            </button>
            {importPreview && !importPreview.committed ? (
              <span className="self-center text-xs" style={{ color: "var(--muted)" }}>
                Dry run: {importPreview.createCount} new · {importPreview.duplicateCount} duplicates ·{" "}
                {importPreview.invalidCount} invalid
              </span>
            ) : null}
          </div>
          {importPreview && importPreview.rows.some((row) => row.status !== "create") ? (
            <ul className="mt-2 max-h-32 space-y-1 overflow-y-auto text-xs" style={{ color: "var(--muted)" }}>
              {importPreview.rows
                .filter((row) => row.status !== "create")
                .slice(0, 20)
                .map((row) => (
                  <li key={`${row.line}-${row.label}`}>
                    Line {row.line} ({row.label || "no label"}):{" "}
                    {row.status === "already_exists"
                      ? "already on the roster — skipped"
                      : row.status === "duplicate_in_file"
                        ? "duplicate in file — skipped"
                        : row.problem}
                  </li>
                ))}
            </ul>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function AdminField({
  name,
  label,
  defaultValue,
  type = "text",
  required = false,
}: {
  name: string;
  label: string;
  defaultValue?: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold" style={{ color: "var(--ink-700)" }}>
        {label}
      </span>
      <input
        className="h-10 w-full rounded-xl border px-3 text-sm outline-none"
        style={{ borderColor: "var(--line)", background: "var(--paper)" }}
        defaultValue={defaultValue}
        key={defaultValue ?? ""}
        name={name}
        required={required}
        type={type}
      />
    </label>
  );
}
