import "server-only";

import { randomUUID } from "node:crypto";

import type {
  HoaProfileSummary,
  UnitImportPreviewRow,
  UnitImportResult,
  UnitSummary,
} from "@/lib/hoa-types";
import {
  hasDistinctAddress,
  isMaterialAddressChange,
  resolveForStorage,
} from "@/lib/server/address-verification";
import { buildAuditEntry } from "@/lib/server/audit";
import { db } from "@/lib/server/db";
import { HoaWorkflowError } from "@/lib/server/hoa";
import type {
  HoaOnboardingStatusInput,
  HoaProfileInput,
  UnitCreateInput,
  UnitImportInput,
  UnitUpdateInput,
} from "@/lib/validation/hoa";
import { MAX_UNIT_LABEL_LENGTH, MAX_UNITS_PER_IMPORT } from "@/lib/validation/hoa";

/**
 * HOA profile and unit inventory. Callers are already authorized as either a
 * Bundleen admin or the scoped manager of `communityId`; every function here
 * still re-verifies the community is a real HOA so a stray neighborhood id
 * can never grow units.
 */

async function requireHoaCommunity(communityId: string) {
  const community = await db.community.findUnique({
    where: { id: communityId },
    select: { id: true, name: true, type: true, status: true },
  });
  if (!community || community.type !== "hoa") {
    throw new HoaWorkflowError("That HOA does not exist.", 404);
  }
  return community;
}

/**
 * The admin's view of an HOA profile.
 *
 * Coordinates are deliberately absent from the wire type. Bundleen holds them
 * for matching, maps, distance, and routing, and the admin is shown the
 * verified address and a status instead — the numbers are not something a
 * human should be reading, correcting, or typing.
 */
export function serializeHoaProfile(row: {
  communityId: string;
  legalName: string;
  displayName: string | null;
  addressLine1: string;
  addressLine2: string | null;
  locality: string;
  region: string;
  postalCode: string;
  country: string;
  latitude: number | null;
  longitude: number | null;
  formattedAddress: string | null;
  addressVerificationStatus: HoaProfileSummary["addressVerificationStatus"];
  addressVerifiedAt: Date | null;
  timezone: string;
  totalHomes: number;
  referenceCode: string | null;
  serviceNotes: string | null;
  onboardingStatus: HoaProfileSummary["onboardingStatus"];
}): HoaProfileSummary {
  return {
    communityId: row.communityId,
    legalName: row.legalName,
    displayName: row.displayName,
    addressLine1: row.addressLine1,
    addressLine2: row.addressLine2,
    locality: row.locality,
    region: row.region,
    postalCode: row.postalCode,
    country: row.country,
    formattedAddress: row.formattedAddress,
    addressVerificationStatus: row.addressVerificationStatus,
    addressVerifiedAt: row.addressVerifiedAt?.toISOString() ?? null,
    // Ready means "we can route a crew here": verified *and* holding numbers.
    // The database CHECK makes those the same thing; this states the intent.
    locationReady:
      row.addressVerificationStatus === "verified" &&
      row.latitude !== null &&
      row.longitude !== null,
    timezone: row.timezone,
    totalHomes: row.totalHomes,
    referenceCode: row.referenceCode,
    serviceNotes: row.serviceNotes,
    onboardingStatus: row.onboardingStatus,
  };
}

export async function getHoaProfile(communityId: string): Promise<HoaProfileSummary | null> {
  const row = await db.hoaProfile.findUnique({ where: { communityId } });
  return row ? serializeHoaProfile(row) : null;
}

/**
 * Bundleen admin creates or updates the HOA's legal/onboarding detail.
 *
 * The admin supplies business fields and a postal address. Coordinates are
 * resolved here, on the server, and written in the same statement as the
 * normalized address they belong to — so the two can never disagree.
 *
 * The order matters: geocoding happens *before* the transaction. An ambiguous
 * or unavailable answer therefore throws with nothing written at all, which is
 * what lets the admin retry with their form intact and keeps a half-verified
 * profile from existing.
 */
