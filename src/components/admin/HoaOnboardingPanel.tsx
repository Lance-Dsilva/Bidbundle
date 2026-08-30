"use client";

import { useEffect, useState, type FormEvent } from "react";

import type {
  AddressCandidate,
  HoaProfileSummary,
  UnitImportResult,
  UnitSummary,
} from "@/lib/hoa-types";
import { AmenitiesOnboardingStep } from "@/components/admin/AmenitiesOnboardingStep";

/**
 * Bundleen admin HOA onboarding: legal profile, onboarding pipeline stage,
 * unit inventory with small-batch creation, and idempotent CSV import with a
 * dry-run preview.
 *
 * There is no latitude or longitude anywhere on this screen, by design. An
 * admin onboarding an HOA has the association's postal address, not its
 * coordinates; asking for numbers invited transcription errors that then
 * routed crews to the wrong place. Bundleen resolves the address on the server
 * and reports a verification *status* instead — the numbers exist, they are
 * simply not a human's job.
 */

/** Raised for a save that returned candidates instead of storing anything. */
class AmbiguousAddress extends Error {
  constructor(readonly candidates: AddressCandidate[]) {
    super("That address matched more than one place. Choose the correct one.");
    this.name = "AmbiguousAddress";
  }
}

async function requestJson<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    ...(body !== undefined
      ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
      : {}),
  });
  const result = (await response.json().catch(() => null)) as
    | (Record<string, unknown> & { error?: string; candidates?: AddressCandidate[] })
    | null;
  if (!response.ok) {
    if (response.status === 409 && Array.isArray(result?.candidates)) {
      throw new AmbiguousAddress(result.candidates);
    }
    throw new Error(result?.error ?? "Something went wrong. Please try again.");
  }
  return (result ?? {}) as T;
}

const VERIFICATION_LABELS: Record<HoaProfileSummary["addressVerificationStatus"], string> = {
  verified: "Address verified",
  pending: "Verification pending",
  needs_correction: "Needs correction",
};

const VERIFICATION_TONES: Record<
  HoaProfileSummary["addressVerificationStatus"],
  { background: string; color: string }
> = {
  verified: { background: "#dcfce7", color: "#15803d" },
  pending: { background: "#fef3c7", color: "#b45309" },
  needs_correction: { background: "#fee2e2", color: "#b91c1c" },
};

