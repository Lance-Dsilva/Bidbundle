"use client";

import type { Map as LeafletMap, Marker } from "leaflet";
import { useEffect, useRef, useState } from "react";

import { geoapifyConfig, geoapifyTileUrl } from "@/lib/geoapify";

type LocationMapProps = {
  latitude: number | null;
  longitude: number | null;
  locality: string;
};

const ATTRIBUTION =
  '<a href="https://www.geoapify.com/" target="_blank" rel="noreferrer">Powered by Geoapify</a> | &copy; <a href="https://openmaptiles.org/" target="_blank" rel="noreferrer">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>';

export function LocationMap({ latitude, longitude, locality }: LocationMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const positionRef = useRef({ latitude, longitude });
  const [mapError, setMapError] = useState<string | null>(null);
  positionRef.current = { latitude, longitude };

  useEffect(() => {
    if (!containerRef.current || !geoapifyConfig.apiKey) return;

    let cancelled = false;
    void import("leaflet")
      .then((leaflet) => {
        if (cancelled || !containerRef.current || mapRef.current) return;

        const currentPosition = positionRef.current;
        const hasPosition =
          currentPosition.latitude !== null && currentPosition.longitude !== null;
        const center: [number, number] = hasPosition
          ? [currentPosition.latitude as number, currentPosition.longitude as number]
          : [39.5, -98.35];
        const map = leaflet.map(containerRef.current, {
          center,
          zoom: hasPosition ? 14 : 3,
          zoomControl: false,
          scrollWheelZoom: false,
        });
        leaflet
          .tileLayer(geoapifyTileUrl(), {
            attribution: ATTRIBUTION,
            maxZoom: 20,
          })
          .on("tileerror", () => setMapError("The map tiles could not be loaded."))
          .addTo(map);

        mapRef.current = map;
        if (hasPosition) {
          markerRef.current = leaflet.marker(center, {
            icon: leaflet.divIcon({
              className: "",
              html: '<span class="bundleen-map-pin"><span></span></span>',
              iconAnchor: [17, 40],
              iconSize: [34, 42],
            }),
          }).addTo(map);
        }
      })
      .catch(() => setMapError("The map could not be loaded."));

    return () => {
      cancelled = true;
      markerRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // The map is created once. Position updates are handled by the next effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || latitude === null || longitude === null) return;

    let cancelled = false;
    void import("leaflet").then((leaflet) => {
      if (cancelled) return;
      if (markerRef.current) markerRef.current.setLatLng([latitude, longitude]);
      else {
        markerRef.current = leaflet.marker([latitude, longitude], {
          icon: leaflet.divIcon({
            className: "",
            html: '<span class="bundleen-map-pin"><span></span></span>',
            iconAnchor: [17, 40],
            iconSize: [34, 42],
          }),
        }).addTo(map);
      }
      map.flyTo([latitude, longitude], 14, { animate: true, duration: 0.6 });
    });
    return () => {
      cancelled = true;
    };
  }, [latitude, longitude]);

  if (!geoapifyConfig.apiKey) {
    return (
      <div className="flex h-[175px] items-center justify-center rounded-2xl border bg-[var(--cream-50)] px-6 text-center text-sm text-[var(--ink-500)]" style={{ borderColor: "var(--border-warm)" }}>
        Add NEXT_PUBLIC_GEOAPIFY_API_KEY to enable address lookup and the map.
      </div>
    );
  }

  return (
    <div className="relative h-[175px] overflow-hidden rounded-2xl border" style={{ borderColor: "#d8e1dd" }}>
      <div ref={containerRef} className="h-full w-full" role="img" aria-label={locality ? `Map showing ${locality}` : "Location map"} />
      {locality ? (
        <div className="pointer-events-none absolute right-3 top-2.5 z-[500] rounded-full bg-white/90 px-3 py-1 text-[10px] font-semibold text-[var(--terracotta-600)] shadow-sm backdrop-blur-sm">
          {locality}
        </div>
      ) : null}
      {mapError ? (
        <div role="alert" className="absolute inset-x-3 bottom-7 z-[500] rounded-lg bg-white/95 px-3 py-2 text-center text-xs text-red-600 shadow-sm">
          {mapError}
        </div>
      ) : null}
    </div>
  );
}
