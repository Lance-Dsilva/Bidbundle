import "server-only";

/**
 * The server-side geocoding boundary.
 *
 * Admins type a postal address. Bundleen resolves the coordinates. This module
 * is the only place in the application that talks to a geocoding provider with
 * a privileged key, and the only place that knows what Geoapify's JSON looks
 * like — everything above it sees {@link NormalizedAddress} and nothing else.
 *
 * Why it is shaped this way:
 *
 * - **The key never reaches the browser.** `GEOAPIFY_API_KEY` has no
 *   `NEXT_PUBLIC_` prefix, so Next.js will not inline it into a client bundle.
 *   The existing browser-safe `NEXT_PUBLIC_GEOAPIFY_API_KEY` used for map
 *   tiles and the homeowner's own address search stays separate and should be
 *   domain-restricted in the Geoapify dashboard; the two are not
 *   interchangeable and this module never falls back to the public one.
 * - **No silent fallback.** If Geoapify is unconfigured or unavailable the
 *   caller is told so and the address stays unverified. Falling back to the
 *   OpenStreetMap Foundation's public geocoding service would put background
 *   admin lookups onto a shared, volunteer-funded endpoint, which its usage
 *   policy forbids. This module has exactly one provider host, taken from
 *   configuration, and no second code path that could reach another.
 * - **Failures are honest.** A 4xx is a bad address or a bad key and is never
 *   retried. Only transport failures, timeouts, and 5xx are retried, at most
 *   twice, and a `429` is surfaced with its `Retry-After` rather than hammered.
 * - **Nothing sensitive is logged.** Log lines carry the failure kind, the HTTP
 *   status, and an opaque hash of the query — never the address, the key, the
 *   coordinates, or the provider's response body.
 *
 * Attribution and retention: Geoapify's results are OpenStreetMap-derived and
 * require attribution wherever they are displayed (the map components already
 * carry it). Caching below is short-lived and in-process — it is a
 * de-duplication window for one deployment's own repeated lookups, not a
 * derived database of provider results.
 */

import { createHash } from "node:crypto";

/* ── Configuration ───────────────────────────────────────────────────────── */

const DEFAULT_BASE_URL = "https://api.geoapify.com";
const DEFAULT_TIMEOUT_MS = 6_000;
const DEFAULT_CACHE_TTL_MS = 10 * 60_000;
const DEFAULT_LIMIT = 5;

/** Hard ceilings, so a mis-set environment variable cannot become an outage. */
const MAX_LIMIT = 10;
const MAX_TIMEOUT_MS = 20_000;
const MAX_CACHE_ENTRIES = 500;
const MAX_TRANSIENT_ATTEMPTS = 3;

function positiveInt(raw: string | undefined, fallback: number, ceiling: number): number {
  const parsed = Number(raw?.trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), ceiling);
}

export type GeocoderConfig = {
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
  cacheTtlMs: number;
  limit: number;
};

/**
 * Read fresh on every call rather than frozen at module load: a serverless
 * instance that starts before the key is present must pick it up on the next
 * invocation, and tests set the variables per case.
 */
export function geocoderConfig(): GeocoderConfig {
  return {
    apiKey: process.env.GEOAPIFY_API_KEY?.trim() ?? "",
    baseUrl:
      process.env.GEOAPIFY_API_BASE_URL?.trim().replace(/\/+$/, "") || DEFAULT_BASE_URL,
    timeoutMs: positiveInt(process.env.GEOAPIFY_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS),
    cacheTtlMs: positiveInt(
      process.env.GEOAPIFY_CACHE_TTL_MS,
      DEFAULT_CACHE_TTL_MS,
      24 * 3_600_000,
    ),
    limit: positiveInt(process.env.GEOAPIFY_RESULT_LIMIT, DEFAULT_LIMIT, MAX_LIMIT),
  };
}

export function isGeocoderConfigured(): boolean {
  return geocoderConfig().apiKey.length > 0;
}

/* ── Domain types ────────────────────────────────────────────────────────── */

/** What an admin typed, already validated by Zod. No coordinates anywhere. */
export type CanonicalAddress = {
  addressLine1: string;
  addressLine2?: string | null;
  locality: string;
  region: string;
  postalCode: string;
  country: string;
};

