"use client";

import { useCallback, useEffect, useState } from "react";

import type { AmenityCardView, AmenityCatalog } from "@/lib/amenity-types";
import { AMENITY_TYPE_LABELS } from "@/lib/amenity-types";
import type { AmenityType } from "@/lib/amenity-types";

/**
 * "Amenities setup" — the onboarding step that sits alongside the HOA profile,
 * verified address, unit inventory, and manager invitation.
 *
 * Two deliberate constraints:
 *
 *  1. **Everything created here is a draft.** The admin's job is to capture
 *     what the HOA told them on the call; the invited manager owns hours,
 *     photos, and rules, and only they publish. `POST /api/hoa/amenities`
 *     always creates a draft, so this is enforced server-side rather than by
 *     this screen choosing not to publish.
 *
 *  2. **No coordinates, ever.** An amenity has a human location label —
 *     "behind the clubhouse" — and inherits the HOA's verified address for
 *     anything that needs a map. There is no latitude or longitude field here
 *     for the same reason there is none on the HOA profile form.
 */

type Template = {
  id: string;
  name: string;
  type: AmenityType;
  bookingRequired: boolean;
  resourceCount: number;
  hint: string;
};

const TEMPLATES: Template[] = [
  {
    id: "pool",
    name: "Swimming pool",
    type: "pool",
    bookingRequired: false,
    resourceCount: 1,
    hint: "Usually open to all residents during posted hours.",
  },
  {
    id: "clubhouse",
    name: "Clubhouse",
    type: "clubhouse",
    bookingRequired: true,
    resourceCount: 1,
    hint: "One room, booked exclusively.",
  },
  {
    id: "gym",
    name: "Fitness room",
    type: "gym",
    bookingRequired: false,
    resourceCount: 1,
    hint: "Drop-in, capacity managed by house rules.",
  },
  {
    id: "tennis",
    name: "Tennis court",
    type: "tennis_court",
    bookingRequired: true,
    resourceCount: 1,
    hint: "Add one space per court so two courts can be booked at once.",
  },
  {
    id: "badminton",
    name: "Badminton court",
    type: "badminton_court",
    bookingRequired: true,
    resourceCount: 1,
    hint: "Add one space per court.",
  },
  {
    id: "meeting",
    name: "Meeting room",
    type: "meeting_room",
    bookingRequired: true,
    resourceCount: 1,
    hint: "Board meetings and resident groups.",
  },
  {
    id: "other",
    name: "",
    type: "other",
    bookingRequired: false,
    resourceCount: 1,
    hint: "Anything else the HOA shares.",
  },
];

async function requestJson<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => null)) as
    | (T & { error?: string })
    | null;
  if (!response.ok) {
    throw new Error(payload?.error ?? "Something went wrong. Please try again.");
  }
  return payload as T;
}

/** What still has to happen before the manager can publish this amenity. */
function readiness(amenity: AmenityCardView): string[] {
  const missing: string[] = [];
  if (!amenity.hoursLabel && !amenity.nextOpenLabel) missing.push("opening hours");
  if (!amenity.cover) missing.push("a photo");
  return missing;
}

