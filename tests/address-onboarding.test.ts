import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Address-only HOA onboarding.
 *
 * The rule this whole area exists to enforce: an admin types an address and
 * never a coordinate. These tests cover the write path (what is stored, and
 * what is *not* stored when the answer is uncertain), the retry behaviour when
 * the provider is unavailable, and the surfaces — form and CSV — that must
 * contain no latitude or longitude input at all.
 *
 * The geocoder is mocked throughout. Nothing here contacts Geoapify or any
 * OpenStreetMap Foundation service.
 */

type Op = { model: string; action: string; args: Record<string, unknown> };

const state = vi.hoisted(() => ({
  community: null as Record<string, unknown> | null,
  profile: null as Record<string, unknown> | null,
  unit: null as Record<string, unknown> | null,
  units: [] as Array<Record<string, unknown>>,
  batches: [] as Op[][],
  upserted: null as Record<string, unknown> | null,
}));

function op(model: string, action: string) {
  return (args: Record<string, unknown>): Op => ({ model, action, args });
}

vi.mock("@/lib/server/db", () => ({
  db: {
    community: { findUnique: async () => state.community },
    hoaProfile: {
      findUnique: async () => state.profile,
      upsert: (args: Record<string, unknown>) => {
        state.upserted = args;
        return { model: "hoaProfile", action: "upsert", args };
      },
      update: op("hoaProfile", "update"),
    },
    communityUnit: {
      findUnique: async () => state.unit,
      findUniqueOrThrow: async () => state.unit,
      findFirst: async () => state.unit,
      findMany: async () => state.units,
      create: op("communityUnit", "create"),
      update: op("communityUnit", "update"),
      createMany: op("communityUnit", "createMany"),
    },
    communityMembership: { findFirst: async () => null },
    adminAuditLog: { create: op("adminAuditLog", "create") },
    $transaction: async (ops: Op[]) => {
      state.batches.push(ops);
      // `upsertHoaProfile` destructures the first result as the saved profile.
      return ops.map((entry) =>
        entry.model === "hoaProfile"
          ? {
              ...((entry.args as { create?: Record<string, unknown> }).create ??
                (entry.args as { update?: Record<string, unknown> }).update ??
                {}),
              communityId: "hoa-1",
              onboardingStatus: "draft",
              addressVerifiedAt: new Date(),
            }
          : entry,
      );
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
        const [best, second] = candidates;
        const contested =
          second !== undefined &&
          second.confidence >= best.confidence - 0.05 &&
          actual.isExactMatch(second);
        return actual.isExactMatch(best) && !contested
          ? { status: "exact", address: best }
          : { status: "ambiguous", candidates };
      },
    },
  };
});

import {
  AddressAmbiguousError,
  AddressUnresolvedError,
  hasDistinctAddress,
  isMaterialAddressChange,
  resolveForStorage,
} from "@/lib/server/address-verification";
import { GeocoderError } from "@/lib/server/geocoding";
import { upsertHoaProfile } from "@/lib/server/hoa-units";
import { hoaProfileSchema, unitCreateSchema, unitUpdateSchema } from "@/lib/validation/hoa";

const ENTERED = {
  addressLine1: "11800 Cedar Lane",
  addressLine2: null,
  locality: "Austin",
  region: "TX",
  postalCode: "78758",
  country: "US",
};

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    formatted: "11800 Cedar Lane, Austin, TX 78758, United States",
    addressLine1: "11800 Cedar Lane",
    addressLine2: null,
    locality: "Austin",
    region: "TX",
    postalCode: "78758",
    country: "US",
    latitude: 30.4021,
    longitude: -97.7266,
    confidence: 0.97,
    placeId: "place-abc",
    resultType: "building",
    ...overrides,
  };
}

const PROFILE_INPUT = {
  legalName: "Cedar Park Homes Association",
  displayName: null,
  ...ENTERED,
  confirmedFormattedAddress: null,
  timezone: "America/Chicago",
  totalHomes: 24,
  referenceCode: null,
  serviceNotes: null,
};