export async function upsertHoaProfile(
  actorUserId: string,
  communityId: string,
  input: HoaProfileInput,
): Promise<HoaProfileSummary> {
  const community = await requireHoaCommunity(communityId);
  const profileId = randomUUID();

  const existing = await db.hoaProfile.findUnique({
    where: { communityId: community.id },
    select: {
      addressLine1: true,
      addressLine2: true,
      locality: true,
      region: true,
      postalCode: true,
      country: true,
      latitude: true,
      longitude: true,
      addressVerificationStatus: true,
    },
  });

  const entered = {
    addressLine1: input.addressLine1,
    addressLine2: input.addressLine2,
    locality: input.locality,
    region: input.region,
    postalCode: input.postalCode,
    country: input.country.toUpperCase(),
  };

  const materialChange =
    isMaterialAddressChange(existing, entered) ||
    // A profile that was never resolved re-tries on every save. Otherwise a
    // transient outage would leave the HOA unverified until somebody happened
    // to edit the street line.
    existing?.addressVerificationStatus !== "verified" ||
    Boolean(input.confirmedFormattedAddress);

  let addressData: {
    addressLine1: string;
    addressLine2: string | null;
    locality: string;
    region: string;
    postalCode: string;
    country: string;
    latitude?: number;
    longitude?: number;
    formattedAddress?: string;
    addressVerificationStatus?: "verified";
    addressVerifiedAt?: Date;
    geocodePlaceId?: string | null;
    geocodeConfidence?: number;
  };
  let resolvedFor: string | null = null;
  if (materialChange) {
    const resolved = await resolveForStorage(entered, input.confirmedFormattedAddress);
    resolvedFor = resolved.formattedAddress;
    addressData = {
      addressLine1: resolved.addressLine1,
      addressLine2: resolved.addressLine2,
      locality: resolved.locality,
      region: resolved.region,
      postalCode: resolved.postalCode,
      country: resolved.country,
      // Stale coordinates are replaced, never merged: these belong to the
      // address written in the same statement.
      latitude: resolved.latitude,
      longitude: resolved.longitude,
      formattedAddress: resolved.formattedAddress,
      addressVerificationStatus: "verified" as const,
      addressVerifiedAt: new Date(),
      geocodePlaceId: resolved.placeId,
      geocodeConfidence: resolved.confidence,
    };
  } else {
    // Same address, still verified: leave the resolved location untouched.
    addressData = entered;
  }

  const data = {
    legalName: input.legalName,
    displayName: input.displayName,
    timezone: input.timezone,
    totalHomes: input.totalHomes,
    referenceCode: input.referenceCode,
    serviceNotes: input.serviceNotes,
    ...addressData,
  };

  const [profile] = await db.$transaction([
    db.hoaProfile.upsert({
      where: { communityId: community.id },
      create: { id: profileId, communityId: community.id, ...data },
      update: data,
    }),
    db.adminAuditLog.create({
      data: buildAuditEntry({
        actorUserId,
        action: "hoa_profile_updated",
        targetType: "hoa_profile",
        targetId: community.id,
        communityId: community.id,
        // Field *names* only. The address itself and the resolved coordinates
        // are customer data and are deliberately not audited.
        metadata: { changedFields: Object.keys(data), addressReVerified: materialChange },
      }),
    }),
    ...(resolvedFor
      ? [
          db.adminAuditLog.create({
            data: buildAuditEntry({
              actorUserId,
              action: "address_verified",
              targetType: "hoa_profile",
              targetId: community.id,
              communityId: community.id,
              metadata: { subject: "hoa_profile" },
            }),
          }),
        ]
      : []),
  ]);
  return serializeHoaProfile(profile);
}

/** Admin moves the onboarding pipeline stage shown on the operations portal. */
export async function setHoaOnboardingStatus(
  actorUserId: string,
  communityId: string,
  input: HoaOnboardingStatusInput,
): Promise<void> {
  const community = await requireHoaCommunity(communityId);
  const profile = await db.hoaProfile.findUnique({
    where: { communityId: community.id },
    select: { onboardingStatus: true },
  });
  if (!profile) {
    throw new HoaWorkflowError("Create the HOA profile before setting onboarding progress.", 409);
  }
  if (profile.onboardingStatus === input.onboardingStatus) return;

  await db.$transaction([
    db.hoaProfile.update({
      where: { communityId: community.id },
      data: { onboardingStatus: input.onboardingStatus },
    }),
    db.adminAuditLog.create({
      data: buildAuditEntry({
        actorUserId,
        action: "hoa_profile_updated",
        targetType: "hoa_profile",
        targetId: community.id,
        communityId: community.id,
        metadata: {
          previousStatus: profile.onboardingStatus,
          nextStatus: input.onboardingStatus,
        },
      }),
    }),
  ]);
}