export function AmenitiesOnboardingStep({ communityId }: { communityId: string }) {
  const [catalog, setCatalog] = useState<AmenityCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [hasAmenities, setHasAmenities] = useState<boolean | null>(null);
  const [template, setTemplate] = useState<Template>(TEMPLATES[0]);
  const [name, setName] = useState(TEMPLATES[0].name);
  const [locationLabel, setLocationLabel] = useState("");
  const [description, setDescription] = useState("");
  const [bookingRequired, setBookingRequired] = useState(TEMPLATES[0].bookingRequired);
  const [resourceCount, setResourceCount] = useState(1);
  const [maxPartySize, setMaxPartySize] = useState(4);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await requestJson<AmenityCatalog>(
        "GET",
        `/api/hoa/amenities?communityId=${communityId}`,
      );
      setCatalog(result);
      // Only infer "yes" from existing rows; never flip the answer back to
      // "no" and hide amenities the HOA already has.
      if (result.amenities.length > 0) setHasAmenities(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load amenities.");
    } finally {
      setLoading(false);
    }
  }, [communityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const chooseTemplate = (chosen: Template) => {
    setTemplate(chosen);
    setName(chosen.name);
    setBookingRequired(chosen.bookingRequired);
    setResourceCount(chosen.resourceCount);
  };

  const createDraft = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await requestJson("POST", `/api/hoa/amenities?communityId=${communityId}`, {
        name: name.trim(),
        type: template.type,
        description: description.trim() || null,
        locationLabel: locationLabel.trim() || null,
        bookingRequired,
        resourceCount: bookingRequired ? resourceCount : 1,
        ...(bookingRequired
          ? {
              policy: {
                slotMinutes: 60,
                minDurationMinutes: 60,
                maxDurationMinutes: 120,
                bufferMinutes: 0,
                maxPartySize,
                advanceDays: 14,
                minNoticeMinutes: 60,
                cancellationCutoffMinutes: 120,
                maxActiveBookingsPerResident: 2,
                approvalRequired: false,
              },
            }
          : {}),
      });
      setNotice(
        `Saved as a draft. ${name.trim()} will not appear to residents until the HOA manager finishes and publishes it.`,
      );
      setName("");
      setDescription("");
      setLocationLabel("");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save that amenity.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-6 rounded-2xl border p-4" style={{ borderColor: "var(--line)" }}>
      <header>
        <h3 className="text-sm font-bold" style={{ color: "var(--ink-900)" }}>
          Amenities setup
        </h3>
        <p className="mt-1 text-xs leading-5" style={{ color: "var(--muted)" }}>
          Capture the shared spaces this HOA has. Everything saved here is a
          draft for the invited manager to finish — hours, photos, and rules are
          theirs to set, and only they publish to residents.
        </p>
      </header>

      {error ? (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-xs text-green-700" role="status">
          {notice}
        </p>
      ) : null}

      <fieldset className="mt-4">
        <legend className="text-xs font-bold" style={{ color: "var(--ink-700)" }}>
          Does this HOA have shared amenities?
        </legend>
        <div className="mt-2 flex gap-4 text-xs" style={{ color: "var(--ink-700)" }}>
          <label className="flex items-center gap-2">
            <input
              checked={hasAmenities === true}
              name="has-amenities"
              onChange={() => setHasAmenities(true)}
              type="radio"
            />
            Yes
          </label>
          <label className="flex items-center gap-2">
            <input
              checked={hasAmenities === false}
              disabled={(catalog?.amenities.length ?? 0) > 0}
              name="has-amenities"
              onChange={() => setHasAmenities(false)}
              type="radio"
            />
            No shared amenities
          </label>
        </div>
      </fieldset>

      {hasAmenities === false ? (
        <p className="mt-3 text-xs" style={{ color: "var(--muted)" }}>
          Nothing to set up. The manager can add amenities later from their own
          dashboard.
        </p>
      ) : hasAmenities === true ? (
        <>
          <div className="mt-4">
            <p className="text-xs font-bold" style={{ color: "var(--ink-700)" }}>
              Start from a template
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {TEMPLATES.map((option) => (
                <button
                  aria-pressed={template.id === option.id}
                  className="h-8 rounded-lg border px-3 text-xs font-semibold"
                  key={option.id}
                  onClick={() => chooseTemplate(option)}
                  style={{
                    borderColor:
                      template.id === option.id ? "var(--teal-800)" : "var(--line)",
                    color:
                      template.id === option.id ? "var(--teal-800)" : "var(--ink-700)",
                  }}
                  type="button"
                >
                  {option.name || "Other"}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
              {template.hint}
            </p>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-xs" style={{ color: "var(--ink-700)" }}>
              <span className="font-semibold">Name</span>
              <input
                className="mt-1 h-9 w-full rounded-lg border px-3 text-xs"
                maxLength={120}
                onChange={(event) => setName(event.target.value)}
                placeholder={AMENITY_TYPE_LABELS[template.type]}
                style={{ borderColor: "var(--line)", background: "var(--paper)" }}
                value={name}
              />
            </label>

            <label className="text-xs" style={{ color: "var(--ink-700)" }}>
              <span className="font-semibold">Where is it? (plain words)</span>
              <input
                className="mt-1 h-9 w-full rounded-lg border px-3 text-xs"
                maxLength={120}
                onChange={(event) => setLocationLabel(event.target.value)}
                placeholder="Behind the clubhouse"
                style={{ borderColor: "var(--line)", background: "var(--paper)" }}
                value={locationLabel}
              />
            </label>

            <label className="text-xs sm:col-span-2" style={{ color: "var(--ink-700)" }}>
              <span className="font-semibold">Short description</span>
              <textarea
                className="mt-1 w-full rounded-lg border px-3 py-2 text-xs"
                maxLength={4000}
                onChange={(event) => setDescription(event.target.value)}
                rows={2}
                style={{ borderColor: "var(--line)", background: "var(--paper)" }}
                value={description}
              />
            </label>
          </div>

          <label
            className="mt-3 flex items-center gap-2 text-xs"
            style={{ color: "var(--ink-700)" }}
          >
            <input
              checked={bookingRequired}
              onChange={(event) => setBookingRequired(event.target.checked)}
              type="checkbox"
            />
            Residents must book this
          </label>

          {bookingRequired ? (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="text-xs" style={{ color: "var(--ink-700)" }}>
                <span className="font-semibold">
                  How many can be used at once? (e.g. 2 courts)
                </span>
                <input
                  className="mt-1 h-9 w-full rounded-lg border px-3 text-xs"
                  max={40}
                  min={1}
                  onChange={(event) => setResourceCount(Number(event.target.value))}
                  style={{ borderColor: "var(--line)", background: "var(--paper)" }}
                  type="number"
                  value={resourceCount}
                />
              </label>
              <label className="text-xs" style={{ color: "var(--ink-700)" }}>
                <span className="font-semibold">Maximum party size</span>
                <input
                  className="mt-1 h-9 w-full rounded-lg border px-3 text-xs"
                  max={500}
                  min={1}
                  onChange={(event) => setMaxPartySize(Number(event.target.value))}
                  style={{ borderColor: "var(--line)", background: "var(--paper)" }}
                  type="number"
                  value={maxPartySize}
                />
              </label>
            </div>
          ) : null}

          <button
            className="mt-4 h-9 rounded-lg px-3 text-xs font-semibold text-white disabled:opacity-60"
            disabled={busy || !name.trim()}
            onClick={() => void createDraft()}
            style={{ background: "var(--teal-800)" }}
            type="button"
          >
            {busy ? "Saving…" : "Save as draft"}
          </button>
        </>
      ) : null}

      <div className="mt-5">
        <p className="text-xs font-bold" style={{ color: "var(--ink-700)" }}>
          Amenities on file
        </p>
        {loading ? (
          <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
            Loading…
          </p>
        ) : (catalog?.amenities.length ?? 0) === 0 ? (
          <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
            None yet.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {catalog?.amenities.map((amenity) => {
              const missing = readiness(amenity);
              return (
                <li
                  className="rounded-lg border px-3 py-2 text-xs"
                  key={amenity.id}
                  style={{ borderColor: "var(--line)" }}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span style={{ color: "var(--ink-900)" }}>
                      <strong>{amenity.name}</strong> · {amenity.typeLabel} ·{" "}
                      {amenity.bookingRequired ? "bookable" : "drop-in"}
                    </span>
                    <span
                      className="rounded-full px-2 py-0.5 font-bold uppercase tracking-wide"
                      style={{
                        background:
                          amenity.status === "published" ? "#ecfdf5" : "#f1f5f9",
                        color: amenity.status === "published" ? "#0f6f63" : "#475569",
                      }}
                    >
                      {amenity.status}
                    </span>
                  </div>
                  {amenity.status !== "published" ? (
                    <p className="mt-1" style={{ color: "var(--muted)" }}>
                      {missing.length > 0
                        ? `The manager still needs to add ${missing.join(" and ")} before publishing.`
                        : "Ready for the manager to review and publish."}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
