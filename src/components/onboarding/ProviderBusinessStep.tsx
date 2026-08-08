"use client";

import { StepProgress } from "@/components/onboarding/StepProgress";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

type ProviderBusinessData = {
  companyName: string;
  bio: string;
  services: string[];
  serviceArea: string;
  serviceRadius: number;
  isLicensed: boolean;
  licenseNumber: string;
  isInsured: boolean;
};

type ProviderBusinessStepProps = {
  data: ProviderBusinessData;
  address: string;
  onBack: () => void;
  onChange: <K extends keyof ProviderBusinessData>(field: K, value: ProviderBusinessData[K]) => void;
  onContinue: () => void;
  submitting?: boolean;
  stepNumber?: number;
  stepCount?: number;
};

const serviceOptions = [
  "Plumbing",
  "Electrical",
  "HVAC",
  "Lawn care",
  "Cleaning",
  "Handyman",
  "Roofing",
  "Painting",
  "Pest control",
];

function buildAreaSuggestions(address: string) {
  const suggestions = new Set<string>();
  const parts = address.split(",").map((part) => part.trim()).filter(Boolean);
  const possibleLocality = parts[1] ?? parts[0] ?? "";
  const cityCandidates = ["Los Angeles", "San Jose", "San Francisco", "San Diego", "Sacramento", "Oakland", "Long Beach", "Anaheim"];
  const matchedCity = cityCandidates.find((city) => address.toLowerCase().includes(city.toLowerCase()));

  if (matchedCity) {
    suggestions.add(matchedCity);
    suggestions.add(`${matchedCity} Metro`);
  }
  if (possibleLocality && !/^\d/.test(possibleLocality)) {
    suggestions.add(possibleLocality);
    suggestions.add(`Greater ${possibleLocality}`);
  }
  suggestions.add("My local area");

  return Array.from(suggestions).slice(0, 4);
}