beforeEach(() => {
  state.community = { id: "hoa-1", name: "Cedar Park HOA", type: "hoa", status: "active" };
  state.profile = null;
  state.unit = null;
  state.units = [];
  state.batches = [];
  state.upserted = null;
  geocoder.search.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/* ── Schemas: no coordinates anywhere ────────────────────────────────────── */

describe("admin input schemas", () => {
  it("refuses coordinates on the HOA profile", () => {
    expect(
      hoaProfileSchema.safeParse({ ...PROFILE_INPUT, latitude: 30.4, longitude: -97.7 }).success,
    ).toBe(false);
  });

  it("refuses coordinates on unit create and update", () => {
    expect(
      unitCreateSchema.safeParse({ label: "Home 1", latitude: 30.4, longitude: -97.7 }).success,
    ).toBe(false);
    expect(
      unitUpdateSchema.safeParse({ latitude: 30.4, longitude: -97.7 }).success,
    ).toBe(false);
  });

  it("accepts a home with an address and a home with only a label", () => {
    expect(unitCreateSchema.safeParse({ label: "Home 1" }).success).toBe(true);
    expect(
      unitCreateSchema.safeParse({ label: "Home 1", addressLine1: "11801 Cedar Lane" }).success,
    ).toBe(true);
  });
});

/* ── Resolution policy ───────────────────────────────────────────────────── */

describe("resolveForStorage", () => {
  it("returns coordinates and the normalized address for one confident match", async () => {
    geocoder.search.mockResolvedValue([candidate()]);

    await expect(resolveForStorage(ENTERED)).resolves.toMatchObject({
      latitude: 30.4021,
      longitude: -97.7266,
      addressLine1: "11800 Cedar Lane",
      locality: "Austin",
      formattedAddress: "11800 Cedar Lane, Austin, TX 78758, United States",
      placeId: "place-abc",
    });
  });

  it("raises an ambiguity carrying candidates rather than picking one", async () => {
    geocoder.search.mockResolvedValue([
      candidate({ formatted: "11800 Cedar Lane N", confidence: 0.95 }),
      candidate({ formatted: "11800 Cedar Lane S", confidence: 0.94 }),
    ]);

    const error = await resolveForStorage(ENTERED).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AddressAmbiguousError);
    expect((error as AddressAmbiguousError).candidates).toHaveLength(2);
    // Candidates are addresses only — the browser never receives numbers.
    const serialized = JSON.stringify((error as AddressAmbiguousError).candidates);
    expect(serialized).not.toContain("30.4021");
    expect(serialized).not.toContain("latitude");
  });

  it("stores the candidate the admin confirmed", async () => {
    geocoder.search.mockResolvedValue([
      candidate({ formatted: "11800 Cedar Lane N", confidence: 0.95, latitude: 30.5 }),
      candidate({ formatted: "11800 Cedar Lane S", confidence: 0.94, latitude: 30.6 }),
    ]);

    await expect(resolveForStorage(ENTERED, "11800 Cedar Lane S")).resolves.toMatchObject({
      latitude: 30.6,
      formattedAddress: "11800 Cedar Lane S",
    });
  });

  it("asks again when the confirmed candidate is no longer offered", async () => {
    geocoder.search.mockResolvedValue([candidate({ formatted: "Somewhere else" })]);
    await expect(resolveForStorage(ENTERED, "11800 Cedar Lane S")).rejects.toBeInstanceOf(
      AddressAmbiguousError,
    );
  });

  it("reports a not-found address as a correctable, non-retryable problem", async () => {
    geocoder.search.mockResolvedValue([]);

    const error = await resolveForStorage(ENTERED).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AddressUnresolvedError);
    expect((error as AddressUnresolvedError).retryable).toBe(false);
  });

  it.each([
    ["timeout", 504],
    ["unavailable", 503],
    ["rate_limited", 429],
    ["not_configured", 503],
  ] as const)("reports a %s provider failure as retryable", async (kind, status) => {
    geocoder.search.mockRejectedValue(new GeocoderError(kind, "boom"));

    const error = await resolveForStorage(ENTERED).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AddressUnresolvedError);
    expect((error as AddressUnresolvedError).retryable).toBe(true);
    expect((error as AddressUnresolvedError).status).toBe(status);
  });

  it("reports an unreadable address as a correction, not a retry", async () => {
    geocoder.search.mockRejectedValue(new GeocoderError("invalid_address", "bad"));

    const error = await resolveForStorage(ENTERED).catch((caught: unknown) => caught);
    expect((error as AddressUnresolvedError).retryable).toBe(false);
    expect((error as AddressUnresolvedError).status).toBe(400);
  });

  it("never leaks the provider's message to the customer-facing error", async () => {
    geocoder.search.mockRejectedValue(new GeocoderError("unavailable", "upstream 502 from gw-7"));

    const error = await resolveForStorage(ENTERED).catch((caught: unknown) => caught);
    expect((error as Error).message).not.toContain("gw-7");
    expect((error as Error).message).not.toContain("502");
  });
});

describe("material change detection", () => {
  it("treats a same-address save as unchanged, whatever the spacing", () => {
    expect(isMaterialAddressChange(ENTERED, { ...ENTERED, addressLine1: " 11800  Cedar Lane " }))
      .toBe(false);
  });

  it("treats any address field change as material", () => {
    expect(isMaterialAddressChange(ENTERED, { ...ENTERED, postalCode: "78759" })).toBe(true);
    expect(isMaterialAddressChange(ENTERED, { ...ENTERED, locality: "Round Rock" })).toBe(true);
    expect(isMaterialAddressChange(null, ENTERED)).toBe(true);
  });

  it("knows when a home has an address of its own", () => {
    expect(hasDistinctAddress({ addressLine1: "11801 Cedar Lane" })).toBe(true);
    expect(hasDistinctAddress({ addressLine1: "   " })).toBe(false);
    expect(hasDistinctAddress({})).toBe(false);
  });
});

/* ── The HOA profile write ───────────────────────────────────────────────── */