/** One provider answer, normalized. Coordinates are internal, never displayed. */
export type NormalizedAddress = {
  formatted: string;
  addressLine1: string | null;
  addressLine2: string | null;
  locality: string | null;
  region: string | null;
  postalCode: string | null;
  country: string | null;
  latitude: number;
  longitude: number;
  /** 0..1. Above {@link EXACT_CONFIDENCE} an answer is accepted without asking. */
  confidence: number;
  placeId: string | null;
  resultType: string | null;
};

export type ResolveOutcome =
  /** One confident building/street match. Safe to store atomically. */
  | { status: "exact"; address: NormalizedAddress }
  /** Several plausible matches, or one weak one. The admin must choose. */
  | { status: "ambiguous"; candidates: NormalizedAddress[] }
  /** The provider knows of no such place. */
  | { status: "not_found" };

export type GeocoderErrorKind =
  | "not_configured"
  | "invalid_address"
  | "rate_limited"
  | "timeout"
  | "unavailable";

export class GeocoderError extends Error {
  readonly kind: GeocoderErrorKind;
  /** Whether the same call is worth repeating later. */
  readonly retryable: boolean;
  readonly retryAfterSeconds: number | null;

  constructor(
    kind: GeocoderErrorKind,
    message: string,
    options?: { retryAfterSeconds?: number | null },
  ) {
    super(message);
    this.name = "GeocoderError";
    this.kind = kind;
    this.retryable = kind !== "invalid_address" && kind !== "not_configured";
    this.retryAfterSeconds = options?.retryAfterSeconds ?? null;
  }
}

/**
 * The confidence at or above which one result is accepted without confirmation.
 *
 * Geoapify reports `rank.confidence` per result. A building-level match on a
 * complete street address scores near 1; a match that fell back to the
 * postcode centroid or the city scores well below. The threshold is
 * deliberately strict because the consequence of accepting a weak answer is a
 * crew routed to the wrong place.
 */
export const EXACT_CONFIDENCE = 0.8;

/** Result types precise enough to route to. A city centroid is not. */
const ROUTEABLE_RESULT_TYPES = new Set(["building", "amenity", "street"]);

/* ── Address canonicalization ────────────────────────────────────────────── */