/* ── Units ───────────────────────────────────────────────────────────────── */

type UnitRow = {
  id: string;
  label: string;
  addressLine1: string | null;
  locality: string | null;
  region: string | null;
  postalCode: string | null;
  latitude: number | null;
  longitude: number | null;
  formattedAddress: string | null;
  addressVerificationStatus: UnitSummary["addressVerificationStatus"];
  occupancyStatus: UnitSummary["occupancyStatus"];
  accessNotes: string | null;
  memberships: Array<{ user: { fullName: string; email: string } }>;
  invitations: Array<{ email: string }>;
};

const unitListSelect = {
  id: true,
  label: true,
  addressLine1: true,
  locality: true,
  region: true,
  postalCode: true,
  latitude: true,
  longitude: true,
  formattedAddress: true,
  addressVerificationStatus: true,
  occupancyStatus: true,
  accessNotes: true,
  memberships: {
    where: { status: "active" as const },
    select: { user: { select: { fullName: true, email: true } } },
    take: 1,
  },
  invitations: {
    where: { status: "pending" as const },
    select: { email: true },
    take: 1,
  },
};

/**
 * @param hoaLocationReady Whether the HOA's own address is resolved. A home
 * with no distinct address of its own inherits that location, so its readiness
 * is the HOA's readiness — not a separate lookup.
 */
function serializeUnit(row: UnitRow, hoaLocationReady: boolean): UnitSummary {
  const inherits = !row.addressLine1?.trim();
  return {
    id: row.id,
    label: row.label,
    addressLine1: row.addressLine1,
    locality: row.locality,
    region: row.region,
    postalCode: row.postalCode,
    inheritsHoaAddress: inherits,
    addressVerificationStatus: row.addressVerificationStatus,
    formattedAddress: row.formattedAddress,
    locationReady: inherits
      ? hoaLocationReady
      : row.addressVerificationStatus === "verified" &&
        row.latitude !== null &&
        row.longitude !== null,
    occupancyStatus: row.occupancyStatus,
    accessNotes: row.accessNotes,
    residentName: row.memberships[0]?.user.fullName ?? null,
    residentEmail: row.memberships[0]?.user.email ?? null,
    pendingInviteEmail: row.invitations[0]?.email ?? null,
  };
}

/** Whether the HOA's own address is resolved well enough to route to. */
async function hoaLocationReady(communityId: string): Promise<boolean> {
  const profile = await db.hoaProfile.findUnique({
    where: { communityId },
    select: { addressVerificationStatus: true, latitude: true, longitude: true },
  });
  return (
    profile?.addressVerificationStatus === "verified" &&
    profile.latitude !== null &&
    profile.longitude !== null
  );
}

export async function listUnits(communityId: string): Promise<UnitSummary[]> {
  await requireHoaCommunity(communityId);
  const [rows, ready] = await Promise.all([
    db.communityUnit.findMany({
      where: { communityId },
      orderBy: { label: "asc" },
      select: unitListSelect,
    }),
    hoaLocationReady(communityId),
  ]);
  return rows.map((row) => serializeUnit(row, ready));
}

/**
 * Resolves a unit's own address, when it has one.
 *
 * Returns the columns to write. A home with no distinct address inherits the
 * HOA's verified location and is never sent to the geocoder — there is nothing
 * new to look up, and the extra call would be pure cost.
 *
 * Unlike the HOA profile, a failure here does not abort the write: one home
 * whose address cannot be resolved should not stop an admin from building the
 * roster. The home is saved as `needs_correction` instead, and
 * {@link communityLocationReadiness} is what stops routeable work from being
 * awarded while it stays that way.
 */