function AddressStatusBadge({ profile }: { profile: HoaProfileSummary }) {
  const tone = VERIFICATION_TONES[profile.addressVerificationStatus];
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span
        className="rounded-full px-3 py-1 text-xs font-semibold"
        style={tone}
        role="status"
      >
        {VERIFICATION_LABELS[profile.addressVerificationStatus]}
      </span>
      {profile.formattedAddress ? (
        <span className="text-xs" style={{ color: "var(--ink-700)" }}>
          {profile.formattedAddress}
        </span>
      ) : null}
      {profile.addressVerifiedAt ? (
        <span className="text-xs" style={{ color: "var(--muted)" }}>
          checked {new Date(profile.addressVerifiedAt).toLocaleDateString()}
        </span>
      ) : null}
    </div>
  );
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
  /**
   * Candidates from an ambiguous save. While these are on screen the form
   * keeps everything the admin typed — the save wrote nothing, so retrying
   * after picking one is the only thing left to do.
   */
  const [candidates, setCandidates] = useState<AddressCandidate[] | null>(null);
  const [retryable, setRetryable] = useState(false);

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

  /**
   * Saves the profile.
   *
   * `confirmed` carries the one-line address the admin picked from a previous
   * ambiguous answer. It is an *address*, never a coordinate: the server still
   * resolves the location itself and only accepts a candidate it produced.
   */
  const submitProfile = async (form: HTMLFormElement, confirmed: string | null) => {
    const data = new FormData(form);
    const text = (name: string) => String(data.get(name) ?? "").trim();
    const optional = (name: string) => text(name) || null;
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
        confirmedFormattedAddress: confirmed,
        timezone: text("timezone") || "America/Chicago",
        totalHomes: Number(text("totalHomes") || "1"),
        referenceCode: optional("referenceCode"),
        serviceNotes: optional("serviceNotes"),
      },
    );
    setProfile(result.profile);
    setCandidates(null);
    setRetryable(false);
  };

  const saveProfile = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    setError(null);
    setSuccess(null);
    setCandidates(null);
    setRetryable(false);
    void submitProfile(form, null)
      .then(() => setSuccess("HOA profile saved and the address verified."))
      .catch((caught) => {
        if (caught instanceof AmbiguousAddress) {
          setCandidates(caught.candidates);
          setError(caught.message);
          return;
        }
        setError(caught instanceof Error ? caught.message : "Something went wrong.");
        // Every transient answer says so in its own words; offering retry on
        // anything that is not a plain validation failure is the safe default.
        setRetryable(true);
      })
      .finally(() => setBusy(false));
  };

  /** Confirms one candidate by re-saving the same form with it attached. */
  const confirmCandidate = (candidate: AddressCandidate) => {
    const form = document.getElementById("hoa-profile-form") as HTMLFormElement | null;
    if (!form) return;
    setBusy(true);
    setError(null);
    void submitProfile(form, candidate.token)
      .then(() => setSuccess("HOA profile saved and the address verified."))
      .catch((caught) => {
        if (caught instanceof AmbiguousAddress) {
          setCandidates(caught.candidates);
          setError(caught.message);
          return;
        }
        setError(caught instanceof Error ? caught.message : "Something went wrong.");
      })
      .finally(() => setBusy(false));
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
        {profile ? (
          <div className="mt-3">
            <AddressStatusBadge profile={profile} />
            {!profile.locationReady ? (
              <p className="mt-2 text-xs" style={{ color: "#b45309" }}>
                Provider matching and visit planning stay off until this address is verified.
              </p>
            ) : null}
          </div>
        ) : null}

        {candidates ? (
          <div
            className="mt-3 rounded-xl border p-3"
            style={{ borderColor: "var(--line)", background: "var(--canvas)" }}
          >
            <p className="text-xs font-semibold" style={{ color: "var(--ink-900)" }}>
              Which address is correct?
            </p>
            <ul className="mt-2 space-y-1">
              {candidates.map((candidate) => (
                <li key={candidate.token}>
                  <button
                    className="w-full rounded-lg border px-3 py-2 text-left text-xs disabled:opacity-60"
                    style={{ borderColor: "var(--line)", background: "var(--paper)" }}
                    disabled={busy}
                    onClick={() => confirmCandidate(candidate)}
                    type="button"
                  >
                    {candidate.formatted}
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
              Nothing was saved yet. Everything you typed is still in the form below.
            </p>
          </div>
        ) : null}

        {retryable ? (
          <div className="mt-3">
            <button
              className="h-9 rounded-lg border px-3 text-xs font-semibold disabled:opacity-60"
              style={{ borderColor: "var(--line)", color: "var(--ink-700)" }}
              disabled={busy}
              onClick={() => {
                const form = document.getElementById("hoa-profile-form") as HTMLFormElement | null;
                form?.requestSubmit();
              }}
              type="button"
            >
              Retry verification
            </button>
          </div>
        ) : null}

        <form
          className="mt-3 grid gap-3 md:grid-cols-2"
          id="hoa-profile-form"
          onSubmit={saveProfile}
        >
          <AdminField name="legalName" label="Legal name" defaultValue={profile?.legalName} required />
          <AdminField name="displayName" label="Display name (optional)" defaultValue={profile?.displayName ?? ""} />
          <AdminField name="addressLine1" label="Street address" defaultValue={profile?.addressLine1} required />
          <AdminField name="addressLine2" label="Address line 2" defaultValue={profile?.addressLine2 ?? ""} />
          <AdminField name="locality" label="City" defaultValue={profile?.locality} required />
          <AdminField name="region" label="State/region" defaultValue={profile?.region} required />
          <AdminField name="postalCode" label="Postal code" defaultValue={profile?.postalCode} required />
          <AdminField name="country" label="Country (2 letters)" defaultValue={profile?.country ?? "US"} required />
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
            <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
              Enter the association&rsquo;s postal address only. Bundleen verifies it and resolves
              the map location used for provider matching and visit planning.
            </p>
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
            CSV import (label,addressLine1,locality,region,postalCode)
          </p>
          <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
            Labels and addresses only. Homes with their own address are located automatically;
            homes without one use the HOA address.
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

      {/* Amenities are captured as drafts here and handed to the invited
          manager. Placed after the unit inventory because it is the last thing
          an onboarding call covers. */}
      <AmenitiesOnboardingStep communityId={communityId} />
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
