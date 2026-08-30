import { readFileSync } from "node:fs";

import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A neighbourhood's centre is an address, not two decimals.
 *
 * Radius geometry stays admin-owned — Bundleen staff decide how wide a
 * neighbourhood is — but the centre point is resolved server-side from a
 * postal address, through the same geocoder HOA onboarding uses. Retyping a
 * latitude to move a live neighbourhood silently changes who the placement
 * algorithm matches, which is exactly the class of error this removes.
 */

type Op = { model: string; action: string; args: Record<string, unknown> };

const state = vi.hoisted(() => ({
  existing: null as Record<string, unknown> | null,
  batches: [] as Op[][],
}));

function op(model: string, action: string) {
  return (args: Record<string, unknown>): Op => ({ model, action, args });
}

vi.mock("@/lib/server/db", () => ({
  db: {
    community: {
      create: op("community", "create"),
      update: op("community", "update"),
      findUnique: async () => state.existing,
      findFirst: async () => state.existing,
    },
    adminAuditLog: { create: op("adminAuditLog", "create") },
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

import { AddressUnresolvedError } from "@/lib/server/address-verification";
import { createCommunity, updateCommunity } from "@/lib/server/communities";
import { communityCreateSchema, communityUpdateSchema } from "@/lib/validation/community";

const CENTRE = {
  addressLine1: "11800 Cedar Lane",
  locality: "Austin",
  region: "TX",
  postalCode: "78758",
  country: "US",
};

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    formatted: "11800 Cedar Lane, Austin, TX 78758",
    addressLine1: "11800 Cedar Lane",
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

const actor = { id: "admin-1", email: "admin@bundleen.test" } as never;

beforeEach(() => {
  state.existing = {
    id: "hood-1",
    name: "Oakwood Heights",
    type: "neighborhood",
    status: "active",
    centerLatitude: 30.1,
    centerLongitude: -97.1,
    radiusMiles: 4,
  };
  state.batches = [];
  geocoder.search.mockReset();
  geocoder.search.mockResolvedValue([candidate()]);
});

describe("validation", () => {
  it("accepts a neighbourhood defined by a centre address alone", () => {
    const parsed = communityCreateSchema.safeParse({
      name: "Oakwood Heights",
      type: "neighborhood",
      centerAddress: CENTRE,
    });
    expect(parsed.success).toBe(true);
  });

  it("still requires *some* centre for a neighbourhood", () => {
    const parsed = communityCreateSchema.safeParse({
      name: "Oakwood Heights",
      type: "neighborhood",
    });
    expect(parsed.success).toBe(false);
  });

  it("does not require a centre for an HOA", () => {
    expect(
      communityCreateSchema.safeParse({ name: "Cedar Park HOA", type: "hoa" }).success,
    ).toBe(true);
  });

  it("accepts a centre address on update", () => {
    expect(communityUpdateSchema.safeParse({ centerAddress: CENTRE }).success).toBe(true);
  });
});

describe("createCommunity", () => {
  it("resolves the centre address into stored coordinates", async () => {
    await createCommunity(actor, {
      name: "Oakwood Heights",
      type: "neighborhood",
      centerAddress: CENTRE,
      centerLatitude: null,
      centerLongitude: null,
      radiusMiles: 4,
    });

    const create = state.batches[0]!.find((entry) => entry.model === "community")!;
    const data = create.args.data as Record<string, unknown>;
    expect(data.centerLatitude).toBe(30.4021);
    expect(data.centerLongitude).toBe(-97.7266);
    // The address itself is not a Community column and must not be written.
    expect(data).not.toHaveProperty("centerAddress");
  });

  it("keeps an explicit pair when no address is supplied", async () => {
    await createCommunity(actor, {
      name: "Oakwood Heights",
      type: "neighborhood",
      centerLatitude: 30.1,
      centerLongitude: -97.1,
      radiusMiles: 4,
    });

    const create = state.batches[0]!.find((entry) => entry.model === "community")!;
    expect((create.args.data as Record<string, unknown>).centerLatitude).toBe(30.1);
    expect(geocoder.search).not.toHaveBeenCalled();
  });

  it("writes nothing when the centre address cannot be resolved", async () => {
    geocoder.search.mockResolvedValue([]);

    await expect(
      createCommunity(actor, {
        name: "Oakwood Heights",
        type: "neighborhood",
        centerAddress: CENTRE,
        centerLatitude: null,
        centerLongitude: null,
        radiusMiles: 4,
      }),
    ).rejects.toBeInstanceOf(AddressUnresolvedError);
    expect(state.batches).toHaveLength(0);
  });
});

describe("updateCommunity", () => {
  it("moves the centre by re-resolving the new address", async () => {
    geocoder.search.mockResolvedValue([candidate({ latitude: 30.5, longitude: -97.9 })]);

    await updateCommunity(actor, "hood-1", { centerAddress: CENTRE, radiusMiles: 4 });

    const update = state.batches[0]!.find((entry) => entry.model === "community")!;
    const data = update.args.data as Record<string, unknown>;
    expect(data.centerLatitude).toBe(30.5);
    expect(data.centerLongitude).toBe(-97.9);
    expect(data).not.toHaveProperty("centerAddress");
  });

  it("leaves a resolved centre untouched when only the radius changes", async () => {
    await updateCommunity(actor, "hood-1", { radiusMiles: 6 });

    const update = state.batches[0]!.find((entry) => entry.model === "community")!;
    const data = update.args.data as Record<string, unknown>;
    expect(data).not.toHaveProperty("centerLatitude");
    expect(geocoder.search).not.toHaveBeenCalled();
  });

  it("writes nothing when the provider is unavailable", async () => {
    const { GeocoderError } = await import("@/lib/server/geocoding");
    geocoder.search.mockRejectedValue(new GeocoderError("timeout", "slow"));

    await expect(
      updateCommunity(actor, "hood-1", { centerAddress: CENTRE }),
    ).rejects.toBeInstanceOf(AddressUnresolvedError);
    expect(state.batches).toHaveLength(0);
  });
});

describe("admin surfaces", () => {
  it("offers no latitude or longitude input for a neighbourhood centre", () => {
    for (const path of [
      "src/components/admin/CommunityCreateForm.tsx",
      "src/components/admin/CommunityDetailWorkspace.tsx",
      "src/components/admin/CentreAddressFields.tsx",
    ]) {
      const source = readFileSync(path, "utf8");
      expect(source).not.toContain("Centre latitude");
      expect(source).not.toContain("Centre longitude");
      expect(source).not.toMatch(/setLatitude|setLongitude/);
    }
  });

  it("asks for a street address instead", () => {
    const fields = readFileSync("src/components/admin/CentreAddressFields.tsx", "utf8");
    expect(fields).toContain("Centre address");
    expect(fields).toContain("Street address");
  });
});
