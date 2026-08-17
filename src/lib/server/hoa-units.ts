import "server-only";

import { randomUUID } from "node:crypto";

import type {
  HoaProfileSummary,
  UnitImportPreviewRow,
  UnitImportResult,
  UnitSummary,
} from "@/lib/hoa-types";
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
    latitude: row.latitude,
    longitude: row.longitude,
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

/** Bundleen admin creates or updates the HOA's legal/onboarding detail. */
export async function upsertHoaProfile(
  actorUserId: string,
  communityId: string,
  input: HoaProfileInput,
): Promise<HoaProfileSummary> {
  const community = await requireHoaCommunity(communityId);
  const profileId = randomUUID();
  const data = {
    legalName: input.legalName,
    displayName: input.displayName,
    addressLine1: input.addressLine1,
    addressLine2: input.addressLine2,
    locality: input.locality,
    region: input.region,
    postalCode: input.postalCode,
    country: input.country.toUpperCase(),
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    timezone: input.timezone,
    totalHomes: input.totalHomes,
    referenceCode: input.referenceCode,
    serviceNotes: input.serviceNotes,
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
        metadata: { changedFields: Object.keys(data) },
      }),
    }),
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

function serializeUnit(row: UnitRow): UnitSummary {
  return {
    id: row.id,
    label: row.label,
    addressLine1: row.addressLine1,
    locality: row.locality,
    region: row.region,
    postalCode: row.postalCode,
    latitude: row.latitude,
    longitude: row.longitude,
    occupancyStatus: row.occupancyStatus,
    accessNotes: row.accessNotes,
    residentName: row.memberships[0]?.user.fullName ?? null,
    residentEmail: row.memberships[0]?.user.email ?? null,
    pendingInviteEmail: row.invitations[0]?.email ?? null,
  };
}

export async function listUnits(communityId: string): Promise<UnitSummary[]> {
  await requireHoaCommunity(communityId);
  const rows = await db.communityUnit.findMany({
    where: { communityId },
    orderBy: { label: "asc" },
    select: unitListSelect,
  });
  return rows.map(serializeUnit);
}

export async function createUnit(
  actorUserId: string,
  communityId: string,
  input: UnitCreateInput,
): Promise<UnitSummary> {
  const community = await requireHoaCommunity(communityId);
  const unitId = randomUUID();

  try {
    await db.$transaction([
      db.communityUnit.create({
        data: {
          id: unitId,
          communityId: community.id,
          label: input.label,
          addressLine1: input.addressLine1,
          locality: input.locality,
          region: input.region,
          postalCode: input.postalCode,
          latitude: input.latitude ?? null,
          longitude: input.longitude ?? null,
          accessNotes: input.accessNotes,
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

  const created = await db.communityUnit.findUniqueOrThrow({
    where: { id: unitId },
    select: unitListSelect,
  });
  return serializeUnit(created);
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

  const data = {
    ...(input.label !== undefined ? { label: input.label } : {}),
    ...(input.addressLine1 !== undefined ? { addressLine1: input.addressLine1 } : {}),
    ...(input.locality !== undefined ? { locality: input.locality } : {}),
    ...(input.region !== undefined ? { region: input.region } : {}),
    ...(input.postalCode !== undefined ? { postalCode: input.postalCode } : {}),
    ...(input.latitude !== undefined ? { latitude: input.latitude } : {}),
    ...(input.longitude !== undefined ? { longitude: input.longitude } : {}),
    ...(input.accessNotes !== undefined ? { accessNotes: input.accessNotes } : {}),
    ...(input.occupancyStatus !== undefined ? { occupancyStatus: input.occupancyStatus } : {}),
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

  const updated = await db.communityUnit.findUniqueOrThrow({
    where: { id: unitId },
    select: unitListSelect,
  });
  return serializeUnit(updated);
}

/* ── CSV import ──────────────────────────────────────────────────────────── */

const IMPORT_HEADER = [
  "label",
  "addressline1",
  "locality",
  "region",
  "postalcode",
  "latitude",
  "longitude",
] as const;

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
  latitude: number | null;
  longitude: number | null;
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
      headerProblem: 'The first column must be "label". Expected header: label,addressLine1,locality,region,postalCode,latitude,longitude',
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
    const latitudeText = cell("latitude");
    const longitudeText = cell("longitude");
    const latitude = latitudeText === null ? null : Number(latitudeText);
    const longitude = longitudeText === null ? null : Number(longitudeText);

    let problem: string | null = null;
    if (!label) problem = "Missing label.";
    else if (label.length > MAX_UNIT_LABEL_LENGTH) problem = "Label is too long.";
    else if (latitude !== null && (!Number.isFinite(latitude) || Math.abs(latitude) > 90)) {
      problem = "Latitude is not a valid coordinate.";
    } else if (longitude !== null && (!Number.isFinite(longitude) || Math.abs(longitude) > 180)) {
      problem = "Longitude is not a valid coordinate.";
    } else if ((latitude === null) !== (longitude === null)) {
      problem = "Provide both latitude and longitude, or neither.";
    }

    rows.push({
      line: lineNumber + 1,
      label,
      addressLine1: cell("addressline1"),
      locality: cell("locality"),
      region: cell("region"),
      postalCode: cell("postalcode"),
      latitude: problem ? null : latitude,
      longitude: problem ? null : longitude,
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

  if (!input.commit || toCreate.length === 0) return result;

  await db.$transaction([
    db.communityUnit.createMany({
      data: toCreate.map((row) => ({
        id: randomUUID(),
        communityId: community.id,
        label: row.label,
        addressLine1: row.addressLine1,
        locality: row.locality,
        region: row.region,
        postalCode: row.postalCode,
        latitude: row.latitude,
        longitude: row.longitude,
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

  return { ...result, committed: true };
}