async function resolveUnitAddress(
  community: { id: string },
  input: {
    addressLine1?: string | null;
    locality?: string | null;
    region?: string | null;
    postalCode?: string | null;
  },
): Promise<Record<string, unknown>> {
  if (!hasDistinctAddress(input)) {
    return {
      addressLine1: input.addressLine1 ?? null,
      locality: input.locality ?? null,
      region: input.region ?? null,
      postalCode: input.postalCode ?? null,
      latitude: null,
      longitude: null,
      formattedAddress: null,
      addressVerificationStatus: "pending" as const,
      addressVerifiedAt: null,
      geocodePlaceId: null,
    };
  }

  const profile = await db.hoaProfile.findUnique({
    where: { communityId: community.id },
    select: { locality: true, region: true, postalCode: true, country: true },
  });

  try {
    const resolved = await resolveForStorage({
      addressLine1: input.addressLine1 as string,
      locality: input.locality ?? profile?.locality ?? "",
      region: input.region ?? profile?.region ?? "",
      postalCode: input.postalCode ?? profile?.postalCode ?? "",
      country: profile?.country ?? "US",
    });
    return {
      addressLine1: resolved.addressLine1,
      locality: resolved.locality,
      region: resolved.region,
      postalCode: resolved.postalCode,
      latitude: resolved.latitude,
      longitude: resolved.longitude,
      formattedAddress: resolved.formattedAddress,
      addressVerificationStatus: "verified" as const,
      addressVerifiedAt: new Date(),
      geocodePlaceId: resolved.placeId,
    };
  } catch {
    // Ambiguous, unresolvable, or the provider was unavailable. Keep what the
    // admin typed, mark it for correction, and store no coordinates: an
    // unverified home is visible and fixable, a wrong one is not.
    return {
      addressLine1: input.addressLine1 ?? null,
      locality: input.locality ?? null,
      region: input.region ?? null,
      postalCode: input.postalCode ?? null,
      latitude: null,
      longitude: null,
      formattedAddress: null,
      addressVerificationStatus: "needs_correction" as const,
      addressVerifiedAt: null,
      geocodePlaceId: null,
    };
  }
}

export async function createUnit(
  actorUserId: string,
  communityId: string,
  input: UnitCreateInput,
): Promise<UnitSummary> {
  const community = await requireHoaCommunity(communityId);
  const unitId = randomUUID();
  const addressData = await resolveUnitAddress(community, input);

  try {
    await db.$transaction([
      db.communityUnit.create({
        data: {
          id: unitId,
          communityId: community.id,
          label: input.label,
          accessNotes: input.accessNotes,
          ...addressData,
        },
      }),
      db.adminAuditLog.create({
        data: buildAuditEntry({
          actorUserId,
          action: "hoa_unit_created",
          targetType: "hoa_unit",
          targetId: unitId,
          communityId: community.id,
        }),
      }),
    ]);
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") {
      throw new HoaWorkflowError("A unit with that label already exists in this HOA.");
    }
    throw error;
  }

  const [created, ready] = await Promise.all([
    db.communityUnit.findUniqueOrThrow({ where: { id: unitId }, select: unitListSelect }),
    hoaLocationReady(community.id),
  ]);
  return serializeUnit(created, ready);
}

