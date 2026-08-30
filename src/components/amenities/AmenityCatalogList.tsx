"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { Icon } from "@/components/ui/Icon";
import type { AmenityCardView, AmenityCatalog } from "@/lib/amenity-types";
import { OPERATIONAL_STATUS_LABELS } from "@/lib/amenity-types";

/**
 * The resident amenity catalog: a vertically scrollable list of places.
 *
 * Modelled on how a modern places app reads — a wide photo, then the facts
 * someone actually decides on (open now? do I need to book? what's the next
 * free slot? how do neighbours rate it?) — using Bundleen's own tokens and
 * type scale rather than imitating anyone's branding.
 *
 * Filtering happens client-side over an already-authorized payload. The server
 * decided *which* amenities exist for this resident; the chips below only
 * narrow what is already on screen, so a tampered filter reveals nothing.
 */

type Filter = "all" | "bookable" | "open" | "drop_in";

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "All" },
  { id: "open", label: "Open now" },
  { id: "bookable", label: "Bookable" },
  { id: "drop_in", label: "No booking needed" },
];

function statusTone(amenity: AmenityCardView): string {
  if (amenity.operationalStatus === "open") {
    return amenity.hoursLabel
      ? "bg-[var(--teal-50,#ecfdf5)] text-[var(--teal-800,#0f6f63)]"
      : "bg-slate-100 text-slate-600";
  }
  return amenity.operationalStatus === "maintenance"
    ? "bg-amber-50 text-amber-800"
    : "bg-rose-50 text-rose-700";
}

function statusLabel(amenity: AmenityCardView): string {
  if (amenity.operationalStatus !== "open") {
    return OPERATIONAL_STATUS_LABELS[amenity.operationalStatus];
  }
  return amenity.hoursLabel ? "Open today" : "Closed today";
}

function Stars({ rating }: { rating: number }) {
  // Rendered as text for screen readers and as filled glyphs visually, so the
  // rating is never conveyed by shape alone.
  return (
    <span className="inline-flex items-center gap-1">
      <span aria-hidden className="text-amber-500">
        {"★".repeat(Math.round(rating))}
        <span className="text-slate-300">{"★".repeat(5 - Math.round(rating))}</span>
      </span>
      <span className="sr-only">{rating} out of 5</span>
    </span>
  );
}

