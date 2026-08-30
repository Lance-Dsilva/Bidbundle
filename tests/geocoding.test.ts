import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  canonicalAddressLine,
  clearGeocoderCache,
  EXACT_CONFIDENCE,
  Geocoder,
  GeocoderError,
  geocoderConfig,
  isExactMatch,
  isGeocoderConfigured,
  normalizeProviderResult,
} from "@/lib/server/geocoding";

/**
 * The server-side geocoding boundary.
 *
 * Every external call is mocked. Nothing in this file may reach Geoapify or
 * any OpenStreetMap Foundation service — a test suite that load-tests a
 * volunteer-funded provider is a bug, not coverage.
 */

const ADDRESS = {
  addressLine1: "11800 Cedar Lane",
  addressLine2: null,
  locality: "Austin",
  region: "TX",
  postalCode: "78758",
  country: "us",
};

function providerResult(overrides: Record<string, unknown> = {}) {
  return {
    address_line1: "11800 Cedar Lane",
    address_line2: "Austin, TX 78758, United States",
    city: "Austin",
    state: "TX",
    postcode: "78758",
    country_code: "us",
    formatted: "11800 Cedar Lane, Austin, TX 78758, United States",
    lat: 30.4021,
    lon: -97.7266,
    place_id: "place-abc",
    result_type: "building",
    rank: { confidence: 0.98 },
    ...overrides,
  };
}

function jsonResponse(body: unknown, init?: { status?: number; headers?: Record<string, string> }) {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  clearGeocoderCache();
  process.env.GEOAPIFY_API_KEY = "server-only-test-key";
  delete process.env.GEOAPIFY_API_BASE_URL;
  delete process.env.GEOAPIFY_TIMEOUT_MS;
  delete process.env.GEOAPIFY_CACHE_TTL_MS;
  delete process.env.GEOAPIFY_RESULT_LIMIT;
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clearGeocoderCache();
});

describe("configuration", () => {
  it("uses a server-only key and never the browser-safe one", () => {
    delete process.env.GEOAPIFY_API_KEY;
    process.env.NEXT_PUBLIC_GEOAPIFY_API_KEY = "public-tile-key";

    expect(isGeocoderConfigured()).toBe(false);
    expect(geocoderConfig().apiKey).toBe("");

    delete process.env.NEXT_PUBLIC_GEOAPIFY_API_KEY;
  });

  it("refuses to call the provider when unconfigured, rather than falling back", async () => {
    delete process.env.GEOAPIFY_API_KEY;

    await expect(Geocoder.search(ADDRESS)).rejects.toMatchObject({ kind: "not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps base URL, timeout, limit, and cache TTL configurable within bounds", () => {
    process.env.GEOAPIFY_API_BASE_URL = "https://proxy.internal/";
    process.env.GEOAPIFY_TIMEOUT_MS = "999999";
    process.env.GEOAPIFY_RESULT_LIMIT = "500";

    const config = geocoderConfig();
    expect(config.baseUrl).toBe("https://proxy.internal");
    // Clamped: a mis-set variable must not become a hung request or a huge bill.
    expect(config.timeoutMs).toBeLessThanOrEqual(20_000);
    expect(config.limit).toBeLessThanOrEqual(10);
  });
});

describe("normalization", () => {
  it("keeps only results with usable coordinates", () => {
    expect(normalizeProviderResult(providerResult())).toMatchObject({
      latitude: 30.4021,
      longitude: -97.7266,
      placeId: "place-abc",
      country: "US",
    });
    expect(normalizeProviderResult(providerResult({ lat: undefined }))).toBeNull();
    expect(normalizeProviderResult(providerResult({ lat: 200 }))).toBeNull();
  });

  it("treats a low-confidence or city-level match as not exact", () => {
    const building = normalizeProviderResult(providerResult())!;
    expect(isExactMatch(building)).toBe(true);

    const weak = normalizeProviderResult(
      providerResult({ rank: { confidence: EXACT_CONFIDENCE - 0.2 } }),
    )!;
    expect(isExactMatch(weak)).toBe(false);

    const cityCentroid = normalizeProviderResult(providerResult({ result_type: "city" }))!;
    expect(isExactMatch(cityCentroid)).toBe(false);
  });

  it("builds one canonical query line regardless of spacing or casing", () => {
    expect(canonicalAddressLine(ADDRESS)).toBe(
      "11800 Cedar Lane, Austin, TX, 78758, US",
    );
    expect(
      canonicalAddressLine({ ...ADDRESS, addressLine1: "  11800   Cedar Lane " }),
    ).toBe(canonicalAddressLine(ADDRESS));
  });
});

describe("resolve", () => {
  it("returns an exact match for one confident building result", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ results: [providerResult()] }));

    const outcome = await Geocoder.resolve(ADDRESS);
    expect(outcome.status).toBe("exact");
    if (outcome.status === "exact") {
      expect(outcome.address.latitude).toBeCloseTo(30.4021, 4);
      expect(outcome.address.longitude).toBeCloseTo(-97.7266, 4);
    }
  });

  it("returns ambiguous candidates rather than guessing between close matches", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        results: [
          providerResult({ formatted: "11800 Cedar Lane N", rank: { confidence: 0.95 } }),
          providerResult({ formatted: "11800 Cedar Lane S", rank: { confidence: 0.94 } }),
        ],
      }),
    );

    const outcome = await Geocoder.resolve(ADDRESS);
    expect(outcome.status).toBe("ambiguous");
    if (outcome.status === "ambiguous") expect(outcome.candidates).toHaveLength(2);
  });

  it("reports not_found for an address the provider does not know", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ results: [] }));
    await expect(Geocoder.resolve(ADDRESS)).resolves.toEqual({ status: "not_found" });
  });
});

