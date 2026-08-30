"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Icon } from "@/components/ui/Icon";
import type {
  AmenityDetailView as AmenityDetail,
  AvailabilityDayView,
  AmenityReviewView,
} from "@/lib/amenity-types";
import {
  ISSUE_CATEGORY_LABELS,
  OPERATIONAL_STATUS_LABELS,
  WEEKDAY_LABELS,
} from "@/lib/amenity-types";

/**
 * One amenity, in full.
 *
 * Two rules drive the layout:
 *
 *  1. **A non-bookable amenity gets no calendar.** Showing a grid of times for
 *     a barbecue area nobody reserves teaches residents to distrust the slots
 *     that *are* real. The availability section is replaced by hours and rules.
 *
 *  2. **The browser never decides what is bookable.** Slots come from
 *     `/availability` and are re-checked on submit, so a stale tab produces a
 *     clear "that time was just taken" rather than a phantom reservation.
 */

const CATEGORY_ENTRIES = Object.entries(ISSUE_CATEGORY_LABELS) as Array<
  [keyof typeof ISSUE_CATEGORY_LABELS, string]
>;

async function send(path: string, body: unknown, method = "POST") {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = (await response.json().catch(() => null)) as
    | { error?: string }
    | null;
  if (!response.ok) {
    throw new Error(result?.error ?? "Something went wrong. Please try again.");
  }
  return result;
}

function Banner({ tone, children }: { tone: "error" | "ok"; children: React.ReactNode }) {
  return (
    <p
      className={
        tone === "error"
          ? "rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700"
          : "rounded-xl bg-green-50 px-4 py-3 text-sm font-medium text-green-700"
      }
      role={tone === "error" ? "alert" : "status"}
    >
      {children}
    </p>
  );
}

