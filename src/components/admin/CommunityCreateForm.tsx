"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { AdminRequestError, createCommunity } from "@/lib/admin-client";
import { COMMUNITY_RADIUS_MI } from "@/lib/validation/profile";

/**
 * Creates a community.
 *
 * The submit button disables itself for the whole request rather than only on
 * success, which is what stops a double click from creating two communities —
 * unlike membership and role changes, a create has no unique key to fall back
 * on.
 */
export function CommunityCreateForm() {
  const router = useRouter();
  const [type, setType] = useState<"hoa" | "neighborhood">("hoa");
  const [name, setName] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [radius, setRadius] = useState(String(COMMUNITY_RADIUS_MI));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;

    setPending(true);
    setError(null);
    setFieldErrors({});

    try {
      const detail = await createCommunity({
        name,
        type,
        centerLatitude: latitude === "" ? null : Number(latitude),
        centerLongitude: longitude === "" ? null : Number(longitude),
        radiusMiles: type === "neighborhood" ? Number(radius) : null,
      });

      router.push(`/app/admin/communities/${detail.community.id}`);
    } catch (caught) {
      if (caught instanceof AdminRequestError) {
        setError(caught.message);
        setFieldErrors(caught.fields ?? {});
      } else {
        setError("Something went wrong. Please try again.");
      }
      setPending(false);
    }
  }

  const inputStyle = {};
  const inputClass = "h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-[12px] text-slate-800 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100";

  return (
    <form className="space-y-3" onSubmit={submit}>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.08em] text-slate-500">
            Account name
          </span>
          <input
            className={inputClass}
            style={inputStyle}
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            maxLength={120}
          />
          {fieldErrors.name && (
            <span className="mt-1 block text-[11px]" style={{ color: "var(--danger-600)" }}>
              {fieldErrors.name}
            </span>
          )}
        </label>

        <label className="block">
          <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.08em] text-slate-500">
            Customer segment
          </span>
          <select
            className={inputClass}
            style={inputStyle}
            value={type}
            onChange={(event) => setType(event.target.value as "hoa" | "neighborhood")}
          >
            <option value="hoa">Official HOA</option>
            <option value="neighborhood">Location-based neighborhood</option>
          </select>
        </label>
      </div>

      {type === "neighborhood" && (
        <div className="grid gap-3 md:grid-cols-3">
          <label className="block">
            <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.08em] text-slate-500">
              Centre latitude
            </span>
            <input
              className={inputClass}
              style={inputStyle}
              type="number"
              step="any"
              min={-90}
              max={90}
              value={latitude}
              onChange={(event) => setLatitude(event.target.value)}
              required
            />
            {fieldErrors.centerLatitude && (
              <span className="mt-1 block text-[11px]" style={{ color: "var(--danger-600)" }}>
                {fieldErrors.centerLatitude}
              </span>
            )}
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.08em] text-slate-500">
              Centre longitude
            </span>
            <input
              className={inputClass}
              style={inputStyle}
              type="number"
              step="any"
              min={-180}
              max={180}
              value={longitude}
              onChange={(event) => setLongitude(event.target.value)}
              required
            />
            {fieldErrors.centerLongitude && (
              <span className="mt-1 block text-[11px]" style={{ color: "var(--danger-600)" }}>
                {fieldErrors.centerLongitude}
              </span>
            )}
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.08em] text-slate-500">
              Radius (miles)
            </span>
            <input
              className={inputClass}
              style={inputStyle}
              type="number"
              step="0.1"
              min={0.1}
              max={100}
              value={radius}
              onChange={(event) => setRadius(event.target.value)}
              required
            />
            <span className="mt-1 block text-[11px]" style={{ color: "var(--muted)" }}>
              Bundleen staff only. Homeowners never choose a radius.
            </span>
          </label>
        </div>
      )}

      {error && (
        <p className="text-[12px]" style={{ color: "var(--danger-600)" }} role="alert">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-10 items-center rounded-lg bg-emerald-600 px-4 text-[12px] font-bold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-60"
        style={{}}
      >
        {pending ? "Creating…" : type === "hoa" ? "Create HOA account" : "Create neighborhood"}
      </button>
    </form>
  );
}
