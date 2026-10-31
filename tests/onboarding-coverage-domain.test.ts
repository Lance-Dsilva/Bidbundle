import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock("@/lib/server/db", () => ({ db: { community: { findMany: state.findMany } } }));
import { getOnboardingCoverage } from "@/lib/server/onboarding-coverage";
import { distanceMiles } from "@/lib/geo";
import { MAX_HOMEOWNERS_PER_NEIGHBORHOOD } from "@/lib/validation/profile";
const point = { latitude: 30.4, longitude: -97.7 };
function circle(overrides: Record<string, unknown> = {}) { return { id: "private-community-id", centerLatitude: point.latitude, centerLongitude: point.longitude, radiusMiles: 3, _count: { memberships: 0 }, ...overrides }; }
beforeEach(() => { state.findMany.mockReset().mockResolvedValue([]); });
describe("anonymous advisory coverage shares actual placement geometry and capacity", () => {
  it("returns unavailable with no currently eligible existing circle", async () => { await expect(getOnboardingCoverage(point)).resolves.toBe("unavailable"); });
  it("queries only active neighbourhoods and counts both active and pending places", async () => {
    state.findMany.mockResolvedValue([circle()]); await expect(getOnboardingCoverage(point)).resolves.toBe("available");
    expect(state.findMany).toHaveBeenCalledWith({ where: { type: "neighborhood", status: "active" }, select: { id: true, centerLatitude: true, centerLongitude: true, radiusMiles: true, _count: { select: { memberships: { where: { status: { in: ["active", "pending"] } } } } } } });
    // The public return contains no identifier, name, coordinates or counts.
    expect(await getOnboardingCoverage(point)).toBe("available");
  });
  it.each([MAX_HOMEOWNERS_PER_NEIGHBORHOOD, MAX_HOMEOWNERS_PER_NEIGHBORHOOD + 1])("excludes a circle whose active+pending count is %s", async (memberships) => { state.findMany.mockResolvedValue([circle({ _count: { memberships } })]); await expect(getOnboardingCoverage(point)).resolves.toBe("unavailable"); });
  it("accepts the last unreserved place and falls back from a full nearer circle", async () => {
    state.findMany.mockResolvedValue([circle({ id: "full-nearest", _count: { memberships: MAX_HOMEOWNERS_PER_NEIGHBORHOOD } }), circle({ id: "room-farther", centerLatitude: 30.41, _count: { memberships: MAX_HOMEOWNERS_PER_NEIGHBORHOOD - 1 } })]); await expect(getOnboardingCoverage(point)).resolves.toBe("available");
  });
  it.each([{ centerLatitude: null }, { centerLongitude: null }, { radiusMiles: null }])("does not invent coverage for missing geometry: %j", async (invalid) => { state.findMany.mockResolvedValue([circle(invalid)]); await expect(getOnboardingCoverage(point)).resolves.toBe("unavailable"); });
  it("uses the circular boundary rather than a rectangular approximation", async () => {
    const edge = { latitude: 30.45, longitude: -97.65 }; const distance = distanceMiles(point, edge);
    state.findMany.mockResolvedValue([circle({ radiusMiles: distance - 0.0001 })]); await expect(getOnboardingCoverage(edge)).resolves.toBe("unavailable");
    state.findMany.mockResolvedValue([circle({ radiusMiles: distance })]); await expect(getOnboardingCoverage(edge)).resolves.toBe("available");
  });
  it("handles a circle across the antimeridian using real Haversine distance", async () => {
    state.findMany.mockResolvedValue([circle({ centerLatitude: 0, centerLongitude: 179.99, radiusMiles: 2 })]); await expect(getOnboardingCoverage({ latitude: 0, longitude: -179.99 })).resolves.toBe("available");
  });
  it("propagates a database outage instead of calling it unavailable geographic coverage", async () => { state.findMany.mockRejectedValue(new Error("database offline")); await expect(getOnboardingCoverage(point)).rejects.toThrow("database offline"); });
});