function Gallery({ amenity }: { amenity: AmenityDetail }) {
  const [active, setActive] = useState(0);
  const photos = amenity.gallery;
  if (photos.length === 0) {
    return (
      <div className="flex h-56 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
        <Icon name="home" size={32} />
      </div>
    );
  }

  return (
    <div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        alt={`${amenity.name}, photo ${active + 1} of ${photos.length}`}
        className="h-56 w-full rounded-2xl object-cover sm:h-80"
        src={photos[active].url}
      />
      {photos.length > 1 ? (
        <div
          aria-label={`${amenity.name} photos`}
          className="mt-3 flex gap-2 overflow-x-auto pb-1"
          role="group"
        >
          {photos.map((photo, index) => (
            <button
              aria-current={index === active}
              aria-label={`Show photo ${index + 1}`}
              className={`h-16 w-24 shrink-0 overflow-hidden rounded-lg border-2 transition ${
                index === active
                  ? "border-[var(--teal-600,#0f8f83)]"
                  : "border-transparent opacity-70 hover:opacity-100"
              }`}
              key={photo.id}
              onClick={() => setActive(index)}
              type="button"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img alt="" className="h-full w-full object-cover" src={photo.url} />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function BookingCalendar({
  amenity,
  onBooked,
}: {
  amenity: AmenityDetail;
  onBooked: (message: string) => void;
}) {
  const [days, setDays] = useState<AvailabilityDayView[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busySlot, setBusySlot] = useState<string | null>(null);
  const [partySize, setPartySize] = useState(1);
  const [duration, setDuration] = useState(
    amenity.policy?.minDurationMinutes ?? 60,
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/hoa/amenities/${amenity.id}/availability?days=7&durationMinutes=${duration}`,
        { credentials: "same-origin", cache: "no-store" },
      );
      const payload = (await response.json()) as {
        days?: AvailabilityDayView[];
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error ?? "Could not load availability.");
      setDays(payload.days ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load availability.");
    } finally {
      setLoading(false);
    }
  }, [amenity.id, duration]);

  useEffect(() => {
    void load();
  }, [load]);

  const book = async (startsAt: string) => {
    if (busySlot) return;
    setBusySlot(startsAt);
    setError(null);
    try {
      await send(`/api/hoa/amenities/${amenity.id}/bookings`, {
        startsAt,
        durationMinutes: duration,
        partySize,
      });
      onBooked(
        amenity.policy?.approvalRequired
          ? "Requested. Your HOA manager will approve or decline it."
          : "Booked. Check your notifications for the confirmation.",
      );
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not book that slot.");
      // Whatever went wrong, the calendar is now stale. Reload so the resident
      // sees the real state rather than the slot they just failed to take.
      await load();
    } finally {
      setBusySlot(null);
    }
  };

  const policy = amenity.policy;
  const durationChoices = policy
    ? Array.from(
        {
          length:
            Math.floor(
              (policy.maxDurationMinutes - policy.minDurationMinutes) / policy.slotMinutes,
            ) + 1,
        },
        (_, index) => policy.minDurationMinutes + index * policy.slotMinutes,
      )
    : [];

  return (
    <section aria-labelledby="availability-heading" className="bb-card bb-card-pad">
      <div className="bb-card-header">
        <div>
          <h2 className="bb-card-title" id="availability-heading">
            Availability
          </h2>
          <p className="bb-card-copy">
            Times are shown in your HOA&apos;s local time.
            {policy?.approvalRequired
              ? " Requests need manager approval before they are confirmed."
              : ""}
          </p>
        </div>
      </div>

      {policy ? (
        <div className="mt-3 flex flex-wrap gap-4">
          {durationChoices.length > 1 ? (
            <label className="text-sm">
              <span className="block font-semibold text-slate-700">Length</span>
              <select
                className="mt-1 rounded-lg border border-[var(--line,#e2e8f0)] px-3 py-2 text-sm"
                onChange={(event) => setDuration(Number(event.target.value))}
                value={duration}
              >
                {durationChoices.map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {minutes} minutes
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {policy.maxPartySize > 1 ? (
            <label className="text-sm">
              <span className="block font-semibold text-slate-700">People</span>
              <select
                className="mt-1 rounded-lg border border-[var(--line,#e2e8f0)] px-3 py-2 text-sm"
                onChange={(event) => setPartySize(Number(event.target.value))}
                value={partySize}
              >
                {Array.from({ length: policy.maxPartySize }, (_, index) => index + 1).map(
                  (size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ),
                )}
              </select>
            </label>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <div className="mt-3">
          <Banner tone="error">{error}</Banner>
        </div>
      ) : null}

      {loading && !days ? (
        <p className="mt-4 text-sm text-slate-500">Loading available times…</p>
      ) : days && days.length > 0 ? (
        <div className="mt-4 space-y-4">
          {days.map((day) => (
            <div key={day.date}>
              <h3 className="text-sm font-bold text-[var(--ink-900,#0f172a)]">
                {WEEKDAY_LABELS[day.weekday]} {day.date}
              </h3>
              {!day.open ? (
                <p className="mt-1 text-sm text-slate-500">
                  {day.closedReason ?? "Closed"}
                </p>
              ) : day.slots.length === 0 ? (
                <p className="mt-1 text-sm text-slate-500">No times available.</p>
              ) : (
                <div className="mt-2 flex flex-wrap gap-2">
                  {day.slots.map((slot) => (
                    <button
                      className={`rounded-lg border px-3 py-2 text-sm font-semibold transition ${
                        slot.available
                          ? "border-[var(--line,#e2e8f0)] bg-white text-slate-800 hover:border-[var(--teal-600,#0f8f83)] hover:text-[var(--teal-800,#0f6f63)]"
                          : "cursor-not-allowed border-transparent bg-slate-100 text-slate-400"
                      }`}
                      disabled={!slot.available || busySlot !== null}
                      key={slot.startsAt}
                      onClick={() => void book(slot.startsAt)}
                      title={slot.available ? undefined : (slot.reason ?? "Unavailable")}
                      type="button"
                    >
                      {slot.startLabel}
                      {slot.available && slot.remaining > 1 ? (
                        <span className="ml-1 text-xs font-normal text-slate-500">
                          ({slot.remaining} left)
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-sm text-slate-500">No availability to show.</p>
      )}
    </section>
  );
}

function ReviewList({ amenity }: { amenity: AmenityDetail }) {
  const [reviews, setReviews] = useState<AmenityReviewView[] | null>(null);
  const [sort, setSort] = useState<"newest" | "highest" | "lowest">("newest");
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async (nextSort: typeof sort, nextCursor: string | null, append: boolean) => {
      setLoading(true);
      try {
        const url = new URL(
          `/api/hoa/amenities/${amenity.id}/reviews`,
          window.location.origin,
        );
        url.searchParams.set("sort", nextSort);
        if (nextCursor) url.searchParams.set("cursor", nextCursor);
        const response = await fetch(url.toString(), {
          credentials: "same-origin",
          cache: "no-store",
        });
        const payload = (await response.json()) as {
          reviews?: AmenityReviewView[];
          nextCursor?: string | null;
        };
        setReviews((current) =>
          append ? [...(current ?? []), ...(payload.reviews ?? [])] : (payload.reviews ?? []),
        );
        setCursor(payload.nextCursor ?? null);
      } finally {
        setLoading(false);
      }
    },
    [amenity.id],
  );

  useEffect(() => {
    void load(sort, null, false);
  }, [load, sort]);

  const summary = amenity.reviewSummary;

  return (
    <section aria-labelledby="reviews-heading" className="bb-card bb-card-pad">
      <div className="bb-card-header">
        <div>
          <h2 className="bb-card-title" id="reviews-heading">
            Reviews
          </h2>
          <p className="bb-card-copy">
            {summary.averageRating !== null
              ? `${summary.averageRating} out of 5 from ${summary.reviewCount} resident review${summary.reviewCount === 1 ? "" : "s"}.`
              : "No reviews yet."}
          </p>
        </div>
        <label className="text-sm">
          <span className="sr-only">Sort reviews</span>
          <select
            className="rounded-lg border border-[var(--line,#e2e8f0)] px-3 py-2 text-sm"
            onChange={(event) => setSort(event.target.value as typeof sort)}
            value={sort}
          >
            <option value="newest">Newest</option>
            <option value="highest">Highest rated</option>
            <option value="lowest">Lowest rated</option>
          </select>
        </label>
      </div>

      {summary.reviewCount > 0 ? (
        <ul className="mt-3 space-y-1">
          {summary.distribution.map((bucket) => (
            <li className="flex items-center gap-3 text-xs" key={bucket.rating}>
              <span className="w-8 text-slate-600">{bucket.rating}★</span>
              <span className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                <span
                  className="block h-full rounded-full bg-amber-400"
                  style={{ width: `${bucket.percent}%` }}
                />
              </span>
              <span className="w-8 text-right text-slate-500">{bucket.count}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <ul className="mt-4 space-y-4">
        {(reviews ?? []).map((review) => (
          <li className="border-t border-[var(--line,#e2e8f0)] pt-4" key={review.id}>
            <div className="flex flex-wrap items-center gap-2">
              <span aria-hidden className="text-amber-500">
                {"★".repeat(review.rating)}
              </span>
              <span className="sr-only">{review.rating} out of 5</span>
              <span className="text-sm font-semibold text-[var(--ink-900,#0f172a)]">
                {review.authorName}
              </span>
              {review.verifiedBooking ? (
                <span className="rounded-full bg-[var(--teal-50,#ecfdf5)] px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-[var(--teal-800,#0f6f63)]">
                  Verified booking
                </span>
              ) : null}
              <span className="text-xs text-slate-500">
                {new Date(review.createdAt).toLocaleDateString()}
                {review.editedAt ? " · Edited" : ""}
              </span>
            </div>
            <p className="mt-2 text-sm text-slate-700">{review.comment}</p>
            {review.photos.length > 0 ? (
              <div className="mt-2 flex gap-2 overflow-x-auto">
                {review.photos.map((photo) => (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    alt=""
                    className="h-20 w-28 shrink-0 rounded-lg object-cover"
                    key={photo.id}
                    loading="lazy"
                    src={photo.url}
                  />
                ))}
              </div>
            ) : null}
            {review.response ? (
              <div className="mt-3 rounded-xl bg-slate-50 p-3">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                  Response from {review.response.responderName} · HOA manager
                </p>
                <p className="mt-1 text-sm text-slate-700">{review.response.body}</p>
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      {cursor ? (
        <button
          className="bb-btn bb-btn-secondary mt-4"
          disabled={loading}
          onClick={() => void load(sort, cursor, true)}
          type="button"
        >
          {loading ? "Loading…" : "Show more reviews"}
        </button>
      ) : null}
    </section>
  );
}

export function AmenityDetailView({ amenity }: { amenity: AmenityDetail }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [reviewOpen, setReviewOpen] = useState(false);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [reviewBookingId, setReviewBookingId] = useState(
    amenity.reviewEligibility.eligibleBookingIds[0] ?? "",
  );

  const [issueOpen, setIssueOpen] = useState(false);
  const [category, setCategory] =
    useState<keyof typeof ISSUE_CATEGORY_LABELS>("damage");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [issuePhoto, setIssuePhoto] = useState<File | null>(null);

  const run = async (action: () => Promise<void>, success: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(success);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const submitReview = () =>
    run(async () => {
      await send(`/api/hoa/amenities/${amenity.id}/reviews`, {
        rating,
        comment,
        ...(reviewBookingId ? { bookingId: reviewBookingId } : {}),
      });
      setReviewOpen(false);
      setComment("");
    }, "Thanks — your review is published.");

  const submitIssue = () =>
    run(async () => {
      const created = (await send(`/api/hoa/amenities/${amenity.id}/issues`, {
        category,
        subject,
        description,
      })) as { issueId?: string } | null;

      if (issuePhoto && created?.issueId) {
        const form = new FormData();
        form.append("file", issuePhoto);
        const response = await fetch(
          `/api/hoa/amenities/issues/${created.issueId}/photos`,
          { method: "POST", credentials: "same-origin", body: form },
        );
        if (!response.ok) {
          // The report itself succeeded; say so rather than implying it failed.
          throw new Error(
            "Your report was sent, but the photo could not be attached. You can add it from the report thread.",
          );
        }
      }

      setIssueOpen(false);
      setSubject("");
      setDescription("");
      setIssuePhoto(null);
    }, "Reported. Your HOA manager has been notified.");

  const cancelBooking = (bookingId: string) =>
    run(async () => {
      await send(`/api/hoa/amenities/bookings/${bookingId}/cancel`, {});
    }, "Reservation cancelled.");

  return (
    <div className="space-y-6">
      {error ? <Banner tone="error">{error}</Banner> : null}
      {notice ? <Banner tone="ok">{notice}</Banner> : null}

      <Gallery amenity={amenity} />

      <header>
        <span className="bb-eyebrow">{amenity.typeLabel}</span>
        <h1 className="bb-page-heading">{amenity.name}</h1>
        <p className="bb-page-subtitle">
          {amenity.locationLabel ? `${amenity.locationLabel} · ` : ""}
          {amenity.bookingRequired ? "Booking required" : "No booking required"}
        </p>
      </header>

      {amenity.operationalStatus !== "open" ? (
        <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900" role="status">
          <strong>{OPERATIONAL_STATUS_LABELS[amenity.operationalStatus]}.</strong>{" "}
          {amenity.operationalNote ?? "New reservations are paused."}
          {amenity.reopensAt
            ? ` Expected back ${new Date(amenity.reopensAt).toLocaleString()}.`
            : ""}
        </div>
      ) : null}

      {amenity.myUpcomingBookings.length > 0 ? (
        <section className="bb-card bb-card-pad" aria-labelledby="mine-heading">
          <h2 className="bb-card-title" id="mine-heading">
            Your reservations here
          </h2>
          <ul className="mt-3 space-y-2">
            {amenity.myUpcomingBookings.map((booking) => (
              <li
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--line,#e2e8f0)] px-3 py-2"
                key={booking.id}
              >
                <div>
                  <p className="text-sm font-semibold">{booking.whenLabel}</p>
                  <p className="text-xs text-slate-500">
                    {booking.resourceLabel} · {booking.statusLabel} · {booking.reference}
                  </p>
                </div>
                {booking.canCancel ? (
                  <button
                    className="bb-btn bb-btn-secondary"
                    disabled={busy}
                    onClick={() => void cancelBooking(booking.id)}
                    type="button"
                  >
                    Cancel
                  </button>
                ) : (
                  <span className="text-xs text-slate-500">
                    Past the cancellation cutoff
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {amenity.bookingRequired ? (
        <BookingCalendar amenity={amenity} onBooked={setNotice} />
      ) : (
        <section className="bb-card bb-card-pad" aria-labelledby="dropin-heading">
          <h2 className="bb-card-title" id="dropin-heading">
            Drop in any time it is open
          </h2>
          <p className="bb-card-copy">
            This is a shared common area. There is no calendar and nothing to
            reserve — just turn up during opening hours.
          </p>
        </section>
      )}

      <section className="bb-card bb-card-pad" aria-labelledby="about-heading">
        <h2 className="bb-card-title" id="about-heading">
          About
        </h2>
        {amenity.description ? (
          <p className="mt-2 whitespace-pre-line text-sm text-slate-700">
            {amenity.description}
          </p>
        ) : null}

        {amenity.features.length > 0 ? (
          <ul className="mt-3 flex flex-wrap gap-2">
            {amenity.features.map((feature) => (
              <li
                className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700"
                key={feature}
              >
                {feature}
              </li>
            ))}
          </ul>
        ) : null}

        <h3 className="mt-5 text-sm font-bold text-[var(--ink-900,#0f172a)]">
          Opening hours
        </h3>
        {amenity.hours.length === 0 ? (
          <p className="mt-1 text-sm text-slate-500">No hours published yet.</p>
        ) : (
          <dl className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
            {amenity.hours.map((entry) => (
              <div className="flex justify-between gap-4" key={`${entry.weekday}-${entry.opensMinute}`}>
                <dt className="text-slate-600">{WEEKDAY_LABELS[entry.weekday]}</dt>
                <dd className="font-medium text-slate-800">{entry.label}</dd>
              </div>
            ))}
          </dl>
        )}

        {amenity.closures.length > 0 ? (
          <>
            <h3 className="mt-5 text-sm font-bold text-[var(--ink-900,#0f172a)]">
              Scheduled closures
            </h3>
            <ul className="mt-2 space-y-1 text-sm text-slate-700">
              {amenity.closures.map((closure) => (
                <li key={closure.id}>
                  {closure.label}
                  {closure.reason ? ` — ${closure.reason}` : ""}
                </li>
              ))}
            </ul>
          </>
        ) : null}

        {[
          ["Rules", amenity.rules],
          ["Permitted uses", amenity.permittedUses],
          ["Age restrictions", amenity.ageRestriction],
          ["Guests", amenity.guestPolicy],
          ["Cancellations", amenity.cancellationPolicy],
          ["Who to contact", amenity.contactInstructions],
        ]
          .filter((entry): entry is [string, string] => Boolean(entry[1]))
          .map(([heading, text]) => (
            <div key={heading}>
              <h3 className="mt-5 text-sm font-bold text-[var(--ink-900,#0f172a)]">
                {heading}
              </h3>
              <p className="mt-1 whitespace-pre-line text-sm text-slate-700">{text}</p>
            </div>
          ))}
      </section>

      <ReviewList amenity={amenity} />

      <section className="bb-card bb-card-pad" aria-labelledby="actions-heading">
        <h2 className="bb-card-title" id="actions-heading">
          Something to say?
        </h2>

        <div className="mt-3 flex flex-wrap gap-3">
          {amenity.reviewEligibility.canReview ? (
            <button
              aria-expanded={reviewOpen}
              className="bb-btn bb-btn-primary"
              onClick={() => setReviewOpen((open) => !open)}
              type="button"
            >
              Write a review
            </button>
          ) : (
            <p className="text-sm text-slate-500">{amenity.reviewEligibility.reason}</p>
          )}

          <button
            aria-expanded={issueOpen}
            className="bb-btn bb-btn-secondary"
            onClick={() => setIssueOpen((open) => !open)}
            type="button"
          >
            Report an issue
          </button>
        </div>

        {reviewOpen ? (
          <form
            className="mt-4 space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void submitReview();
            }}
          >
            {amenity.reviewEligibility.eligibleBookingIds.length > 1 ? (
              <label className="block text-sm">
                <span className="font-semibold text-slate-700">Which visit?</span>
                <select
                  className="mt-1 w-full rounded-lg border border-[var(--line,#e2e8f0)] px-3 py-2 text-sm"
                  onChange={(event) => setReviewBookingId(event.target.value)}
                  value={reviewBookingId}
                >
                  {amenity.reviewEligibility.eligibleBookingIds.map((id) => (
                    <option key={id} value={id}>
                      Completed booking {id.slice(0, 8)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <label className="block text-sm">
              <span className="font-semibold text-slate-700">Rating</span>
              <select
                className="mt-1 rounded-lg border border-[var(--line,#e2e8f0)] px-3 py-2 text-sm"
                onChange={(event) => setRating(Number(event.target.value))}
                value={rating}
              >
                {[5, 4, 3, 2, 1].map((value) => (
                  <option key={value} value={value}>
                    {value} star{value === 1 ? "" : "s"}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-sm">
              <span className="font-semibold text-slate-700">Your review</span>
              <textarea
                className="mt-1 w-full rounded-lg border border-[var(--line,#e2e8f0)] px-3 py-2 text-sm"
                maxLength={2000}
                onChange={(event) => setComment(event.target.value)}
                required
                rows={4}
                value={comment}
              />
            </label>

            <button className="bb-btn bb-btn-primary" disabled={busy} type="submit">
              {busy ? "Posting…" : "Post review"}
            </button>
          </form>
        ) : null}

        {issueOpen ? (
          <form
            className="mt-4 space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void submitIssue();
            }}
          >
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
              This goes to your HOA manager, not Bundleen support. Only you and
              your HOA&apos;s staff can read the thread.
            </p>

            <label className="block text-sm">
              <span className="font-semibold text-slate-700">What kind of problem?</span>
              <select
                className="mt-1 w-full rounded-lg border border-[var(--line,#e2e8f0)] px-3 py-2 text-sm"
                onChange={(event) =>
                  setCategory(event.target.value as keyof typeof ISSUE_CATEGORY_LABELS)
                }
                value={category}
              >
                {CATEGORY_ENTRIES.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-sm">
              <span className="font-semibold text-slate-700">Subject</span>
              <input
                className="mt-1 w-full rounded-lg border border-[var(--line,#e2e8f0)] px-3 py-2 text-sm"
                maxLength={160}
                onChange={(event) => setSubject(event.target.value)}
                required
                value={subject}
              />
            </label>

            <label className="block text-sm">
              <span className="font-semibold text-slate-700">What happened?</span>
              <textarea
                className="mt-1 w-full rounded-lg border border-[var(--line,#e2e8f0)] px-3 py-2 text-sm"
                maxLength={4000}
                onChange={(event) => setDescription(event.target.value)}
                required
                rows={4}
                value={description}
              />
            </label>

            <label className="block text-sm">
              <span className="font-semibold text-slate-700">Photo (optional)</span>
              <input
                accept="image/jpeg,image/png,image/webp"
                className="mt-1 block w-full text-sm"
                onChange={(event) => setIssuePhoto(event.target.files?.[0] ?? null)}
                type="file"
              />
            </label>

            <button className="bb-btn bb-btn-primary" disabled={busy} type="submit">
              {busy ? "Sending…" : "Send report"}
            </button>
          </form>
        ) : null}
      </section>
    </div>
  );
}