/** Collapses whitespace so two spellings of the same address share a cache key. */
function tidy(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

/**
 * The single-line query string sent to the provider.
 *
 * Also the cache/dedupe identity: two saves that differ only in casing or
 * spacing are one lookup.
 */
export function canonicalAddressLine(address: CanonicalAddress): string {
  return [
    tidy(address.addressLine1),
    tidy(address.addressLine2),
    tidy(address.locality),
    tidy(address.region),
    tidy(address.postalCode),
    tidy(address.country).toUpperCase(),
  ]
    .filter((part) => part.length > 0)
    .join(", ");
}

/** Enough of a query to be worth sending, and short enough not to be abuse. */
const MIN_QUERY_LENGTH = 4;
const MAX_QUERY_LENGTH = 300;

function assertQueryable(query: string): void {
  if (query.length < MIN_QUERY_LENGTH) {
    throw new GeocoderError("invalid_address", "That address is too short to look up.");
  }
  if (query.length > MAX_QUERY_LENGTH) {
    throw new GeocoderError("invalid_address", "That address is too long to look up.");
  }
  // Control characters cannot appear in a real address and are the shape of an
  // injection attempt against a downstream log or URL parser.
  if (/[\u0000-\u001f\u007f]/.test(query)) {
    throw new GeocoderError("invalid_address", "That address contains invalid characters.");
  }
}

/* ── Provider response normalization ─────────────────────────────────────── */

type RawResult = Record<string, unknown>;

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readConfidence(result: RawResult): number {
  const rank = result.rank;
  if (rank && typeof rank === "object") {
    const value = finiteNumber((rank as { confidence?: unknown }).confidence);
    if (value !== null) return Math.min(1, Math.max(0, value));
  }
  return 0;
}

/**
 * Turns one provider result into a {@link NormalizedAddress}, or discards it.
 *
 * Anything without usable coordinates or a formatted line is dropped here
 * rather than travelling into the domain as a half-result.
 */
export function normalizeProviderResult(result: RawResult): NormalizedAddress | null {
  const latitude = finiteNumber(result.lat);
  const longitude = finiteNumber(result.lon);
  if (latitude === null || longitude === null) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;

  const addressLine1 = text(result.address_line1);
  const locality = text(result.city) ?? text(result.town) ?? text(result.village);
  const region = text(result.state) ?? text(result.county);
  const postalCode = text(result.postcode);
  const country = text(result.country_code)?.toUpperCase() ?? text(result.country);
  const formatted =
    text(result.formatted) ??
    [addressLine1, locality, region, postalCode, country].filter(Boolean).join(", ");
  if (!formatted) return null;

  return {
    formatted,
    addressLine1,
    addressLine2: text(result.address_line2),
    locality,
    region,
    postalCode,
    country,
    latitude,
    longitude,
    confidence: readConfidence(result),
    placeId: text(result.place_id),
    resultType: text(result.result_type),
  };
}

/** Whether one normalized answer may be stored without asking the admin. */
export function isExactMatch(candidate: NormalizedAddress): boolean {
  return (
    candidate.confidence >= EXACT_CONFIDENCE &&
    candidate.resultType !== null &&
    ROUTEABLE_RESULT_TYPES.has(candidate.resultType)
  );
}

/* ── Cache and in-flight de-duplication ──────────────────────────────────── */

type CacheEntry = { value: NormalizedAddress[]; expiresAt: number };

const responseCache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<NormalizedAddress[]>>();

/** Test seam and operational reset. Safe to call at any time. */
export function clearGeocoderCache(): void {
  responseCache.clear();
  inFlight.clear();
}

function cacheRead(key: string): NormalizedAddress[] | null {
  const entry = responseCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    responseCache.delete(key);
    return null;
  }
  return entry.value;
}

function cacheWrite(key: string, value: NormalizedAddress[], ttlMs: number): void {
  // Bounded: evict the oldest insertion when full. Map preserves insertion
  // order, so this is a plain FIFO and needs no extra bookkeeping.
  if (responseCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = responseCache.keys().next();
    if (!oldest.done) responseCache.delete(oldest.value);
  }
  responseCache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

/** Opaque, stable, non-reversible reference to a query, for log lines. */
function queryReference(query: string): string {
  return createHash("sha256").update(query).digest("hex").slice(0, 12);
}

/* ── Provider call ───────────────────────────────────────────────────────── */

function buildUrl(config: GeocoderConfig, query: string, limit: number): string {
  const url = new URL("/v1/geocode/search", config.baseUrl);
  // `URLSearchParams` percent-encodes; the raw address never lands in the path.
  url.searchParams.set("text", query);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("format", "json");
  url.searchParams.set("apiKey", config.apiKey);
  return url.toString();
}

function retryAfterSeconds(response: Response): number | null {
  const header = response.headers.get("retry-after");
  if (!header) return null;
  const seconds = Number(header.trim());
  return Number.isFinite(seconds) && seconds >= 0 ? Math.min(Math.ceil(seconds), 300) : null;
}

async function callProvider(
  config: GeocoderConfig,
  query: string,
  limit: number,
): Promise<NormalizedAddress[]> {
  const reference = queryReference(query);
  let lastTransient: GeocoderError | null = null;

  for (let attempt = 1; attempt <= MAX_TRANSIENT_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    let response: Response;
    try {
      response = await fetch(buildUrl(config, query, limit), {
        headers: { Accept: "application/json" },
        signal: controller.signal,
        // Provider answers are cached by this module, deliberately and with a
        // TTL we control, rather than by an opaque platform-level HTTP cache.
        cache: "no-store",
      });
    } catch (error) {
      const aborted = (error as { name?: string }).name === "AbortError";
      lastTransient = aborted
        ? new GeocoderError("timeout", "Address lookup timed out. Try again.")
        : new GeocoderError("unavailable", "Address lookup is temporarily unavailable.");
      console.warn("[geocoder] transport failure", {
        reference,
        attempt,
        kind: lastTransient.kind,
      });
      continue;
    } finally {
      clearTimeout(timer);
    }

    if (response.ok) {
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        // A 200 with unreadable JSON is a provider defect, not a bad address.
        lastTransient = new GeocoderError(
          "unavailable",
          "Address lookup returned an unreadable response.",
        );
        console.warn("[geocoder] unreadable payload", { reference, attempt });
        continue;
      }
      const results = (payload as { results?: unknown }).results;
      if (!Array.isArray(results)) return [];
      return results
        .filter((item): item is RawResult => Boolean(item) && typeof item === "object")
        .map(normalizeProviderResult)
        .filter((item): item is NormalizedAddress => item !== null)
        .slice(0, limit);
    }

    if (response.status === 429) {
      // Honour the provider's own backoff instead of retrying into a wall.
      console.warn("[geocoder] rate limited", { reference, status: 429 });
      throw new GeocoderError("rate_limited", "Address lookup is rate limited. Try again shortly.", {
        retryAfterSeconds: retryAfterSeconds(response),
      });
    }

    if (response.status >= 400 && response.status < 500) {
      // A validation or authorization answer will say the same thing forever.
      console.warn("[geocoder] rejected request", { reference, status: response.status });
      throw new GeocoderError(
        response.status === 401 || response.status === 403 ? "not_configured" : "invalid_address",
        response.status === 401 || response.status === 403
          ? "Address verification is not configured correctly."
          : "That address could not be understood.",
      );
    }

    lastTransient = new GeocoderError("unavailable", "Address lookup is temporarily unavailable.");
    console.warn("[geocoder] provider error", { reference, attempt, status: response.status });
  }

  throw lastTransient ?? new GeocoderError("unavailable", "Address lookup failed.");
}

