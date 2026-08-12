"use client";

import { useEffect, useRef, useState } from "react";
import { LocationMap } from "@/components/onboarding/LocationMap";
import { StepProgress } from "@/components/onboarding/StepProgress";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import {
  autocompleteAddress,
  geocodeAddress,
  geoapifyConfig,
  reverseGeocode,
  type GeoapifyPlace,
} from "@/lib/geoapify";
import type { UserRole } from "@/utils/onboardingState";

export type VerifiedLocation = {
  address: string;
  latitude: number;
  longitude: number;
  neighborhood: string;
};

type VerifyAreaStepProps = {
  address: string;
  onAddressChange: (value: string) => void;
  onBack: () => void;
  onConfirm: (location: VerifiedLocation) => void;
  onCoordsDetected?: (lat: number | null, lng: number | null) => void;
  /** The locality reverse-geocoding resolved, saved as the user's neighborhood. */
  onNeighborhoodDetected?: (neighborhood: string) => void;
  role: UserRole;
  submitting?: boolean;
  stepNumber?: number;
  stepCount?: number;
  confirmLabel?: string;
};

function HomeIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 20 20" fill="none">
      <path
        d="M3.75 8.75 10 3.75l6.25 5v7.5a.62.62 0 0 1-.625.625h-3.75v-5h-3.75v5h-3.75a.62.62 0 0 1-.625-.625v-7.5Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