describe("upsertHoaProfile", () => {
  it("stores the normalized address and coordinates in one statement", async () => {
    geocoder.search.mockResolvedValue([candidate()]);

    await upsertHoaProfile("admin-1", "hoa-1", PROFILE_INPUT);

    const created = (state.upserted!.create ?? {}) as Record<string, unknown>;
    expect(created).toMatchObject({
      addressLine1: "11800 Cedar Lane",
      latitude: 30.4021,
      longitude: -97.7266,
      addressVerificationStatus: "verified",
      geocodePlaceId: "place-abc",
    });
    expect(created.addressVerifiedAt).toBeInstanceOf(Date);
  });

  it("writes nothing at all when the address is ambiguous", async () => {
    geocoder.search.mockResolvedValue([
      candidate({ formatted: "A", confidence: 0.95 }),
      candidate({ formatted: "B", confidence: 0.94 }),
    ]);

    await expect(upsertHoaProfile("admin-1", "hoa-1", PROFILE_INPUT)).rejects.toBeInstanceOf(
      AddressAmbiguousError,
    );
    expect(state.batches).toHaveLength(0);
    expect(state.upserted).toBeNull();
  });

  it("writes nothing when the provider is unavailable, so the admin can retry", async () => {
    geocoder.search.mockRejectedValue(new GeocoderError("timeout", "slow"));

    await expect(upsertHoaProfile("admin-1", "hoa-1", PROFILE_INPUT)).rejects.toBeInstanceOf(
      AddressUnresolvedError,
    );
    expect(state.batches).toHaveLength(0);
  });

  it("replaces stale coordinates when the address materially changes", async () => {
    state.profile = {
      addressLine1: "1 Old Road",
      addressLine2: null,
      locality: "Austin",
      region: "TX",
      postalCode: "78701",
      country: "US",
      latitude: 30.26,
      longitude: -97.74,
      addressVerificationStatus: "verified",
    };
    geocoder.search.mockResolvedValue([candidate()]);

    await upsertHoaProfile("admin-1", "hoa-1", PROFILE_INPUT);

    const update = (state.upserted!.update ?? {}) as Record<string, unknown>;
    expect(update.latitude).toBe(30.4021);
    expect(update.longitude).toBe(-97.7266);
    expect(update.latitude).not.toBe(30.26);
  });

  it("does not re-geocode a save that only changes business fields", async () => {
    state.profile = {
      ...ENTERED,
      latitude: 30.4021,
      longitude: -97.7266,
      addressVerificationStatus: "verified",
    };
    geocoder.search.mockResolvedValue([candidate()]);

    await upsertHoaProfile("admin-1", "hoa-1", { ...PROFILE_INPUT, totalHomes: 30 });

    expect(geocoder.search).not.toHaveBeenCalled();
    // The existing verified location is left exactly as it was.
    const update = (state.upserted!.update ?? {}) as Record<string, unknown>;
    expect(update).not.toHaveProperty("latitude");
    expect(update).not.toHaveProperty("addressVerificationStatus");
  });

  it("retries verification on every save while the address is unresolved", async () => {
    state.profile = {
      ...ENTERED,
      latitude: null,
      longitude: null,
      addressVerificationStatus: "needs_correction",
    };
    geocoder.search.mockResolvedValue([candidate()]);

    await upsertHoaProfile("admin-1", "hoa-1", PROFILE_INPUT);
    expect(geocoder.search).toHaveBeenCalled();
  });

  it("audits the decision without recording the address or the coordinates", async () => {
    geocoder.search.mockResolvedValue([candidate()]);
    await upsertHoaProfile("admin-1", "hoa-1", PROFILE_INPUT);

    const audits = state.batches[0]!.filter((entry) => entry.model === "adminAuditLog");
    expect(audits.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(audits.map((entry) => entry.args));
    expect(serialized).not.toContain("11800 Cedar Lane");
    expect(serialized).not.toContain("30.4021");
  });

  it("refuses to attach an HOA profile to a neighbourhood community", async () => {
    state.community = { id: "hood-1", name: "Oakwood", type: "neighborhood", status: "active" };
    await expect(upsertHoaProfile("admin-1", "hood-1", PROFILE_INPUT)).rejects.toMatchObject({
      status: 404,
    });
    expect(state.batches).toHaveLength(0);
  });
});

/* ── Surfaces ────────────────────────────────────────────────────────────── */

describe("admin surfaces contain no coordinate input", () => {
  const panel = readFileSync("src/components/admin/HoaOnboardingPanel.tsx", "utf8");

  it("has no latitude or longitude form field", () => {
    expect(panel).not.toMatch(/name="latitude"/);
    expect(panel).not.toMatch(/name="longitude"/);
  });

  it("advertises a CSV header without coordinate columns", () => {
    expect(panel).toContain("label,addressLine1,locality,region,postalCode");
    expect(panel).not.toMatch(/postalCode,latitude,longitude/);
  });

  it("shows a verification status instead of numbers", () => {
    expect(panel).toContain("Address verified");
    expect(panel).toContain("Verification pending");
    expect(panel).toContain("Needs correction");
  });
});