/**
 * One provider round trip per distinct query, cached and de-duplicated.
 *
 * Two admins saving the same HOA at the same moment share one call; a save
 * followed by a retry inside the TTL makes none at all.
 */
async function lookup(query: string, limit: number): Promise<NormalizedAddress[]> {
  const config = geocoderConfig();
  if (!config.apiKey) {
    throw new GeocoderError(
      "not_configured",
      "Address verification is unavailable because the geocoding service is not configured.",
    );
  }
  assertQueryable(query);

  const key = `${limit}:${query.toLowerCase()}`;
  const cached = cacheRead(key);
  if (cached) return cached;

  const pending = inFlight.get(key);
  if (pending) return pending;

  const promise = callProvider(config, query, limit)
    .then((results) => {
      cacheWrite(key, results, config.cacheTtlMs);
      return results;
    })
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, promise);
  return promise;
}

/* ── Public API ──────────────────────────────────────────────────────────── */

export const Geocoder = {
  /**
   * Normalized candidates for a free-text or canonical address.
   *
   * Used for the "did you mean" confirmation step. Returns coordinates
   * alongside each candidate because the caller stores the chosen one — the
   * admin UI is responsible for never rendering them.
   */
  async search(
    address: CanonicalAddress | string,
    options?: { limit?: number },
  ): Promise<NormalizedAddress[]> {
    const query = typeof address === "string" ? tidy(address) : canonicalAddressLine(address);
    const config = geocoderConfig();
    const limit = Math.min(options?.limit ?? config.limit, MAX_LIMIT);
    return lookup(query, limit);
  },

  /**
   * Resolves one address to coordinates, or says why it cannot.
   *
   * The three outcomes are distinct on purpose: only `exact` may be written
   * without a human decision, and `ambiguous` must never be silently collapsed
   * to its first candidate.
   */
  async resolve(address: CanonicalAddress | string): Promise<ResolveOutcome> {
    const candidates = await Geocoder.search(address);
    if (candidates.length === 0) return { status: "not_found" };

    const [best, second] = candidates;
    // One clearly-best routeable answer, and nothing else close to it.
    const contested =
      second !== undefined && second.confidence >= best.confidence - 0.05 && isExactMatch(second);

    if (isExactMatch(best) && !contested) return { status: "exact", address: best };
    return { status: "ambiguous", candidates };
  },
};

export type GeocoderApi = typeof Geocoder;