export function VerifyAreaStep({
  address,
  onAddressChange,
  onBack,
  onConfirm,
  onCoordsDetected,
  onNeighborhoodDetected,
  role,
  submitting = false,
  stepNumber = 3,
  stepCount = 3,
  confirmLabel = "Confirm my area",
}: VerifyAreaStepProps) {
  const [locationStatus, setLocationStatus] = useState<
    "idle" | "detecting" | "detected" | "denied" | "manual" | "error"
  >("idle");
  const [detectedCoords, setDetectedCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [localityName, setLocalityName] = useState("");
  const [suggestions, setSuggestions] = useState<GeoapifyPlace[]>([]);
  const [addressFocused, setAddressFocused] = useState(false);
  const [searching, setSearching] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const callbacksRef = useRef({ onAddressChange, onCoordsDetected, onNeighborhoodDetected });
  callbacksRef.current = { onAddressChange, onCoordsDetected, onNeighborhoodDetected };

  const applyPlace = (place: GeoapifyPlace) => {
    setDetectedCoords({ lat: place.latitude, lng: place.longitude });
    setLocalityName(place.neighborhood);
    setLocationStatus("detected");
    setLocationError(null);
    callbacksRef.current.onAddressChange(place.formatted);
    callbacksRef.current.onCoordsDetected?.(place.latitude, place.longitude);
    callbacksRef.current.onNeighborhoodDetected?.(place.neighborhood);
  };

  useEffect(() => {
    if (!navigator.geolocation) {
      setLocationStatus("manual");
      return;
    }
    const controller = new AbortController();
    setLocationStatus("detecting");
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        setDetectedCoords({ lat: latitude, lng: longitude });
        callbacksRef.current.onCoordsDetected?.(latitude, longitude);
        try {
          const place = await reverseGeocode(latitude, longitude, controller.signal);
          if (place) applyPlace(place);
          else setLocationStatus("manual");
        } catch (error) {
          if ((error as Error).name === "AbortError") return;
          setLocationStatus("error");
          setLocationError(
            geoapifyConfig.apiKey
              ? "We found your coordinates but could not resolve the address. Search below instead."
              : "Geoapify is not configured. Add NEXT_PUBLIC_GEOAPIFY_API_KEY.",
          );
        }
      },
      () => setLocationStatus("denied"),
      { timeout: 8000, maximumAge: 60000 }
    );
    return () => controller.abort();
    // Browser location should only be requested once when this step mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!addressFocused || address.trim().length < 3 || !geoapifyConfig.apiKey) {
      setSuggestions([]);
      setSearching(false);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSearching(true);
      void autocompleteAddress(address, controller.signal)
        .then((places) => {
          setSuggestions(places);
          setLocationError(places.length ? null : "No matching address found. Try adding a city or postcode.");
        })
        .catch((error) => {
          if ((error as Error).name !== "AbortError") {
            setSuggestions([]);
            setLocationError("Address search is unavailable right now. Please try again.");
          }
        })
        .finally(() => setSearching(false));
    }, 350);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [address, addressFocused]);

  const handleManualAddressChange = (value: string) => {
    onAddressChange(value);
    // The detected point describes the old reverse-geocoded address. Once the
    // user types a different address, keeping that point would silently match
    // them to the wrong neighborhood.
    if (detectedCoords) {
      setDetectedCoords(null);
      setLocalityName("");
      setLocationStatus("manual");
      onCoordsDetected?.(null, null);
      onNeighborhoodDetected?.("");
    }
    setLocationError(null);
  };

  const handleSelectPlace = (place: GeoapifyPlace) => {
    applyPlace(place);
    setSuggestions([]);
    setAddressFocused(false);
  };

  const handleConfirm = async () => {
    const trimmedAddress = address.trim();
    if (!trimmedAddress) return;

    if (detectedCoords) {
      onConfirm({
        address: trimmedAddress,
        latitude: detectedCoords.lat,
        longitude: detectedCoords.lng,
        neighborhood: localityName,
      });
      return;
    }

    setResolving(true);
    setLocationError(null);
    try {
      const place = await geocodeAddress(trimmedAddress);
      if (!place) {
        setLocationError("We could not locate that address. Select a suggestion or enter more detail.");
        return;
      }
      applyPlace(place);
      onConfirm({
        address: place.formatted,
        latitude: place.latitude,
        longitude: place.longitude,
        neighborhood: place.neighborhood,
      });
    } catch {
      setLocationError(
        geoapifyConfig.apiKey
          ? "We could not verify this address. Please try again."
          : "Geoapify is not configured. Add NEXT_PUBLIC_GEOAPIFY_API_KEY.",
      );
    } finally {
      setResolving(false);
    }
  };

  return (
    <section className="py-6">
      <header className="pb-6">
        <button
          aria-label="Back"
          className="mb-3 flex h-10 w-10 items-center justify-center rounded-full text-[var(--ink-700)] transition hover:bg-[var(--cream-100)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--terracotta-600)]"
          type="button"
          onClick={onBack}
        >
          <svg aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="m15 18-6-6 6-6" />
          </svg>
        </button>
        <StepProgress current={stepNumber} total={stepCount} />
        <h1 className="mt-2 font-display text-[2.4rem] font-bold italic tracking-tight text-[var(--ink-900)]">
          {role === "provider" ? "Set your base area" : "Confirm your area"}
        </h1>
        <p className="mt-2 text-[14px] leading-6 text-[var(--ink-500)]">
          {role === "provider"
            ? "Tell us where your business is based so we can show nearby live requests first."
            : "Tell us where you live so we can match you with neighbors within your 4 mi community radius"}
        </p>
      </header>

      <LocationMap
        latitude={detectedCoords?.lat ?? null}
        longitude={detectedCoords?.lng ?? null}
        locality={localityName}
      />

      <div className="mt-5 space-y-4">
        <div
          className="relative"
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setAddressFocused(false);
          }}
        >
          <Input
            id="onboarding-address"
            label="Your address"
            prefixIcon={<HomeIcon />}
            variant="warm"
            value={address}
            autoComplete="off"
            aria-controls="address-suggestions"
            aria-expanded={addressFocused && suggestions.length > 0}
            onFocus={() => setAddressFocused(true)}
            onChange={(event) => handleManualAddressChange(event.target.value)}
          />
          {searching ? (
            <span className="absolute right-3 top-[35px] text-xs text-[var(--ink-400)]">Searching…</span>
          ) : null}
          {addressFocused && suggestions.length > 0 ? (
            <ul
              id="address-suggestions"
              aria-label="Address suggestions"
              className="absolute z-[600] mt-1 max-h-56 w-full overflow-y-auto rounded-2xl border bg-white p-1 shadow-xl"
              style={{ borderColor: "var(--border-warm)" }}
            >
              {suggestions.map((place) => (
                <li key={place.placeId ?? `${place.latitude}-${place.longitude}-${place.formatted}`}>
                  <button
                    type="button"
                    className="w-full rounded-xl px-3 py-2.5 text-left transition hover:bg-[var(--cream-50)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--terracotta-500)]"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => handleSelectPlace(place)}
                  >
                    <span className="block text-sm font-medium text-[var(--ink-800)]">{place.addressLine1 ?? place.formatted}</span>
                    {place.addressLine1 ? (
                      <span className="mt-0.5 block text-xs text-[var(--ink-500)]">
                        {place.addressLine2 ?? [place.city, place.postcode, place.country].filter(Boolean).join(", ")}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        {locationError ? (
          <p role="alert" aria-live="polite" className="text-xs text-red-600">
            {locationError}
          </p>
        ) : null}
        <div className="flex items-center gap-2 rounded-2xl border px-4 py-2.5"
          style={{ borderColor: locationStatus === "detected" ? "var(--sage-100)" : "var(--border-warm)", background: locationStatus === "detected" ? "var(--sage-50)" : "var(--cream-50)" }}>
          <span className="flex h-5 w-5 items-center justify-center rounded-full text-white text-[10px] font-bold"
            style={{ background: locationStatus === "detected" ? "var(--sage-600)" : locationStatus === "denied" ? "var(--ink-300)" : "var(--terracotta-400)" }}>
            {locationStatus === "detected" ? "✓" : locationStatus === "denied" ? "!" : "…"}
          </span>
          <span className="text-[13px] font-medium" style={{ color: locationStatus === "detected" ? "var(--sage-700)" : "var(--ink-600)" }}>
            {locationStatus === "detected" ? role === "provider"
              ? "Base location detected — nearby jobs will be prioritised automatically"
              : "Location detected — neighbourhood matched automatically" :
             locationStatus === "manual" ? "Choose an address suggestion so its coordinates can be saved" :
             locationStatus === "denied" ? role === "provider"
              ? "Location access denied — search for your business base instead"
              : "Location access denied — search for your address instead" :
             locationStatus === "error" ? "Search for your address to set the correct map location" :
             "Detecting your location…"}
          </span>
        </div>

        {role === "provider" ? (
          <>
            <div className="rounded-[24px] border bg-[var(--sage-50)] p-4" style={{ borderColor: "var(--sage-100)" }}>
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--sage-600)] text-white">
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="2.2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m2.5 6 2.5 2.5 5-5" />
                  </svg>
                </span>
                <p className="text-sm font-semibold text-[var(--sage-700)]">Your service base is ready</p>
              </div>
              <p className="mt-1 pl-7 text-xs text-[var(--sage-600)]">Next you&apos;ll add your business details and the major area you serve.</p>
            </div>

            <div className="rounded-[24px] border bg-[var(--terracotta-50)] p-4" style={{ borderColor: "var(--terracotta-100)" }}>
              <p className="text-sm font-medium text-[var(--ink-900)]">Coverage note</p>
              <p className="mt-0.5 text-xs text-[var(--ink-500)]">We&apos;ll rank jobs closest to this base area first, then expand by your service radius.</p>
            </div>
          </>
        ) : (
          <>
            <div className="rounded-[24px] border bg-[var(--sage-50)] p-4" style={{ borderColor: "var(--sage-100)" }}>
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--sage-600)] text-white">
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="2.2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m2.5 6 2.5 2.5 5-5" />
                  </svg>
                </span>
                <p className="text-sm font-semibold text-[var(--sage-700)]">Your community area is set</p>
              </div>
              <p className="mt-1 pl-7 text-xs text-[var(--sage-600)]">
                We&apos;ll group you with neighbors inside your 4 mi radius.
              </p>
            </div>

            <div className="rounded-[24px] border bg-[var(--terracotta-50)] p-4" style={{ borderColor: "var(--terracotta-100)" }}>
              <p className="text-sm font-medium text-[var(--ink-900)]">Residency requirement</p>
              <p className="mt-0.5 text-xs text-[var(--ink-500)]">Must have lived 6+ months to join group bids</p>
            </div>
          </>
        )}
      </div>

      <div className="mt-6">
        <div className="mb-3 flex items-center justify-between">
          <StepProgress current={stepNumber} total={stepCount} />
          <span className="text-[12px] text-[var(--ink-400)]">{stepNumber} of {stepCount}</span>
        </div>
        <Button className="h-12 w-full rounded-full text-[14px] font-semibold" onClick={() => void handleConfirm()} variant="warm" disabled={submitting || resolving || !address.trim()}>
          {submitting ? "Creating account…" : resolving ? "Verifying address…" : confirmLabel}
        </Button>
      </div>
    </section>
  );
}
