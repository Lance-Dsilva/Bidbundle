import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Unit inventory: address-only CSV import, bounded background geocoding, and
 * the readiness rule that keeps unrouteable homes out of awarded work.
 *
 * The import is deliberately two-phase — rows first, lookups after — so a
 * provider outage halfway through leaves a complete roster with visible,
 * retryable gaps rather than a half-imported file.
 */

type Op = { model: string; action: string; args: Record<string, unknown> };

const state = vi.hoisted(() => ({
  community: null as Record<string, unknown> | null,
  existingUnits: [] as Array<Record<string, unknown>>,
  profile: null as Record<string, unknown> | null,
  batches: [] as Op[][],
  /** Audit rows written outside a `$transaction` batch. */
  auditWrites: [] as Op[],
}));

function op(model: string, action: string) {
  return (args: Record<string, unknown>): Op => ({ model, action, args });
}

vi.mock("@/lib/server/db", () => ({
  db: {
    community: { findUnique: async () => state.community },
    hoaProfile: { findUnique: async () => state.profile },
    communityUnit: {
      findMany: async () => state.existingUnits,
      findUnique: async () => null,
      findUniqueOrThrow: async () => state.existingUnits[0] ?? null,
      create: op("communityUnit", "create"),
      createMany: op("communityUnit", "createMany"),
      update: op("communityUnit", "update"),
    },
    adminAuditLog: {
      create: (args: Record<string, unknown>) => {
        const entry = { model: "adminAuditLog", action: "create", args };
        state.auditWrites.push(entry);
        return entry;
      },
    },
    $transaction: async (ops: Op[]) => {
      state.batches.push(ops);
      return ops;
    },
  },
}));

const geocoder = vi.hoisted(() => ({ search: vi.fn() }));

vi.mock("@/lib/server/geocoding", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/geocoding")>();
  return {
    ...actual,
    Geocoder: {
      search: geocoder.search,
      resolve: async (address: unknown) => {
        const candidates = await geocoder.search(address);
        if (candidates.length === 0) return { status: "not_found" };
        return actual.isExactMatch(candidates[0])
          ? { status: "exact", address: candidates[0] }
          : { status: "ambiguous", candidates };
      },
    },
  };
});

import { importUnits } from "@/lib/server/hoa-units";

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    formatted: "11801 Cedar Lane, Austin, TX 78758",
    addressLine1: "11801 Cedar Lane",
    addressLine2: null,
    locality: "Austin",
    region: "TX",
    postalCode: "78758",
    country: "US",
    latitude: 30.4021,
    longitude: -97.7266,
    confidence: 0.97,
    placeId: "place-1",
    resultType: "building",
    ...overrides,
  };
}

beforeEach(() => {
  state.community = { id: "hoa-1", name: "Cedar Park HOA", type: "hoa", status: "active" };
  state.existingUnits = [];
  state.profile = {
    locality: "Austin",
    region: "TX",
    postalCode: "78758",
    country: "US",
    latitude: 30.402,
    longitude: -97.7266,
    addressVerificationStatus: "verified",
  };
  state.batches = [];
  state.auditWrites = [];
  geocoder.search.mockReset();
  geocoder.search.mockResolvedValue([candidate()]);
});

describe("CSV header", () => {
  it("refuses a file that still carries coordinate columns", async () => {
    await expect(
      importUnits("admin-1", "hoa-1", {
        csv: "label,addressLine1,latitude,longitude\nHome 1,11801 Cedar Lane,30.4,-97.7",
        commit: false,
      }),
    ).rejects.toThrow(/Remove the latitude and longitude columns/);
  });

  it("accepts labels and addresses", async () => {
    const result = await importUnits("admin-1", "hoa-1", {
      csv: "label,addressLine1,locality,region,postalCode\nHome 1,11801 Cedar Lane,Austin,TX,78758",
      commit: false,
    });
    expect(result.createCount).toBe(1);
    expect(result.invalidCount).toBe(0);
  });

  it("names the expected header when the first column is wrong", async () => {
    await expect(
      importUnits("admin-1", "hoa-1", { csv: "address\n11801 Cedar Lane", commit: false }),
    ).rejects.toThrow(/label,addressLine1,locality,region,postalCode/);
  });
});

describe("dry run", () => {
  it("writes nothing and makes no geocoding call", async () => {
    const result = await importUnits("admin-1", "hoa-1", {
      csv: "label,addressLine1\nHome 1,11801 Cedar Lane\nHome 2,11803 Cedar Lane",
      commit: false,
    });

    expect(result.committed).toBe(false);
    expect(result.createCount).toBe(2);
    expect(state.batches).toHaveLength(0);
    expect(geocoder.search).not.toHaveBeenCalled();
  });

  it("reports duplicates in the file and rows already on the roster", async () => {
    state.existingUnits = [{ label: "Home 1" }];

    const result = await importUnits("admin-1", "hoa-1", {
      csv: "label,addressLine1\nHome 1,a\nHome 2,b\nHome 2,c\n,d",
      commit: false,
    });

    expect(result.duplicateCount).toBe(2);
    expect(result.invalidCount).toBe(1);
    expect(result.createCount).toBe(1);
  });
});

