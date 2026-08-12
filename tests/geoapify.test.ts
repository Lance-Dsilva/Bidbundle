import { describe, expect, it } from "vitest";

import { normalizeGeoapifyResult } from "@/lib/geoapify";

describe("normalizeGeoapifyResult", () => {
  it("keeps the canonical address, coordinates, and closest neighborhood label", () => {
    expect(
      normalizeGeoapifyResult({
        address_line1: "38 Upper Montagu Street",
        city: "London",
        country: "United Kingdom",
        formatted: "38 Upper Montagu Street, London W1H 1LJ, United Kingdom",
        lat: 51.519,
        lon: -0.16,
        postcode: "W1H 1LJ",
        suburb: "Marylebone",
      }),
    ).toMatchObject({
      formatted: "38 Upper Montagu Street, London W1H 1LJ, United Kingdom",
      latitude: 51.519,
      longitude: -0.16,
      neighborhood: "Marylebone",
    });
  });

  it("rejects results without usable coordinates", () => {
    expect(normalizeGeoapifyResult({ formatted: "Unknown place", lat: 10 })).toBeNull();
  });

  it("falls back to the city when no smaller neighborhood is returned", () => {
    expect(
      normalizeGeoapifyResult({ formatted: "Austin, TX", lat: 30.2672, lon: -97.7431, city: "Austin" }),
    ).toMatchObject({ neighborhood: "Austin" });
  });
});