export async function updateUnit(
  actorUserId: string,
  communityId: string,
  unitId: string,
  input: UnitUpdateInput,
): Promise<UnitSummary> {
  const community = await requireHoaCommunity(communityId);
  const unit = await db.communityUnit.findFirst({
    where: { id: unitId, communityId: community.id },
    select: { id: true, occupancyStatus: true },
  });
  if (!unit) throw new HoaWorkflowError("That unit does not exist.", 404);

  if (input.occupancyStatus === "occupied" || input.occupancyStatus === "invite_pending") {
    throw new HoaWorkflowError(
      "Occupied and invite-pending states are set by invitations, not by hand.",
      400,
    );
  }
  if (input.occupancyStatus === "vacant" || input.occupancyStatus === "inactive") {
    const activeResident = await db.communityMembership.findFirst({
      where: { unitId, status: "active" },
      select: { id: true },
    });
    if (activeResident) {
      throw new HoaWorkflowError("Remove the unit's active resident before changing its status.");
    }
  }

  // Any touch of the address fields re-resolves the location. A home whose
  // street line changed must not keep pointing at where it used to be.
  const addressTouched =
    input.addressLine1 !== undefined ||
    input.locality !== undefined ||
    input.region !== undefined ||
    input.postalCode !== undefined;
  const current = await db.communityUnit.findUniqueOrThrow({
    where: { id: unitId },
    select: { addressLine1: true, locality: true, region: true, postalCode: true },
  });
  const merged = {
    addressLine1: input.addressLine1 !== undefined ? input.addressLine1 : current.addressLine1,
    locality: input.locality !== undefined ? input.locality : current.locality,
    region: input.region !== undefined ? input.region : current.region,
    postalCode: input.postalCode !== undefined ? input.postalCode : current.postalCode,
  };
  const addressChanged =
    addressTouched && isMaterialAddressChange(
      {
        addressLine1: current.addressLine1 ?? "",
        locality: current.locality ?? "",
        region: current.region ?? "",
        postalCode: current.postalCode ?? "",
        country: "US",
      },
      {
        addressLine1: merged.addressLine1 ?? "",
        locality: merged.locality ?? "",
        region: merged.region ?? "",
        postalCode: merged.postalCode ?? "",
        country: "US",
      },
    );

  const data = {
    ...(input.label !== undefined ? { label: input.label } : {}),
    ...(input.accessNotes !== undefined ? { accessNotes: input.accessNotes } : {}),
    ...(input.occupancyStatus !== undefined ? { occupancyStatus: input.occupancyStatus } : {}),
    ...(addressChanged ? await resolveUnitAddress(community, merged) : {}),
  };

  try {
    await db.$transaction([
      db.communityUnit.update({ where: { id: unitId }, data }),
      db.adminAuditLog.create({
        data: buildAuditEntry({
          actorUserId,
          action: "hoa_unit_updated",
          targetType: "hoa_unit",
          targetId: unitId,
          communityId: community.id,
          metadata: { changedFields: Object.keys(data) },
        }),
      }),
    ]);
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") {
      throw new HoaWorkflowError("A unit with that label already exists in this HOA.");
    }
    throw error;
  }

  const [updated, ready] = await Promise.all([
    db.communityUnit.findUniqueOrThrow({ where: { id: unitId }, select: unitListSelect }),
    hoaLocationReady(community.id),
  ]);
  return serializeUnit(updated, ready);
}

/**
 * Removes only an entirely unused inventory row.
 *
 * Historical units are records, not form clutter: a membership, invitation,
 * service participation/visit, or amenity booking makes deletion unsafe and
 * is rejected. This gives admins a safe way to clear legacy placeholders
 * without silently erasing resident or service history.
 */
export async function removeUnusedUnit(
  actorUserId: string,
  communityId: string,
  unitId: string,
): Promise<void> {
  const community = await requireHoaCommunity(communityId);
  const unit = await db.communityUnit.findFirst({
    where: { id: unitId, communityId: community.id },
    select: {
      id: true,
      occupancyStatus: true,
      _count: {
        select: {
          memberships: true,
          invitations: true,
          participations: true,
          visits: true,
          amenityBookings: true,
        },
      },
    },
  });
  if (!unit) throw new HoaWorkflowError("That unit does not exist.", 404);
  const linkedRecords = Object.values(unit._count).reduce((sum, count) => sum + count, 0);
  if (
    !["vacant", "inactive"].includes(unit.occupancyStatus) ||
    linkedRecords > 0
  ) {
    throw new HoaWorkflowError(
      "This unit has resident, invitation, service, or booking history and cannot be removed.",
      409,
    );
  }

  await db.$transaction([
    db.communityUnit.delete({ where: { id: unit.id } }),
    db.adminAuditLog.create({
      data: buildAuditEntry({
        actorUserId,
        action: "hoa_unit_removed",
        targetType: "hoa_unit",
        targetId: unit.id,
        communityId: community.id,
      }),
    }),
  ]);
}

/* ── CSV import ──────────────────────────────────────────────────────────── */

/**
 * Accepted columns. There is no `latitude`/`longitude` here and there never
 * will be: an admin exporting a roster from an HOA's own records has labels
 * and addresses, not coordinates, and asking for coordinates is how wrong
 * locations get typed in.
 */
const IMPORT_HEADER = ["label", "addressline1", "locality", "region", "postalcode"] as const;

/** Minimal RFC-4180 field splitting: quoted fields, doubled quotes, commas. */
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (inQuotes) {
      if (character === '"') {
        if (line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += character;
      }
    } else if (character === '"') {
      inQuotes = true;
    } else if (character === ",") {
      fields.push(current);
      current = "";
    } else {
      current += character;
    }
  }
  fields.push(current);
  return fields.map((field) => field.trim());
}

