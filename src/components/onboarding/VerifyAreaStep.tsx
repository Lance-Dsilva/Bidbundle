"use client";

import { useEffect, useState } from "react";
import { StepProgress } from "@/components/onboarding/StepProgress";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import type { UserRole } from "@/utils/onboardingState";

type VerifyAreaStepProps = {
  address: string;
  onAddressChange: (value: string) => void;
  onBack: () => void;
  onConfirm: () => void;
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

function MapView({ lat, lng, locality }: { lat: number | null; lng: number | null; locality: string }) {
  if (lat !== null && lng !== null) {
    const delta = 0.018;
    const bbox = `${lng - delta},${lat - delta},${lng + delta},${lat + delta}`;
    const src = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lng}`;
    return (
      <div className="relative h-[160px] overflow-hidden rounded-[24px] border" style={{ borderColor: "var(--border-warm)" }}>
        <iframe
          src={src}
          title="Your location"
          width="100%"
          height="160"
          style={{ border: "none", display: "block", pointerEvents: "none" }}
          loading="lazy"
        />
        {locality && (
          <div className="absolute right-3 top-2.5 rounded-full bg-white/90 px-3 py-1 text-[10px] font-semibold text-[var(--terracotta-600)] backdrop-blur-sm shadow-sm">
            {locality}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className="relative h-[160px] overflow-hidden rounded-[24px] border"
      style={{
        borderColor: "var(--border-warm)",
        backgroundColor: "#F1ECE2",
        backgroundImage: "radial-gradient(circle, rgba(232,98,63,0.10) 1px, transparent 1px)",
        backgroundSize: "20px 20px",
      }}
    >
      <div className="absolute inset-x-4 top-7 h-6 rounded-lg bg-white/50" />
      <div className="absolute left-5 top-16 h-7 w-16 rounded-lg bg-white/45" />
      <div className="absolute right-6 top-16 h-8 w-20 rounded-lg bg-white/50" />
      <div className="absolute bottom-10 left-12 h-8 w-20 rounded-xl bg-white/50" />
      <div className="absolute left-[16%] top-[28%] h-2 w-2 rounded-full bg-[var(--sage-500)] shadow-sm" />
      <div className="absolute left-[30%] top-[60%] h-2 w-2 rounded-full bg-[var(--sage-500)] shadow-sm" />
      <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center">
        <svg aria-hidden="true" className="h-14 w-14 text-[var(--terracotta-600)]" viewBox="0 0 64 64" fill="none">
          <circle cx="32" cy="32" r="18" fill="currentColor" fillOpacity="0.10" />
          <circle cx="32" cy="32" r="10" fill="currentColor" fillOpacity="0.18" />
          <circle cx="32" cy="32" r="6" fill="currentColor" />
          <circle cx="32" cy="32" r="2" fill="white" />
        </svg>
      </div>
      <div className="absolute right-3 top-2.5 rounded-full bg-white/90 px-3 py-1 text-[10px] font-semibold text-[var(--ink-400)] backdrop-blur-sm shadow-sm">
        Detecting location…
      </div>
    </div>
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
    "idle" | "detecting" | "detected" | "denied" | "manual"
  >("idle");
  const [detectedCoords, setDetectedCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [localityName, setLocalityName] = useState("");

  useEffect(() => {
    if (!navigator.geolocation) return;
    setLocationStatus("detecting");
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        setDetectedCoords({ lat: latitude, lng: longitude });
        onCoordsDetected?.(latitude, longitude);
        // Reverse-geocode to fill the address field and locality badge
        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`,
            { headers: { "Accept-Language": "en" } }
          );
          if (res.ok) {
            const data = await res.json() as {
              address?: {
                house_number?: string;
                road?: string;
                suburb?: string;
                neighbourhood?: string;
                city?: string;
                town?: string;
                village?: string;
                county?: string;
                state?: string;
                postcode?: string;
              };
            };
            const a = data.address ?? {};
            const street = [a.house_number, a.road].filter(Boolean).join(" ");
            const locality = a.suburb ?? a.neighbourhood ?? a.city ?? a.town ?? a.village ?? a.county ?? "";
            const region = a.state ?? "";
            const postcode = a.postcode ?? "";
            const formatted = [street, locality, region, postcode].filter(Boolean).join(", ");
            if (formatted) onAddressChange(formatted);
            if (locality) {
              setLocalityName(locality);
              onNeighborhoodDetected?.(locality);
            }
          }
        } catch {
          // geocoding failed — keep existing address
        }
        setLocationStatus("detected");
      },
      () => setLocationStatus("denied"),
      { timeout: 8000, maximumAge: 60000 }
    );
  }, []);

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

      <MapView lat={detectedCoords?.lat ?? null} lng={detectedCoords?.lng ?? null} locality={localityName} />

      <div className="mt-5 space-y-4">
        <Input
          label="Your address"
          prefixIcon={<HomeIcon />}
          variant="warm"
          value={address}
          onChange={(event) => handleManualAddressChange(event.target.value)}
        />
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
             locationStatus === "manual" ? "Using your typed address — the previous map position was removed" :
             locationStatus === "denied" ? role === "provider"
              ? "Location access denied — we'll use your typed business base instead"
              : "Location access denied — neighbourhood will be set from address" :
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
        <Button className="h-12 w-full rounded-full text-[14px] font-semibold" onClick={onConfirm} variant="warm" disabled={submitting || !address.trim()}>
          {submitting ? "Creating account…" : confirmLabel}
        </Button>
      </div>
    </section>
  );
}
