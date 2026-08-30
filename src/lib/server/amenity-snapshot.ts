import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { AMENITY_TYPE_LABELS } from "@/lib/amenity-types";
import type { AvailabilitySnapshot } from "@/lib/server/amenity-availability";
import { db } from "@/lib/server/db";
import type { WeekdayName } from "@/lib/server/timezone";

/**
 * The one query shape that turns an `Amenity` row plus its live bookings into
 * the input the availability engine expects.
 *
 * It lives in its own module because both the catalog reader and the booking
 * writer need it, and having either import the other created a cycle. Keeping
 * the select list here also means the engine's inputs cannot drift apart
 * between "what the calendar previews" and "what the server accepts".
 */

/**
 * Typed as `Prisma.AmenitySelect` rather than `as const`.
 *
 * Prisma 7's generated `orderBy` inputs are mutable arrays, so a `readonly`
 * tuple from `as const` will not assign to them. The trade is that the query's
 * result type widens, which is why every caller casts to {@link AmenityRow} —
 * the hand-written shape below, kept in step with this select list.
 */
export const AMENITY_SELECT: Prisma.AmenitySelect = {
  id: true,
  communityId: true,
  name: true,
  type: true,
  description: true,
  features: true,
  locationLabel: true,
  rules: true,
  permittedUses: true,
  ageRestriction: true,
  guestPolicy: true,
  cancellationPolicy: true,
  contactInstructions: true,
  status: true,
  operationalStatus: true,
  operationalNote: true,
  reopensAt: true,
  bookingRequired: true,
  slotMinutes: true,
  minDurationMinutes: true,
  maxDurationMinutes: true,
  bufferMinutes: true,
  maxPartySize: true,
  advanceDays: true,
  minNoticeMinutes: true,
  cancellationCutoffMinutes: true,
  maxActiveBookingsPerResident: true,
  maxActiveBookingsPerUnit: true,
  approvalRequired: true,
  ratingCount: true,
  ratingSum: true,
  coverMedia: { select: { id: true, width: true, height: true, status: true } },
  resources: {
    where: { active: true },
    orderBy: [{ position: "asc" }, { label: "asc" }],
    select: { id: true, label: true },
  },
  hours: {
    orderBy: [{ weekday: "asc" }, { opensMinute: "asc" }],
    select: { weekday: true, opensMinute: true, closesMinute: true },
  },
  closures: {
    select: {
      id: true,
      kind: true,
      startsAt: true,
      endsAt: true,
      recurringWeekday: true,
      recurringStartMinute: true,
      recurringEndMinute: true,
      residentVisible: true,
      reason: true,
    },
  },
};

export type AmenityRow = {
  id: string;
  communityId: string;
  name: string;
  type: keyof typeof AMENITY_TYPE_LABELS;
  description: string | null;
  features: string[];
  locationLabel: string | null;
  rules: string | null;
  permittedUses: string | null;
  ageRestriction: string | null;
  guestPolicy: string | null;
  cancellationPolicy: string | null;
  contactInstructions: string | null;
  status: "draft" | "published" | "archived";
  operationalStatus: "open" | "closed" | "maintenance" | "temporarily_unavailable";
  operationalNote: string | null;
  reopensAt: Date | null;
  bookingRequired: boolean;
  slotMinutes: number;
  minDurationMinutes: number;
  maxDurationMinutes: number;
  bufferMinutes: number;
  maxPartySize: number;
  advanceDays: number;
  minNoticeMinutes: number;
  cancellationCutoffMinutes: number;
  maxActiveBookingsPerResident: number;
  maxActiveBookingsPerUnit: number | null;
  approvalRequired: boolean;
  ratingCount: number;
  ratingSum: number;
  coverMedia: {
    id: string;
    width: number | null;
    height: number | null;
    status: string;
  } | null;
  resources: Array<{ id: string; label: string }>;
  hours: Array<{ weekday: WeekdayName; opensMinute: number; closesMinute: number }>;
  closures: Array<{
    id: string;
    kind: "blackout" | "maintenance" | "holiday" | "private_event";
    startsAt: Date | null;
    endsAt: Date | null;
    recurringWeekday: WeekdayName | null;
    recurringStartMinute: number | null;
    recurringEndMinute: number | null;
    residentVisible: boolean;
    reason: string | null;
  }>;
};

export function policyOf(row: AmenityRow) {
  return {
    slotMinutes: row.slotMinutes,
    minDurationMinutes: row.minDurationMinutes,
    maxDurationMinutes: row.maxDurationMinutes,
    bufferMinutes: row.bufferMinutes,
    maxPartySize: row.maxPartySize,
    advanceDays: row.advanceDays,
    minNoticeMinutes: row.minNoticeMinutes,
    cancellationCutoffMinutes: row.cancellationCutoffMinutes,
    maxActiveBookingsPerResident: row.maxActiveBookingsPerResident,
    maxActiveBookingsPerUnit: row.maxActiveBookingsPerUnit,
    approvalRequired: row.approvalRequired,
  };
}

export function snapshotFromRow(
  row: AmenityRow,
  timeZone: string,
  heldBlocks: AvailabilitySnapshot["heldBlocks"],
): AvailabilitySnapshot {
  return {
    timeZone,
    policy: policyOf(row),
    bookingRequired: row.bookingRequired,
    status: row.status,
    operationalStatus: row.operationalStatus,
    resources: row.resources,
    hours: row.hours,
    closures: row.closures,
    heldBlocks,
  };
}

/**
 * Loads an amenity together with the bookings that hold capacity in `window`.
 *
 * `heldBlocks` is filtered to the same two statuses the exclusion constraint
 * covers, so a preview and the database never disagree about what "taken"
 * means.
 */
export async function loadAvailabilitySnapshot(
  amenityId: string,
  timeZone: string,
  window: { from: Date; to: Date },
): Promise<AvailabilitySnapshot | null> {
  const row = (await db.amenity.findUnique({
    where: { id: amenityId },
    select: AMENITY_SELECT,
  })) as unknown as AmenityRow | null;
  if (!row) return null;

  const heldBlocks = await db.amenityBooking.findMany({
    where: {
      amenityId,
      status: { in: ["pending_approval", "confirmed"] },
      blockEndsAt: { gt: window.from },
      blockStartsAt: { lt: window.to },
    },
    select: { id: true, resourceId: true, blockStartsAt: true, blockEndsAt: true },
  });

  return snapshotFromRow(
    row,
    timeZone,
    heldBlocks.map((block) => ({
      bookingId: block.id,
      resourceId: block.resourceId,
      blockStartsAt: block.blockStartsAt,
      blockEndsAt: block.blockEndsAt,
    })),
  );
}