export function ProviderBusinessStep({
  data,
  address,
  onBack,
  onChange,
  onContinue,
  submitting = false,
  stepNumber = 4,
  stepCount = 4,
}: ProviderBusinessStepProps) {
  const areaSuggestions = buildAreaSuggestions(address);
  const isComplete =
    data.companyName.trim().length > 0 &&
    data.serviceArea.trim().length > 0 &&
    data.services.length > 0 &&
    (!data.isLicensed || data.licenseNumber.trim().length > 0);

  return (
    <section className="py-6">
      <header className="pb-6">
        <button
          aria-label="Back"
          className="mb-3 flex h-10 w-10 items-center justify-center rounded-full text-[var(--ink-700)] transition hover:bg-[var(--cream-100)]"
          type="button"
          onClick={onBack}
        >
          <svg aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="m15 18-6-6 6-6" />
          </svg>
        </button>
        <StepProgress current={stepNumber} total={stepCount} />
        <h1 className="mt-2 font-display text-[2.4rem] font-bold italic tracking-tight text-[var(--ink-900)]">
          Tell us about your business
        </h1>
        <p className="mt-2 text-[14px] leading-6 text-[var(--ink-500)]">
          Add your business name, the services you offer, and the major area you want Bundleen to prioritise.
        </p>
      </header>

      <div className="space-y-4">
        <Input
          label="Business name"
          placeholder="ProFix Plumbing"
          variant="warm"
          value={data.companyName}
          onChange={(event) => onChange("companyName", event.target.value)}
        />

        <div className="space-y-2">
          <label className="text-[12px] font-semibold uppercase tracking-[0.12em] text-[var(--ink-500)]">
            Services offered
          </label>
          <div className="flex flex-wrap gap-2">
            {serviceOptions.map((service) => {
              const selected = data.services.includes(service);
              return (
                <button
                  key={service}
                  type="button"
                  onClick={() =>
                    onChange(
                      "services",
                      selected
                        ? data.services.filter((value) => value !== service)
                        : [...data.services, service]
                    )
                  }
                  className="rounded-full px-3 py-2 text-[12px] font-semibold transition"
                  style={{
                    background: selected ? "var(--terracotta-600)" : "var(--cream-100)",
                    color: selected ? "white" : "var(--ink-800)",
                    border: selected ? "1px solid var(--terracotta-600)" : "1px solid var(--border-warm)",
                  }}
                >
                  {service}
                </button>
              );
            })}
          </div>
        </div>

        <Input
          label="Major service area"
          placeholder="Los Angeles"
          variant="warm"
          value={data.serviceArea}
          onChange={(event) => onChange("serviceArea", event.target.value)}
          hint="This is the main city or metro area you want local jobs from first."
        />

        <div className="flex flex-wrap gap-2">
          {areaSuggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => onChange("serviceArea", suggestion)}
              className="rounded-full border px-3 py-1.5 text-[12px] font-medium"
              style={{ borderColor: "var(--border-warm)", background: "var(--cream-50)", color: "var(--ink-700)" }}
            >
              {suggestion}
            </button>
          ))}
        </div>

        <div className="space-y-1.5">
          <label className="text-[12px] font-semibold uppercase tracking-[0.12em] text-[var(--ink-500)]">
            Service radius
          </label>
          <select
            value={String(data.serviceRadius)}
            onChange={(event) => onChange("serviceRadius", Number(event.target.value))}
            className="h-12 w-full rounded-2xl border bg-white px-3 text-[14px] text-[var(--ink-900)] outline-none"
            style={{ borderColor: "var(--border-warm)" }}
          >
            {[5, 10, 15, 25, 40].map((radius) => (
              <option key={radius} value={radius}>{radius} miles</option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label className="text-[12px] font-semibold uppercase tracking-[0.12em] text-[var(--ink-500)]">
            What facilities or services do you offer?
          </label>
          <textarea
            value={data.bio}
            onChange={(event) => onChange("bio", event.target.value)}
            placeholder="Residential plumbing repairs, emergency calls, water heater installs, leak inspections..."
            className="min-h-[110px] w-full rounded-[20px] border bg-white px-4 py-3 text-[14px] text-[var(--ink-900)] outline-none placeholder:text-[var(--ink-300)]"
            style={{ borderColor: "var(--border-warm)" }}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="rounded-[20px] border bg-[var(--cream-50)] px-4 py-3" style={{ borderColor: "var(--border-warm)" }}>
            <div className="flex items-center gap-3">
              <input
                checked={data.isLicensed}
                onChange={(event) => onChange("isLicensed", event.target.checked)}
                type="checkbox"
              />
              <div>
                <div className="text-[13px] font-semibold text-[var(--ink-900)]">Licensed business</div>
                <div className="text-[11px] text-[var(--ink-500)]">Show homeowners that your trade is credentialed.</div>
              </div>
            </div>
          </label>
          <label className="rounded-[20px] border bg-[var(--cream-50)] px-4 py-3" style={{ borderColor: "var(--border-warm)" }}>
            <div className="flex items-center gap-3">
              <input
                checked={data.isInsured}
                onChange={(event) => onChange("isInsured", event.target.checked)}
                type="checkbox"
              />
              <div>
                <div className="text-[13px] font-semibold text-[var(--ink-900)]">Insured business</div>
                <div className="text-[11px] text-[var(--ink-500)]">Surface jobs that prefer insured providers first.</div>
              </div>
            </div>
          </label>
        </div>

        {data.isLicensed ? (
          <Input
            label="License number"
            placeholder="LIC-20491"
            variant="warm"
            value={data.licenseNumber}
            onChange={(event) => onChange("licenseNumber", event.target.value)}
          />
        ) : null}
      </div>

      <div className="mt-6">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            {[1, 2, 3, 4].map((n) => (
              <span
                key={n}
                className={`rounded-full transition-all duration-300 ${n === 4 ? "h-2 w-6" : "h-2 w-2"}`}
                style={{ background: n === 4 ? "var(--terracotta-600)" : "rgba(232,98,63,0.40)" }}
              />
            ))}
          </div>
          <span className="text-[12px] text-[var(--ink-400)]">4 of 4</span>
        </div>
        <Button
          className="h-12 w-full rounded-full text-[14px] font-semibold"
          onClick={onContinue}
          variant="warm"
          disabled={!isComplete || submitting}
        >
          {submitting ? "Creating account…" : "Finish provider setup"}
        </Button>
      </div>
    </section>
  );
}