type ParsedImportRow = {
  line: number;
  label: string;
  addressLine1: string | null;
  locality: string | null;
  region: string | null;
  postalCode: string | null;
  problem: string | null;
};

function parseImportCsv(csv: string): { rows: ParsedImportRow[]; headerProblem: string | null } {
  const lines = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return { rows: [], headerProblem: "The file is empty." };

  const header = splitCsvLine(lines[0]).map((cell) => cell.toLowerCase().replace(/[^a-z0-9]/g, ""));
  if (header[0] !== "label") {
    return {
      rows: [],
      headerProblem:
        'The first column must be "label". Expected header: label,addressLine1,locality,region,postalCode',
    };
  }
  const coordinateColumn = header.find((name) => name === "latitude" || name === "longitude");
  if (coordinateColumn) {
    // Refused rather than ignored: a file carrying coordinates was probably
    // built for an older import, and silently dropping them would leave the
    // admin believing a location was set.
    return {
      rows: [],
      headerProblem:
        "Remove the latitude and longitude columns. Bundleen resolves coordinates from the address automatically.",
    };
  }
  const columnIndex = new Map<string, number>();
  header.forEach((name, index) => columnIndex.set(name, index));

  const rows: ParsedImportRow[] = [];
  for (let lineNumber = 1; lineNumber < lines.length; lineNumber += 1) {
    const cells = splitCsvLine(lines[lineNumber]);
    const cell = (name: (typeof IMPORT_HEADER)[number]) => {
      const index = columnIndex.get(name);
      if (index === undefined) return null;
      const value = cells[index]?.trim() ?? "";
      return value || null;
    };

    const label = cell("label") ?? "";
    const addressLine1 = cell("addressline1");

    let problem: string | null = null;
    if (!label) problem = "Missing label.";
    else if (label.length > MAX_UNIT_LABEL_LENGTH) problem = "Label is too long.";
    else if (addressLine1 && addressLine1.length > 160) problem = "Street address is too long.";

    rows.push({
      line: lineNumber + 1,
      label,
      addressLine1,
      locality: cell("locality"),
      region: cell("region"),
      postalCode: cell("postalcode"),
      problem,
    });
  }
  return { rows, headerProblem: null };
}

/**
 * Idempotent unit import: previously imported labels are reported and skipped,
 * so re-running the same file cannot duplicate homes. `commit: false` is the
 * dry run the UI shows before anything is written.
 */
