"use client";

import type { Circle, Map as LeafletMap, Marker } from "leaflet";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";

import {
  SERVICE_RADIUS_DEFAULT_MILES,
  SERVICE_RADIUS_MAX_MILES,
  SERVICE_RADIUS_MIN_MILES,
  SERVICE_RADIUS_STEP_MILES,
  clampRadiusMiles,
  coverageSummary,
  normalizeRadiusMiles,
  suggestedAreaLabel,
  MAX_SERVICE_AREA_LABEL_LENGTH,
} from "@/lib/provider-coverage";
import {
  autocompleteAddress,
  geoapifyConfig,
  geoapifyTileUrl,
  geocodeAddress,
  reverseGeocode,
  type GeoapifyPlace,
} from "@/lib/geoapify";

/**
 * The one coverage-map editor.
 *
 * Owns presentation only: it emits a validated draft through `onChange` and
 * never persists anything itself, so onboarding (which saves through the
 * profile-completion endpoint) and profile settings (which saves through
 * `/api/provider/service-areas`) share exactly this map, this circle, and this
 * radius control rather than two drifting copies.
 *
 * Nothing computed here is authoritative. The server recomputes coverage from
 * the stored centre and radius on every match.
 */

export type ServiceAreaDraft = {
  label: string;
  centerLatitude: number;
  centerLongitude: number;
  radiusMiles: number;
  formattedAddress: string | null;
  locality: string | null;
  region: string | null;
  postalCode: string | null;
  countryCode: string | null;
};

/** Other active circles drawn faintly for context. Not editable here. */
export type ContextCircle = {
  id: string;
  label: string;
  centerLatitude: number | null;
  centerLongitude: number | null;
  radiusMiles: number | null;
};

type EditorProps = {
  value: ServiceAreaDraft | null;
  onChange: (draft: ServiceAreaDraft | null) => void;
  /** Hidden during onboarding, where the label is derived from the address. */
  showLabelField?: boolean;
  contextCircles?: readonly ContextCircle[];
  disabled?: boolean;
  /** Rendered under the radius control; explains what the circle controls. */
  helpText?: string;
  mapHeightClassName?: string;
  /**
   * How the search, map, and settings are arranged.
   *
   * - `stacked` — one narrow column, top to bottom. What onboarding needs,
   *   where the editor sits inside a step card.
   * - `split` — a full-width search row, then a large map beside a compact
   *   settings column on wide screens, collapsing to one column below `lg`.
   *   The settings and the map both get real width instead of the map being
   *   squeezed into whatever is left beside a fixed list.
   *
   * Same component and same state either way: there is one coverage editor.
   */
  layout?: "stacked" | "split";
  /**
   * Save/cancel controls, rendered with the area name so the thing being
   * named and the button that saves it are not separated by the whole map.
   */
  actions?: ReactNode;
};

const ATTRIBUTION =
  '<a href="https://www.geoapify.com/" target="_blank" rel="noreferrer">Powered by Geoapify</a> | &copy; <a href="https://openmaptiles.org/" target="_blank" rel="noreferrer">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>';

const MILES_TO_METERS = 1609.344;

/** Keeps the whole circle in view without zooming past useful street detail. */
function zoomForRadius(radiusMiles: number): number {
  if (radiusMiles <= 2) return 13;
  if (radiusMiles <= 5) return 12;
  if (radiusMiles <= 12) return 11;
  if (radiusMiles <= 25) return 10;
  if (radiusMiles <= 50) return 9;
  return 8;
}

function placeToDraftFields(place: GeoapifyPlace) {
  return {
    formattedAddress: place.formatted,
    locality: place.city ?? place.neighborhood ?? null,
    region: null as string | null,
    postalCode: place.postcode ?? null,
    countryCode: place.country ?? null,
  };
}

/**
 * Geoapify's normalizer folds the state into `formatted` but does not expose it
 * as its own field, so the region is recovered from the formatted string when
 * it looks like `…, City, ST 78758, United States`.
 */
function regionFromFormatted(formatted: string): string | null {
  const parts = formatted.split(",").map((part) => part.trim());
  for (const part of parts) {
    const match = /^([A-Za-z .]{2,30})\s+\d{5}(-\d{4})?$/.exec(part);
    if (match) return match[1]!.trim();
  }
  return null;
}