export function AmenityCatalogList({ catalog }: { catalog: AmenityCatalog }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return catalog.amenities.filter((amenity) => {
      if (needle && !`${amenity.name} ${amenity.typeLabel}`.toLowerCase().includes(needle)) {
        return false;
      }
      if (filter === "bookable") return amenity.bookingRequired;
      if (filter === "drop_in") return !amenity.bookingRequired;
      if (filter === "open") {
        return amenity.operationalStatus === "open" && Boolean(amenity.hoursLabel);
      }
      return true;
    });
  }, [catalog.amenities, filter, query]);

  return (
    <div className="space-y-5">
      {catalog.myUpcomingBookings.length > 0 ? (
        <section className="bb-card bb-card-pad" aria-labelledby="upcoming-heading">
          <h2 className="bb-card-title" id="upcoming-heading">
            Your upcoming reservations
          </h2>
          <ul className="mt-3 space-y-2">
            {catalog.myUpcomingBookings.map((booking) => (
              <li
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--line,#e2e8f0)] px-3 py-2"
                key={booking.id}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-[var(--ink-900,#0f172a)]">
                    {booking.amenityName}
                  </p>
                  <p className="text-xs text-slate-500">
                    {booking.whenLabel} · {booking.resourceLabel} · {booking.reference}
                  </p>
                </div>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                  {booking.statusLabel}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="relative flex-1">
          <span className="sr-only">Search amenities</span>
          <input
            className="w-full rounded-full border border-[var(--line,#e2e8f0)] bg-white px-4 py-2.5 text-sm outline-none focus:border-[var(--teal-600,#0f8f83)] focus:ring-2 focus:ring-[var(--teal-100,#ccfbf1)]"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search the pool, gym, courts…"
            type="search"
            value={query}
          />
        </label>
        <div
          aria-label="Filter amenities"
          className="flex gap-2 overflow-x-auto pb-1"
          role="group"
        >
          {FILTERS.map((option) => (
            <button
              aria-pressed={filter === option.id}
              className={`shrink-0 rounded-full border px-3.5 py-2 text-xs font-semibold transition ${
                filter === option.id
                  ? "border-transparent bg-[var(--ink-900,#0f172a)] text-white"
                  : "border-[var(--line,#e2e8f0)] bg-white text-slate-600 hover:border-slate-300"
              }`}
              key={option.id}
              onClick={() => setFilter(option.id)}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-[var(--line,#e2e8f0)] px-6 py-12 text-center text-sm text-slate-500">
          {catalog.amenities.length === 0
            ? "Your HOA has not published any shared amenities yet."
            : "No amenities match that filter."}
        </p>
      ) : (
        <ul className="space-y-4">
          {visible.map((amenity) => (
            <li key={amenity.id}>
              <Link
                className="group block overflow-hidden rounded-2xl border border-[var(--line,#e2e8f0)] bg-white transition hover:border-[var(--teal-600,#0f8f83)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--teal-600,#0f8f83)] sm:flex"
                href={`/app/homeowner/amenities/${amenity.id}`}
              >
                <div className="relative h-44 w-full shrink-0 bg-slate-100 sm:h-auto sm:w-64">
                  {amenity.cover ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      alt=""
                      className="h-full w-full object-cover"
                      loading="lazy"
                      src={amenity.cover.url}
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-slate-400">
                      <Icon name="home" size={28} />
                    </div>
                  )}
                  {amenity.status !== "published" ? (
                    <span className="absolute left-3 top-3 rounded-full bg-slate-900/85 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-white">
                      {amenity.status}
                    </span>
                  ) : null}
                </div>

                <div className="flex-1 p-4 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="text-base font-bold text-[var(--ink-900,#0f172a)]">
                        {amenity.name}
                      </h3>
                      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                        {amenity.typeLabel}
                      </p>
                    </div>
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusTone(amenity)}`}
                    >
                      {statusLabel(amenity)}
                    </span>
                  </div>

                  <dl className="mt-3 grid gap-1.5 text-sm text-slate-600">
                    {amenity.hoursLabel ? (
                      <div className="flex items-center gap-2">
                        <Icon name="clock" size={15} />
                        <dt className="sr-only">Hours today</dt>
                        <dd>{amenity.hoursLabel}</dd>
                      </div>
                    ) : amenity.nextOpenLabel ? (
                      <div className="flex items-center gap-2">
                        <Icon name="clock" size={15} />
                        <dt className="sr-only">Next open</dt>
                        <dd>{amenity.nextOpenLabel}</dd>
                      </div>
                    ) : null}

                    {amenity.locationLabel ? (
                      <div className="flex items-center gap-2">
                        <Icon name="map-pin" size={15} />
                        <dt className="sr-only">Location</dt>
                        <dd>{amenity.locationLabel}</dd>
                      </div>
                    ) : null}

                    <div className="flex items-center gap-2">
                      <Icon name="calendar" size={15} />
                      <dt className="sr-only">Booking</dt>
                      <dd>
                        {amenity.bookingRequired ? (
                          <>
                            Booking required
                            {amenity.nextAvailable
                              ? ` · next free ${amenity.nextAvailable.label}`
                              : " · no free slots in the booking window"}
                          </>
                        ) : (
                          "No booking required"
                        )}
                      </dd>
                    </div>

                    {amenity.capacityLabel ? (
                      <div className="flex items-center gap-2">
                        <Icon name="users" size={15} />
                        <dt className="sr-only">Capacity</dt>
                        <dd>{amenity.capacityLabel}</dd>
                      </div>
                    ) : null}
                  </dl>

                  <div className="mt-3 flex items-center justify-between gap-3">
                    <p className="text-sm text-slate-600">
                      {amenity.averageRating !== null ? (
                        <>
                          <Stars rating={amenity.averageRating} />{" "}
                          <span className="font-semibold">{amenity.averageRating}</span>{" "}
                          <span className="text-slate-500">
                            ({amenity.reviewCount} review{amenity.reviewCount === 1 ? "" : "s"})
                          </span>
                        </>
                      ) : (
                        <span className="text-slate-500">No reviews yet</span>
                      )}
                    </p>
                    <span className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--teal-800,#0f6f63)] group-hover:underline">
                      View
                      <Icon name="chevron-right" size={16} />
                    </span>
                  </div>

                  {amenity.operationalStatus !== "open" && amenity.operationalNote ? (
                    <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                      {amenity.operationalNote}
                      {amenity.reopensAt
                        ? ` Expected back ${new Date(amenity.reopensAt).toLocaleDateString()}.`
                        : ""}
                    </p>
                  ) : null}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
