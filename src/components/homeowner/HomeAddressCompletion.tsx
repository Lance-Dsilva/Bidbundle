"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/Button";
import { apiFetch } from "@/lib/api";
import { autocompleteAddress, geocodeAddress, type GeoapifyPlace } from "@/lib/geoapify";

/** Small, self-profile-only address gate; it never requests browser location. */
export function HomeAddressCompletion({
  onComplete,
  onCancel,
  submitLabel = "Save address & join",
}: {
  onComplete: () => Promise<void>;
  onCancel: () => void;
  submitLabel?: string;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);
  const [address, setAddress] = useState("");
  const [verified, setVerified] = useState<GeoapifyPlace | null>(null);
  const [suggestions, setSuggestions] = useState<GeoapifyPlace[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => { input.current?.focus(); }, []);

  useEffect(() => {
    if (address.trim().length < 3 || verified || busy) return;
    const controller = new AbortController();
    let active = true;
    const timer = window.setTimeout(() => {
      void autocompleteAddress(address, controller.signal)
        .then((places) => { if (active) setSuggestions(places); })
        .catch((caught: unknown) => {
          if (active && !(caught instanceof Error && caught.name === "AbortError")) {
            setError("Address search is unavailable right now. Please try again.");
          }
        });
    }, 350);
    return () => {
      active = false;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [address, verified, busy]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (inFlight.current) return;
    if (!address.trim()) {
      setError("Enter your home address.");
      input.current?.focus();
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setSuggestions([]);
    let profileSaved = saved;
    try {
      if (!profileSaved) {
        const place = verified ?? await geocodeAddress(address.trim());
        if (
          !place || !place.formatted.trim() ||
          !Number.isFinite(place.latitude) || Math.abs(place.latitude) > 90 ||
          !Number.isFinite(place.longitude) || Math.abs(place.longitude) > 180
        ) {
          setError("We could not locate that address. Select a suggestion or add a city and postcode.");
          return;
        }
        setAddress(place.formatted);
        setVerified(place);
        await apiFetch("/profile", {
          method: "PATCH",
          body: JSON.stringify({
            address: place.formatted,
            latitude: place.latitude,
            longitude: place.longitude,
          }),
        });
        profileSaved = true;
        setSaved(true);
      }
      await onComplete();
    } catch (caught) {
      setError(profileSaved
        ? `Your address was saved. ${caught instanceof Error ? caught.message : "We could not continue. Please try again."}`
        : "We could not verify or save your address. Please try again.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <form
      className="mt-4 space-y-3 rounded-xl border p-4"
      style={{ borderColor: "var(--border-warm)", background: "var(--cream-50)" }}
      onSubmit={(event) => void submit(event)}
      aria-labelledby={`${id}-title`}
      aria-busy={busy}
    >
      <h3 id={`${id}-title`} className="text-sm font-semibold" style={{ color: "var(--ink-900)" }}>
        Add your home address to continue
      </h3>
      <p id={`${id}-help`} className="text-xs leading-relaxed" style={{ color: "var(--ink-700)" }}>
        Save your home address so a provider can find your home. Your request will be checked
        again before you continue.
      </p>
      <label htmlFor={`${id}-address`} className="block text-sm font-medium" style={{ color: "var(--ink-900)" }}>
        Home address
      </label>
      <input
        ref={input}
        id={`${id}-address`}
        name="address"
        autoComplete="street-address"
        required
        maxLength={500}
        value={address}
        disabled={busy}
        aria-describedby={`${id}-help${error ? ` ${id}-error` : ""}`}
        aria-invalid={error ? true : undefined}
        className="w-full rounded-lg border px-3 py-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        style={{ borderColor: "var(--border-warm)", background: "var(--bg-card)", color: "var(--ink-900)" }}
        onChange={(event) => {
          setAddress(event.target.value);
          setVerified(null);
          setSaved(false);
          setSuggestions([]);
          setError(null);
        }}
      />
      {suggestions.length ? (
        <ul className="space-y-1" aria-label="Address suggestions">
          {suggestions.map((place, index) => (
            <li key={place.placeId ?? `${place.formatted}-${index}`}>
              <button
                type="button"
                disabled={busy}
                className="min-h-11 w-full rounded-lg border px-3 py-2 text-left text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                style={{ borderColor: "var(--border-warm)", color: "var(--ink-900)" }}
                onClick={() => {
                  setAddress(place.formatted);
                  setVerified(place);
                  setSaved(false);
                  setSuggestions([]);
                  setError(null);
                }}
              >
                {place.formatted}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-sm" style={{ color: "var(--danger-600, #b91c1c)" }}>
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="warm" className="min-h-11" disabled={busy}>
          {busy ? "Saving and checking…" : saved ? "Try again" : submitLabel}
        </Button>
        <Button type="button" variant="secondary" className="min-h-11" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <p className="text-[11px]" style={{ color: "var(--ink-700)" }}>
        Address search powered by{" "}
        <a href="https://www.geoapify.com/" target="_blank" rel="noreferrer" className="underline">Geoapify</a>
        {" "}and{" "}
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="underline">OpenStreetMap</a>.
      </p>
    </form>
  );
}