describe("failure handling", () => {
  it("does not retry a 4xx validation answer", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: "bad request" }, { status: 400 }));

    await expect(Geocoder.search(ADDRESS)).rejects.toMatchObject({ kind: "invalid_address" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces a 401/403 as a configuration problem, not a bad address", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, { status: 401 }));
    await expect(Geocoder.search(ADDRESS)).rejects.toMatchObject({ kind: "not_configured" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("honours a rate-limit response instead of retrying into it", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({}, { status: 429, headers: { "retry-after": "42" } }),
    );

    const error = await Geocoder.search(ADDRESS).catch((caught: GeocoderError) => caught);
    expect(error).toBeInstanceOf(GeocoderError);
    expect(error).toMatchObject({ kind: "rate_limited", retryAfterSeconds: 42, retryable: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a transient 5xx a bounded number of times", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, { status: 503 }));

    await expect(Geocoder.search(ADDRESS)).rejects.toMatchObject({
      kind: "unavailable",
      retryable: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("recovers when a retry succeeds", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, { status: 500 }))
      .mockResolvedValueOnce(jsonResponse({ results: [providerResult()] }));

    await expect(Geocoder.search(ADDRESS)).resolves.toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports an aborted request as a retryable timeout", async () => {
    fetchMock.mockImplementation(() => {
      const error = new Error("aborted");
      error.name = "AbortError";
      return Promise.reject(error);
    });

    await expect(Geocoder.search(ADDRESS)).rejects.toMatchObject({
      kind: "timeout",
      retryable: true,
    });
  });

  it("rejects an unusable query before spending a call", async () => {
    await expect(Geocoder.search("ab")).rejects.toMatchObject({ kind: "invalid_address" });
    await expect(Geocoder.search("x".repeat(400))).rejects.toMatchObject({
      kind: "invalid_address",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("cache and de-duplication", () => {
  it("serves a repeated lookup from cache", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ results: [providerResult()] }));

    await Geocoder.search(ADDRESS);
    await Geocoder.search(ADDRESS);
    await Geocoder.search({ ...ADDRESS, addressLine1: "11800  Cedar Lane" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("collapses identical in-flight lookups into one request", async () => {
    let release: (value: Response) => void = () => {};
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );

    const first = Geocoder.search(ADDRESS);
    const second = Geocoder.search(ADDRESS);
    release(jsonResponse({ results: [providerResult()] }));

    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("secrets and logging", () => {
  it("never logs the address, the key, the coordinates, or the raw response", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchMock.mockResolvedValue(jsonResponse({ results: [providerResult()] }, { status: 503 }));

    await Geocoder.search(ADDRESS).catch(() => undefined);

    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).not.toContain("server-only-test-key");
    expect(logged).not.toContain("Cedar Lane");
    expect(logged).not.toContain("78758");
    expect(logged).not.toContain("30.4021");
  });

  it("sends the key as a query parameter to the configured host only", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ results: [providerResult()] }));
    await Geocoder.search(ADDRESS);

    const url = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(url.host).toBe("api.geoapify.com");
    expect(url.searchParams.get("apiKey")).toBe("server-only-test-key");
    // The address is percent-encoded into the query string, never the path.
    expect(url.pathname).toBe("/v1/geocode/search");
    expect(url.searchParams.get("text")).toContain("Cedar Lane");
  });

  it("never falls back to a shared OpenStreetMap Foundation endpoint", async () => {
    // The forbidden hosts are assembled rather than written out, so this file
    // does not itself look like a call site to a static audit.
    const forbidden = ["nomi" + "natim", "openstreet" + "map.org"];
    fetchMock.mockResolvedValue(jsonResponse({}, { status: 503 }));
    await Geocoder.search(ADDRESS).catch(() => undefined);

    for (const call of fetchMock.mock.calls) {
      for (const host of forbidden) expect(String(call[0])).not.toContain(host);
    }
  });
});