export function ProviderServiceAreaEditor({
  value,
  onChange,
  showLabelField = true,
  contextCircles = [],
  disabled = false,
  helpText,
  mapHeightClassName,
  layout = "stacked",
  actions,
}: EditorProps) {
  const reactId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const circleRef = useRef<Circle | null>(null);
  const contextLayersRef = useRef<Circle[]>([]);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const valueRef = useRef(value);
  valueRef.current = value;

  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<GeoapifyPlace[]>([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  /** Mirrors the numeric input while the user is mid-edit ("" or "1."). */
  const [radiusText, setRadiusText] = useState(
    String(value?.radiusMiles ?? SERVICE_RADIUS_DEFAULT_MILES),
  );

  const configured = Boolean(geoapifyConfig.apiKey);
  const radiusMiles = value?.radiusMiles ?? SERVICE_RADIUS_DEFAULT_MILES;
  const summary = useMemo(
    () =>
      value
        ? coverageSummary({
            radiusMiles: value.radiusMiles,
            place: value,
            label: value.label,
          })
        : null,
    [value],
  );

  useEffect(() => {
    setRadiusText(String(value?.radiusMiles ?? SERVICE_RADIUS_DEFAULT_MILES));
  }, [value?.radiusMiles]);

  useEffect(() => {
    if (typeof navigator === "undefined") return;
    const sync = () => setOffline(!navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  /* ── Draft mutation helpers ─────────────────────────────────────────── */

  const applyPlace = useCallback((place: GeoapifyPlace) => {
    const current = valueRef.current;
    const fields = placeToDraftFields(place);
    onChangeRef.current({
      label:
        current?.label?.trim() ||
        suggestedAreaLabel({ locality: fields.locality, formattedAddress: fields.formattedAddress }),
      centerLatitude: place.latitude,
      centerLongitude: place.longitude,
      radiusMiles: current?.radiusMiles ?? SERVICE_RADIUS_DEFAULT_MILES,
      ...fields,
      region: regionFromFormatted(place.formatted),
    });
  }, []);

  const setRadius = useCallback((next: number) => {
    const current = valueRef.current;
    if (!current) return;
    onChangeRef.current({ ...current, radiusMiles: clampRadiusMiles(next) });
  }, []);

  /**
   * Moving the marker changes the centre immediately, then asks the geocoder
   * what is there. The circle must not wait for the network, and a failed
   * reverse lookup must not discard a centre the provider deliberately placed.
   */
  const moveCenter = useCallback(async (latitude: number, longitude: number) => {
    const current = valueRef.current;
    if (!current) return;
    onChangeRef.current({ ...current, centerLatitude: latitude, centerLongitude: longitude });
    if (!geoapifyConfig.apiKey) return;
    try {
      const place = await reverseGeocode(latitude, longitude);
      const latest = valueRef.current;
      if (!place || !latest) return;
      // Ignore a late answer for a point the user has already moved away from.
      if (latest.centerLatitude !== latitude || latest.centerLongitude !== longitude) return;
      const fields = placeToDraftFields(place);
      onChangeRef.current({
        ...latest,
        ...fields,
        region: regionFromFormatted(place.formatted),
      });
      setLookupError(null);
    } catch {
      setLookupError(
        "We moved your centre but could not name that spot. The coordinates are still saved.",
      );
    }
  }, []);

  /* ── Map lifecycle ──────────────────────────────────────────────────── */

  useEffect(() => {
    if (!containerRef.current || !configured) return;

    let cancelled = false;
    void import("leaflet")
      .then((leaflet) => {
        if (cancelled || !containerRef.current || mapRef.current) return;

        const draft = valueRef.current;
        const center: [number, number] = draft
          ? [draft.centerLatitude, draft.centerLongitude]
          : [39.5, -98.35];
        const map = leaflet.map(containerRef.current, {
          center,
          zoom: draft ? zoomForRadius(draft.radiusMiles) : 4,
          zoomControl: true,
          scrollWheelZoom: false,
          keyboard: true,
        });
        leaflet
          .tileLayer(geoapifyTileUrl(), { attribution: ATTRIBUTION, maxZoom: 20 })
          .on("tileerror", () =>
            setMapError("Some map tiles could not be loaded. Your area is still saved."),
          )
          .addTo(map);

        mapRef.current = map;
        setMapReady(true);
      })
      .catch(() =>
        setMapError("The map could not be loaded. You can still search for an address below."),
      );

    return () => {
      cancelled = true;
      markerRef.current = null;
      circleRef.current = null;
      contextLayersRef.current = [];
      mapRef.current?.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, [configured]);

  // Marker + circle follow the draft. Split from creation so a radius change
  // repaints without tearing down the map the user is panning.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !value) return;

    let cancelled = false;
    void import("leaflet").then((leaflet) => {
      if (cancelled || !mapRef.current) return;
      const center: [number, number] = [value.centerLatitude, value.centerLongitude];

      if (!markerRef.current) {
        markerRef.current = leaflet
          .marker(center, {
            draggable: !disabled,
            keyboard: true,
            title: "Drag to move your service centre",
            alt: "Service area centre",
            icon: leaflet.divIcon({
              className: "",
              html: '<span class="bundleen-map-pin"><span></span></span>',
              iconAnchor: [17, 40],
              iconSize: [34, 42],
            }),
          })
          .addTo(map);
        markerRef.current.on("dragend", (event) => {
          const position = (event.target as Marker).getLatLng();
          void moveCenter(position.lat, position.lng);
        });
      } else {
        markerRef.current.setLatLng(center);
        // `dragging` is only present once Leaflet has attached the handler.
        if (disabled) markerRef.current.dragging?.disable();
        else markerRef.current.dragging?.enable();
      }

      if (!circleRef.current) {
        circleRef.current = leaflet
          .circle(center, {
            radius: value.radiusMiles * MILES_TO_METERS,
            color: "#0F9D8A",
            weight: 2,
            fillColor: "#0F9D8A",
            fillOpacity: 0.16,
            interactive: false,
          })
          .addTo(map);
      } else {
        circleRef.current.setLatLng(center);
        circleRef.current.setRadius(value.radiusMiles * MILES_TO_METERS);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [mapReady, value, disabled, moveCenter]);

  // Keep the whole circle in frame when the centre or radius changes, without
  // fighting a user who is panning: only recentre when the circle leaves view.
  const lastFitRef = useRef<string>("");
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !value) return;
    const key = `${value.centerLatitude}:${value.centerLongitude}:${value.radiusMiles}`;
    if (lastFitRef.current === key) return;
    lastFitRef.current = key;
    map.setView([value.centerLatitude, value.centerLongitude], zoomForRadius(value.radiusMiles), {
      animate: true,
    });
  }, [mapReady, value]);

  // Other active areas, drawn faintly so a provider can see overlap.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    let cancelled = false;
    void import("leaflet").then((leaflet) => {
      if (cancelled || !mapRef.current) return;
      for (const layer of contextLayersRef.current) layer.remove();
      contextLayersRef.current = contextCircles
        .filter(
          (circle) =>
            circle.centerLatitude != null &&
            circle.centerLongitude != null &&
            circle.radiusMiles != null,
        )
        .map((circle) =>
          leaflet
            .circle([circle.centerLatitude as number, circle.centerLongitude as number], {
              radius: (circle.radiusMiles as number) * MILES_TO_METERS,
              color: "#94a3b8",
              weight: 1,
              dashArray: "4 4",
              fillColor: "#94a3b8",
              fillOpacity: 0.06,
              interactive: false,
            })
            .addTo(map),
        );
    });

    return () => {
      cancelled = true;
    };
  }, [mapReady, contextCircles]);

  /* ── Address search ─────────────────────────────────────────────────── */

  useEffect(() => {
    if (!suggestionsOpen || query.trim().length < 3 || !configured) {
      setSuggestions([]);
      setSearching(false);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSearching(true);
      void autocompleteAddress(query, controller.signal)
        .then((places) => {
          setSuggestions(places);
          setLookupError(
            places.length ? null : "No matching address found. Try adding a city or postcode.",
          );
        })
        .catch((error) => {
          if ((error as Error).name === "AbortError") return;
          setSuggestions([]);
          setLookupError("Address search is unavailable right now. Please try again.");
        })
        .finally(() => setSearching(false));
    }, 350);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, suggestionsOpen, configured]);

  const searchExact = async () => {
    const trimmed = query.trim();
    if (!trimmed || !configured) return;
    setSearching(true);
    setLookupError(null);
    try {
      const place = await geocodeAddress(trimmed);
      if (!place) {
        setLookupError("We could not locate that address. Add more detail or pick a suggestion.");
        return;
      }
      applyPlace(place);
      setSuggestions([]);
      setSuggestionsOpen(false);
    } catch {
      setLookupError("Address search is unavailable right now. Please try again.");
    } finally {
      setSearching(false);
    }
  };

  // A split layout gives the map most of the width, so it earns more height
  // too; stacked keeps the compact onboarding proportions.
  const mapHeight =
    mapHeightClassName ??
    (layout === "split" ? "h-[300px] sm:h-[380px] lg:h-[460px]" : "h-[260px] sm:h-[320px]");

  const searchInputId = `${reactId}-address`;
  const radiusInputId = `${reactId}-radius`;
  const labelInputId = `${reactId}-label`;
  const summaryId = `${reactId}-summary`;

  const searchBlock = (
    <div>
      {/* ── Address search ─────────────────────────────────────────────── */}
      <div
        className="relative"
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setSuggestionsOpen(false);
        }}
      >
        <label
          className="block text-[12px] font-semibold uppercase tracking-[0.1em] text-slate-500"
          htmlFor={searchInputId}
        >
          Service area centre
        </label>
        <div className="mt-1.5 flex gap-2">
          <input
            id={searchInputId}
            type="search"
            role="combobox"
            autoComplete="off"
            disabled={disabled}
            aria-expanded={suggestionsOpen && suggestions.length > 0}
            aria-controls={`${reactId}-suggestions`}
            aria-describedby={summaryId}
            placeholder={value?.formattedAddress ?? "Search an address, suburb, or postcode"}
            value={query}
            onFocus={() => setSuggestionsOpen(true)}
            onChange={(event) => {
              setQuery(event.target.value);
              setSuggestionsOpen(true);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void searchExact();
              }
              if (event.key === "Escape") setSuggestionsOpen(false);
            }}
            className="h-11 min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3.5 text-[14px] text-slate-900 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
          />
          <button
            type="button"
            disabled={disabled || searching || query.trim().length < 3}
            onClick={() => void searchExact()}
            className="h-11 shrink-0 rounded-xl bg-slate-900 px-4 text-[13px] font-semibold text-white transition disabled:opacity-40"
          >
            {searching ? "Searching…" : "Search"}
          </button>
        </div>

        {suggestionsOpen && suggestions.length > 0 ? (
          <ul
            id={`${reactId}-suggestions`}
            aria-label="Address suggestions"
            className="absolute z-[600] mt-1 max-h-56 w-full overflow-y-auto rounded-2xl border border-slate-200 bg-white p-1 shadow-xl"
          >
            {suggestions.map((place) => (
              <li key={place.placeId ?? `${place.latitude}-${place.longitude}-${place.formatted}`}>
                <button
                  type="button"
                  className="w-full rounded-xl px-3 py-2.5 text-left transition hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-500"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    applyPlace(place);
                    setQuery("");
                    setSuggestions([]);
                    setSuggestionsOpen(false);
                  }}
                >
                  <span className="block text-[13px] font-medium text-slate-900">
                    {place.addressLine1 ?? place.formatted}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-slate-500">
                    {place.addressLine2 ??
                      [place.city, place.postcode, place.country].filter(Boolean).join(", ")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

    </div>
  );

  const mapBlock = (
    <div>
      {/* ── Map ─────────────────────────────────────────────────────────── */}
      <div
        className={`relative overflow-hidden rounded-2xl border border-slate-200 ${mapHeight}`}
      >
        <div ref={containerRef} className="h-full w-full" />
        {!mapReady ? (
          <div
            role="status"
            className="absolute inset-0 grid place-items-center bg-slate-50 text-[13px] font-medium text-slate-500"
          >
            Loading the coverage map…
          </div>
        ) : null}
        {!value && mapReady ? (
          <div className="pointer-events-none absolute inset-x-4 top-4 z-[500] rounded-xl bg-white/95 px-4 py-3 text-center text-[13px] font-medium text-slate-700 shadow-sm">
            Search for an address above to place your service centre.
          </div>
        ) : null}
        {mapError ? (
          <p
            role="alert"
            className="absolute inset-x-3 bottom-8 z-[500] rounded-lg bg-white/95 px-3 py-2 text-center text-[12px] text-amber-700 shadow-sm"
          >
            {mapError}
          </p>
        ) : null}
      </div>

      {offline ? (
        <p role="alert" className="mt-2 text-[12px] font-medium text-amber-700">
          You appear to be offline. Address search and map tiles will not load until your
          connection returns; anything already on the map is still safe.
        </p>
      ) : null}
      {lookupError ? (
        <p role="alert" className="mt-2 text-[12px] font-medium text-red-600">
          {lookupError}
        </p>
      ) : null}

    </div>
  );

  const settingsBlock = (
    <div className="space-y-4">
      {/* ── Radius ──────────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <label
            className="text-[12px] font-semibold uppercase tracking-[0.1em] text-slate-500"
            htmlFor={radiusInputId}
          >
            Service radius
          </label>
          <div className="flex items-center gap-2">
            <input
              id={radiusInputId}
              type="number"
              inputMode="decimal"
              disabled={disabled || !value}
              min={SERVICE_RADIUS_MIN_MILES}
              max={SERVICE_RADIUS_MAX_MILES}
              step={SERVICE_RADIUS_STEP_MILES}
              value={radiusText}
              onChange={(event) => {
                setRadiusText(event.target.value);
                const parsed = Number(event.target.value);
                // Intermediate states ("", "1.") keep the circle where it is
                // rather than snapping it to a default the user did not choose.
                if (event.target.value.trim() !== "" && Number.isFinite(parsed)) {
                  setRadius(parsed);
                }
              }}
              onBlur={() => setRadiusText(String(normalizeRadiusMiles(radiusMiles)))}
              className="h-10 w-24 rounded-lg border border-slate-300 px-3 text-right text-[14px] font-semibold text-slate-900 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
            />
            <span className="text-[13px] font-medium text-slate-600">miles</span>
          </div>
        </div>

        <input
          type="range"
          aria-label="Service radius in miles"
          disabled={disabled || !value}
          min={SERVICE_RADIUS_MIN_MILES}
          max={SERVICE_RADIUS_MAX_MILES}
          step={SERVICE_RADIUS_STEP_MILES}
          value={radiusMiles}
          onChange={(event) => setRadius(Number(event.target.value))}
          className="mt-3 h-6 w-full cursor-pointer accent-teal-600"
        />
        <div className="flex justify-between text-[11px] font-medium text-slate-400">
          <span>{SERVICE_RADIUS_MIN_MILES} mi</span>
          <span>{SERVICE_RADIUS_MAX_MILES} mi</span>
        </div>

        <p
          id={summaryId}
          aria-live="polite"
          className="mt-3 rounded-xl bg-teal-50 px-3.5 py-2.5 text-[13px] font-semibold text-teal-900"
        >
          {summary ?? "Pick an address to see your coverage summary."}
        </p>
        <p className="mt-2 text-[12px] leading-5 text-slate-500">
          {helpText ??
            "This circle decides which open service requests you can see. Requests outside every active area of yours never reach your feed."}
        </p>
      </div>

      {showLabelField ? (
        <div>
          <label
            className="block text-[12px] font-semibold uppercase tracking-[0.1em] text-slate-500"
            htmlFor={labelInputId}
          >
            Area name
          </label>
          <input
            id={labelInputId}
            type="text"
            disabled={disabled || !value}
            maxLength={MAX_SERVICE_AREA_LABEL_LENGTH}
            value={value?.label ?? ""}
            placeholder="North Austin"
            onChange={(event) => {
              if (!value) return;
              onChange({ ...value, label: event.target.value });
            }}
            className="mt-1.5 h-11 w-full rounded-xl border border-slate-300 bg-white px-3.5 text-[14px] text-slate-900 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
          />
          <p className="mt-1 text-[11px] text-slate-500">
            A name only you see, so several areas stay easy to tell apart.
          </p>
        </div>
      ) : null}

      {actions ? <div>{actions}</div> : null}
    </div>
  );

  /**
   * Without a Geoapify key there is no search and no map — but the radius, the
   * area name, and the save controls do not depend on either, so they stay.
   * Hiding them would leave a provider on a self-hosted deployment unable to
   * rename or save an area they already have.
   */
  const unconfiguredNotice = (
    <div
      role="status"
      className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-center text-sm text-slate-600"
    >
      <p className="font-semibold text-slate-800">Map lookup is not configured</p>
      <p className="mx-auto mt-1 max-w-sm text-[13px]">
        Set <code className="rounded bg-white px-1">NEXT_PUBLIC_GEOAPIFY_API_KEY</code> to enable
        address search and the coverage map.
      </p>
    </div>
  );

  const geography = configured ? (
    <>
      {searchBlock}
      {mapBlock}
    </>
  ) : (
    unconfiguredNotice
  );

  if (layout === "split") {
    return (
      <div className="space-y-4">
        {configured ? searchBlock : null}
        {/* The map takes the width; the settings column stays compact but never
            narrower than its controls need. Below `lg` they stack, so the
            radius slider sits directly under the map it changes. */}
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
          {configured ? mapBlock : unconfiguredNotice}
          {settingsBlock}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {geography}
      {settingsBlock}
    </div>
  );
}

/** Whether a draft is complete enough for the server to accept it. */
export function isServiceAreaDraftValid(draft: ServiceAreaDraft | null): draft is ServiceAreaDraft {
  return Boolean(
    draft &&
      draft.label.trim().length > 0 &&
      Number.isFinite(draft.centerLatitude) &&
      Number.isFinite(draft.centerLongitude) &&
      draft.radiusMiles >= SERVICE_RADIUS_MIN_MILES &&
      draft.radiusMiles <= SERVICE_RADIUS_MAX_MILES,
  );
}
