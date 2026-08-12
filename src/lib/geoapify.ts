const DEFAULT_API_BASE_URL = "https://api.geoapify.com";
const DEFAULT_TILE_BASE_URL = "https://maps.geoapify.com";

export const geoapifyConfig = {
  apiKey: process.env.NEXT_PUBLIC_GEOAPIFY_API_KEY?.trim() ?? "",
  apiBaseUrl:
    process.env.NEXT_PUBLIC_GEOAPIFY_API_BASE_URL?.trim().replace(/\/$/, "") ||
    DEFAULT_API_BASE_URL,
  tileBaseUrl:
    process.env.NEXT_PUBLIC_GEOAPIFY_TILE_BASE_URL?.trim().replace(/\/$/, "") ||
    DEFAULT_TILE_BASE_URL,
};

export type GeoapifyPlace = {
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  country?: string;
  formatted: string;
  latitude: number;
  longitude: number;
  neighborhood: string;
  placeId?: string;
  postcode?: string;
  resultType?: string;
};

type GeoapifyResult = {
  address_line1?: unknown;
  address_line2?: unknown;
  city?: unknown;
  country?: unknown;
  county?: unknown;
  district?: unknown;
  formatted?: unknown;
  lat?: unknown;
  lon?: unknown;
  municipality?: unknown;
  neighbourhood?: unknown;
  place_id?: unknown;
  postcode?: unknown;
  result_type?: unknown;
  state?: unknown;
  suburb?: unknown;
  town?: unknown;
  village?: unknown;
};

type GeoapifyResponse = { results?: GeoapifyResult[] };

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function normalizeGeoapifyResult(result: GeoapifyResult): GeoapifyPlace | null {
  if (typeof result.lat !== "number" || typeof result.lon !== "number") return null;

  const addressLine1 = text(result.address_line1);
  const addressLine2 = text(result.address_line2);
  const city = text(result.city) ?? text(result.town) ?? text(result.village);
  const region = text(result.state);
  const postcode = text(result.postcode);
  const country = text(result.country);
  const formatted =
    text(result.formatted) ??
    [addressLine1, addressLine2, city, region, postcode, country].filter(Boolean).join(", ");

  if (!formatted) return null;

  return {
    addressLine1,
    addressLine2,
    city,
    country,
    formatted,
    latitude: result.lat,
    longitude: result.lon,
    neighborhood:
      text(result.neighbourhood) ??
      text(result.suburb) ??
      text(result.district) ??
      city ??
      text(result.municipality) ??
      text(result.county) ??
      "",
    placeId: text(result.place_id),
    postcode,
    resultType: text(result.result_type),
  };
}

function createGeocodeUrl(
  path: "autocomplete" | "reverse" | "search",
  params: Record<string, string | number>,
): string {
  if (!geoapifyConfig.apiKey) {
    throw new Error("Geoapify is not configured.");
  }

  const url = new URL(`/v1/geocode/${path}`, geoapifyConfig.apiBaseUrl);
  Object.entries(params).forEach(([name, value]) => url.searchParams.set(name, String(value)));
  url.searchParams.set("format", "json");
  url.searchParams.set("apiKey", geoapifyConfig.apiKey);
  return url.toString();
}

async function requestPlaces(url: string, signal?: AbortSignal): Promise<GeoapifyPlace[]> {
  const response = await fetch(url, {
    headers: { Accept: "application/json", "Accept-Language": "en" },
    signal,
  });
  if (!response.ok) throw new Error("Geoapify could not resolve this location.");

  const payload = (await response.json()) as GeoapifyResponse;
  return (payload.results ?? [])
    .map(normalizeGeoapifyResult)
    .filter((place): place is GeoapifyPlace => place !== null);
}

export async function autocompleteAddress(
  query: string,
  signal?: AbortSignal,
): Promise<GeoapifyPlace[]> {
  if (query.trim().length < 3) return [];
  return requestPlaces(
    createGeocodeUrl("autocomplete", { text: query.trim(), limit: 5 }),
    signal,
  );
}

export async function geocodeAddress(
  address: string,
  signal?: AbortSignal,
): Promise<GeoapifyPlace | null> {
  const places = await requestPlaces(
    createGeocodeUrl("search", { text: address.trim(), limit: 1 }),
    signal,
  );
  return places[0] ?? null;
}

export async function reverseGeocode(
  latitude: number,
  longitude: number,
  signal?: AbortSignal,
): Promise<GeoapifyPlace | null> {
  const places = await requestPlaces(
    createGeocodeUrl("reverse", { lat: latitude, lon: longitude, limit: 1 }),
    signal,
  );
  return places[0] ?? null;
}

export function geoapifyTileUrl(): string {
  if (!geoapifyConfig.apiKey) return "";
  return `${geoapifyConfig.tileBaseUrl}/v1/tile/osm-bright/{z}/{x}/{y}.png?apiKey=${encodeURIComponent(geoapifyConfig.apiKey)}`;
}