describe("commit", () => {
  it("writes the rows first, then resolves each distinct address", async () => {
    const result = await importUnits("admin-1", "hoa-1", {
      csv: "label,addressLine1\nHome 1,11801 Cedar Lane\nHome 2,11803 Cedar Lane",
      commit: true,
    });

    expect(result.committed).toBe(true);
    expect(result.geocodedCount).toBe(2);
    expect(result.unresolvedLabels).toEqual([]);

    const created = state.batches[0]!.find((entry) => entry.action === "createMany")!;
    const rows = created.args.data as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    // Rows land unverified and are resolved afterwards.
    for (const row of rows) expect(row.addressVerificationStatus).toBe("pending");
  });

  it("never geocodes a home that inherits the HOA address", async () => {
    await importUnits("admin-1", "hoa-1", {
      csv: "label\nHome 1\nHome 2\nHome 3",
      commit: true,
    });
    expect(geocoder.search).not.toHaveBeenCalled();
  });

  it("keeps the roster and marks the failures when a lookup cannot be resolved", async () => {
    geocoder.search.mockImplementation(async (address: { addressLine1?: string } | string) => {
      const line = typeof address === "string" ? address : (address.addressLine1 ?? "");
      if (line.includes("11803")) return [];
      return [candidate()];
    });

    const result = await importUnits("admin-1", "hoa-1", {
      csv: "label,addressLine1\nHome 1,11801 Cedar Lane\nHome 2,11803 Cedar Lane",
      commit: true,
    });

    expect(result.committed).toBe(true);
    expect(result.geocodedCount).toBe(1);
    expect(result.unresolvedLabels).toEqual(["Home 2"]);

    // Unresolved homes are auditable, by count — never by address.
    const audit = state.batches
      .flat()
      .concat(state.auditWrites)
      .find(
        (entry) =>
          entry.model === "adminAuditLog" &&
          JSON.stringify(entry.args).includes("address_verification_failed"),
      );
    expect(audit).toBeDefined();
    const serialized = JSON.stringify(audit!.args);
    expect(serialized).toContain("unresolvedCount");
    expect(serialized).not.toContain("11803 Cedar Lane");

    const updates = state.batches
      .flat()
      .filter((entry) => entry.model === "communityUnit" && entry.action === "update");
    const statuses = updates.map(
      (entry) => (entry.args.data as Record<string, unknown>).addressVerificationStatus,
    );
    expect(statuses).toContain("verified");
    expect(statuses).toContain("needs_correction");
  });

  it("stores no coordinates for a home it could not resolve", async () => {
    geocoder.search.mockResolvedValue([]);

    await importUnits("admin-1", "hoa-1", {
      csv: "label,addressLine1\nHome 1,Nowhere At All",
      commit: true,
    });

    const update = state.batches
      .flat()
      .find((entry) => entry.model === "communityUnit" && entry.action === "update")!;
    const data = update.args.data as Record<string, unknown>;
    expect(data.latitude).toBeNull();
    expect(data.longitude).toBeNull();
  });

  it("resolves in bounded batches rather than all at once", async () => {
    let concurrent = 0;
    let peak = 0;
    geocoder.search.mockImplementation(async () => {
      concurrent += 1;
      peak = Math.max(peak, concurrent);
      await new Promise((resolve) => setTimeout(resolve, 1));
      concurrent -= 1;
      return [candidate()];
    });

    const rows = Array.from({ length: 20 }, (_, index) => `Home ${index},${index} Cedar Lane`);
    await importUnits("admin-1", "hoa-1", {
      csv: ["label,addressLine1", ...rows].join("\n"),
      commit: true,
    });

    // Every home was looked up. (The real module caches within one query, so
    // a production run makes one provider round trip per distinct address;
    // this mock has no cache, which is why call *count* is not the assertion.)
    const queried = new Set(
      geocoder.search.mock.calls.map(
        (call) => (call[0] as { addressLine1?: string }).addressLine1,
      ),
    );
    expect(queried.size).toBe(20);
    // The whole point: twenty homes must not become twenty simultaneous calls.
    expect(peak).toBeLessThanOrEqual(4);
  });

  it("is idempotent: re-running the same file adds nothing", async () => {
    state.existingUnits = [{ label: "Home 1" }, { label: "Home 2" }];

    const result = await importUnits("admin-1", "hoa-1", {
      csv: "label,addressLine1\nHome 1,11801 Cedar Lane\nHome 2,11803 Cedar Lane",
      commit: true,
    });

    expect(result.createCount).toBe(0);
    expect(result.duplicateCount).toBe(2);
    expect(state.batches).toHaveLength(0);
  });
});