export async function importUnits(
  actorUserId: string,
  communityId: string,
  input: UnitImportInput,
): Promise<UnitImportResult> {
  const community = await requireHoaCommunity(communityId);

  const { rows, headerProblem } = parseImportCsv(input.csv);
  if (headerProblem) throw new HoaWorkflowError(headerProblem, 400);
  if (rows.length === 0) throw new HoaWorkflowError("The file has no data rows.", 400);
  if (rows.length > MAX_UNITS_PER_IMPORT) {
    throw new HoaWorkflowError(`Import at most ${MAX_UNITS_PER_IMPORT} units at a time.`, 400);
  }

  const existing = await db.communityUnit.findMany({
    where: { communityId: community.id },
    select: { label: true },
  });
  const existingLabels = new Set(existing.map((unit) => unit.label.toLowerCase()));

  const seenInFile = new Set<string>();
  const preview: UnitImportPreviewRow[] = [];
  const toCreate: ParsedImportRow[] = [];

  for (const row of rows) {
    const key = row.label.toLowerCase();
    if (row.problem) {
      preview.push({ line: row.line, label: row.label, status: "invalid", problem: row.problem });
    } else if (seenInFile.has(key)) {
      preview.push({
        line: row.line,
        label: row.label,
        status: "duplicate_in_file",
        problem: "This label appears earlier in the file.",
      });
    } else if (existingLabels.has(key)) {
      seenInFile.add(key);
      preview.push({
        line: row.line,
        label: row.label,
        status: "already_exists",
        problem: null,
      });
    } else {
      seenInFile.add(key);
      toCreate.push(row);
      preview.push({ line: row.line, label: row.label, status: "create", problem: null });
    }
  }

  const result: UnitImportResult = {
    committed: false,
    totalRows: rows.length,
    createCount: toCreate.length,
    duplicateCount: preview.filter(
      (row) => row.status === "already_exists" || row.status === "duplicate_in_file",
    ).length,
    invalidCount: preview.filter((row) => row.status === "invalid").length,
    rows: preview,
  };

  // A dry run validates and reports without writing a row and without a single
  // geocoding call. Previewing a 500-line file must cost nothing externally.
  if (!input.commit || toCreate.length === 0) return result;

  // Rows are written first, then geocoded in bounded batches. Writing first
  // means a provider outage halfway through leaves a complete roster whose
  // unresolved homes are visible and retryable, rather than a half-imported
  // file the admin has to reconcile by hand.
  const rowsWithIds = toCreate.map((row) => ({ ...row, id: randomUUID() }));

  await db.$transaction([
    db.communityUnit.createMany({
      data: rowsWithIds.map((row) => ({
        id: row.id,
        communityId: community.id,
        label: row.label,
        addressLine1: row.addressLine1,
        locality: row.locality,
        region: row.region,
        postalCode: row.postalCode,
        // Homes with their own address start `pending` and are resolved below;
        // homes without one inherit the HOA's location and stay `pending`
        // forever, which is correct — there is nothing of their own to verify.
        addressVerificationStatus: "pending" as const,
      })),
      skipDuplicates: true,
    }),
    db.adminAuditLog.create({
      data: buildAuditEntry({
        actorUserId,
        action: "hoa_units_imported",
        targetType: "community",
        targetId: community.id,
        communityId: community.id,
        metadata: {
          importedCount: toCreate.length,
          duplicateCount: result.duplicateCount,
        },
      }),
    }),
  ]);

  const geocoded = await geocodeImportedUnits(
    community,
    rowsWithIds.filter((row) => hasDistinctAddress(row)),
  );

  // Unresolved homes are an operational fact somebody has to act on, so they
  // are auditable rather than only visible in one admin's browser. Counts and
  // labels only — never the addresses that failed.
  if (geocoded.unresolvedLabels.length > 0) {
    await db.adminAuditLog.create({
      data: buildAuditEntry({
        actorUserId,
        action: "address_verification_failed",
        targetType: "community",
        targetId: community.id,
        communityId: community.id,
        metadata: {
          subject: "unit_import",
          unresolvedCount: geocoded.unresolvedLabels.length,
          resolvedCount: geocoded.geocodedCount,
        },
      }),
    });
  }

  return { ...result, committed: true, ...geocoded };
}

/**
 * How many address lookups run at once during an import.
 *
 * Deliberately small. Five hundred homes must not become five hundred
 * simultaneous provider calls: that is what gets an API key rate-limited, and
 * the import is a background operation whose latency nobody is watching.
 * Identical addresses across rows collapse in the geocoder's own in-flight
 * de-duplication, so a street of "same block" homes costs far fewer calls than
 * it has rows.
 */
const IMPORT_GEOCODE_CONCURRENCY = 4;

/**
 * Resolves imported homes' own addresses, in bounded batches.
 *
 * Never throws: an import that wrote its rows has succeeded. A home the
 * provider could not resolve is marked `needs_correction` and reported in the
 * result, so the admin can fix and re-run — which is safe, because re-running
 * the same file skips the labels that already exist.
 */
async function geocodeImportedUnits(
  community: { id: string },
  rows: ReadonlyArray<{
    id: string;
    label: string;
    addressLine1: string | null;
    locality: string | null;
    region: string | null;
    postalCode: string | null;
  }>,
): Promise<{ geocodedCount: number; unresolvedLabels: string[] }> {
  const unresolvedLabels: string[] = [];
  let geocodedCount = 0;

  for (let index = 0; index < rows.length; index += IMPORT_GEOCODE_CONCURRENCY) {
    const batch = rows.slice(index, index + IMPORT_GEOCODE_CONCURRENCY);
    const resolved = await Promise.all(
      batch.map(async (row) => ({
        row,
        data: await resolveUnitAddress(community, row),
      })),
    );
    await db.$transaction(
      resolved.map(({ row, data }) =>
        db.communityUnit.update({ where: { id: row.id }, data }),
      ),
    );
    for (const { row, data } of resolved) {
      if (data.addressVerificationStatus === "verified") geocodedCount += 1;
      else unresolvedLabels.push(row.label);
    }
  }

  return { geocodedCount, unresolvedLabels: unresolvedLabels.slice(0, 50) };
}
