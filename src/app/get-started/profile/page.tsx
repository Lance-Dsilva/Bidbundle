"use client";

import { RedirectToSignIn, useUser } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { AuthShowcase } from "@/components/auth/AuthShowcase";
import { BundleenAuthLoader } from "@/components/auth/BundleenAuthLoader";
import { ProviderBusinessStep } from "@/components/onboarding/ProviderBusinessStep";
import { ProviderCoverageStep } from "@/components/onboarding/ProviderCoverageStep";
import { RoleStep } from "@/components/onboarding/RoleStep";
import type { ServiceAreaDraft } from "@/components/provider/ProviderServiceAreaEditor";
import {
  VerifyAreaStep,
  type VerifiedLocation,
} from "@/components/onboarding/VerifyAreaStep";
import { Button } from "@/components/ui/Button";
import { clearSignUpName, fullNameFromSignUp, getSignUpName } from "@/lib/display-name";
import {
  clearOnboardingDraft,
  getOnboardingDraft,
  type OnboardingDraft,
  type ProviderBusinessDraft,
} from "@/lib/onboarding-draft";
import { SERVICE_RADIUS_DEFAULT_MILES } from "@/lib/provider-coverage";
import type { PublicRole } from "@/lib/validation/auth";
import { saveRole } from "@/utils/onboardingState";

type OnboardingStep = 1 | 2 | 3 | 4;

type ProfileResponse = {
  profileReady?: boolean;
  role?: PublicRole;
  redirectTo?: string;
  error?: string;
  fields?: Record<string, string>;
};

type ProfileCompletion = {
  draft?: OnboardingDraft;
  location?: VerifiedLocation;
};

function OnboardingHandoff({
  error,
  onEdit,
  onRetry,
  working = true,
}: {
  error?: string | null;
  onEdit?: () => void;
  onRetry?: () => void;
  working?: boolean;
}) {
  return (
    <div className="signup-layout">
      <AuthShowcase
        testimonial={{
          quote:
            "Bundleen brings homeowners and local providers together around better neighborhood pricing.",
          name: "Bundleen",
          location: "Community-powered services",
          initials: "B",
        }}
      />
      <main
        className="relative flex flex-1 flex-col items-center justify-center overflow-y-auto px-5 py-8"
        style={{ background: "linear-gradient(180deg, #FAF6F0 0%, #F1ECE2 100%)" }}
      >
        {working ? (
          // Same branded house as every other Clerk handoff. `timeoutMs={0}`
          // because this wait is our own API call, not Clerk initialization —
          // its failure arrives as `error` below rather than as a timeout.
          <BundleenAuthLoader
            context="profile"
            timeoutMs={0}
            className="auth-step-enter w-full max-w-xl rounded-[22px] border border-[#E4E7EC] bg-white p-8 text-center shadow-[0_20px_60px_rgba(16,42,67,.08)] sm:p-10"
          />
        ) : (
          <div
            role="alert"
            className="auth-step-enter w-full max-w-xl rounded-[22px] border bg-white p-8 text-center sm:p-10"
            style={{ borderColor: "#E4E7EC", boxShadow: "0 20px 60px rgba(16,42,67,.08)" }}
          >
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[var(--sage-50)] text-xl text-[var(--sage-700)]">
              !
            </span>
            <h1 className="mt-5 text-2xl font-bold tracking-tight text-[var(--ink-900)]">
              Your details are still safe
            </h1>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[var(--ink-500)]">
              {error ?? "We could not finish your profile."}
            </p>
            {onRetry ? (
              <div className="mt-6 flex flex-wrap justify-center gap-3">
                <Button className="h-11 rounded-full px-8 text-sm" onClick={onRetry} variant="warm">
                  Try again
                </Button>
                {onEdit ? (
                  <Button
                    className="h-11 rounded-full px-8 text-sm"
                    onClick={onEdit}
                    variant="secondary"
                  >
                    Review details
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        )}
      </main>
    </div>
  );
}

export default function CompleteProfilePage() {
  const router = useRouter();
  const { isLoaded, user } = useUser();
  const [step, setStep] = useState<OnboardingStep>(1);
  const [role, setRole] = useState<PublicRole>("homeowner");
  // Empty until geolocation or the user fills it in. A pre-filled sample
  // address is a claim about where someone lives that nobody made.
  const [address, setAddress] = useState("");
  const [neighborhood, setNeighborhood] = useState("");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [providerBusiness, setProviderBusiness] = useState<ProviderBusinessDraft>({
    companyName: "",
    bio: "",
    services: [],
    serviceArea: "",
    licenseNumber: "",
    insuranceProvider: "",
  });
  const [providerCoverage, setProviderCoverage] = useState<ServiceAreaDraft | null>(null);
  const [draftChecked, setDraftChecked] = useState(false);
  const [pendingDraft, setPendingDraft] = useState<OnboardingDraft | null>(null);
  const automaticCompletionStarted = useRef(false);

  const stepCount = role === "provider" ? 4 : 2;

  const handleProviderBusinessChange = <K extends keyof ProviderBusinessDraft>(
    field: K,
    value: ProviderBusinessDraft[K],
  ) => {
    setProviderBusiness((current) => ({ ...current, [field]: value }));
  };

  const finishProfile = async ({ draft, location }: ProfileCompletion = {}) => {
    if (!user) return;

    setSubmitting(true);
    setApiError(null);

    try {
      const signUpName = draft?.name ?? getSignUpName();
      const fullName = signUpName ? fullNameFromSignUp(signUpName) : user.fullName ?? undefined;
      const completionRole = draft?.role ?? role;
      const completionAddress = draft?.address ?? location?.address ?? address;
      const completionNeighborhood =
        draft?.neighborhood ?? location?.neighborhood ?? neighborhood;
      const completionLatitude = draft?.latitude ?? location?.latitude ?? coords?.lat ?? null;
      const completionLongitude = draft?.longitude ?? location?.longitude ?? coords?.lng ?? null;
      const completionBusiness = draft?.providerBusiness ?? providerBusiness;
      const completionCoverage = draft?.providerCoverage ?? providerCoverage;

      // `initialValues` normally gives Clerk these fields during sign-up. Some
      // Clerk configurations do not allow the browser SDK to update names,
      // though, and that optional synchronization must never prevent the
      // Bundleen profile from being created. The API below independently saves
      // `fullName` to our database.
      if (signUpName && user.fullName !== fullName) {
        try {
          await user.update({ firstName: signUpName.firstName, lastName: signUpName.lastName });
        } catch {
          // Continue with the Bundleen profile save. Clerk can be reconciled
          // later without losing the address and onboarding progress.
        }
      }

      const response = await fetch("/api/auth/profile", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName,
          phone: user.primaryPhoneNumber?.phoneNumber ?? undefined,
          role: completionRole,
          address: completionAddress,
          neighborhood:
            completionNeighborhood || completionBusiness.serviceArea || null,
          latitude: completionLatitude,
          longitude: completionLongitude,
          // Claims only. The licensed/insured checkboxes this form used to
          // collect are gone: a provider does not get to mark themselves
          // verified, so there is nothing to send.
          providerBusiness:
            completionRole === "provider"
              ? {
                  companyName: completionBusiness.companyName,
                  bio: completionBusiness.bio,
                  trades: completionBusiness.services,
                  licenseNumber: completionBusiness.licenseNumber,
                  insuranceProvider: completionBusiness.insuranceProvider,
                }
              : undefined,
          // Saved as the provider's primary active service area. Revalidated
          // server-side; nothing here decides what the circle actually covers.
          providerCoverage:
            completionRole === "provider" ? (completionCoverage ?? undefined) : undefined,
        }),
      });
      const result = (await response.json().catch(() => null)) as ProfileResponse | null;

      if (!response.ok || !result?.profileReady || !result.role || !result.redirectTo) {
        const firstFieldError = result?.fields ? Object.values(result.fields)[0] : undefined;
        setApiError(firstFieldError ?? result?.error ?? "We could not finish your profile.");
        return;
      }

      // Everything the form collected is now in Neon; the sessionStorage draft
      // that used to hold it has no reason to exist.
      saveRole(result.role);
      clearSignUpName();
      clearOnboardingDraft();
      router.replace(result.redirectTo);
      router.refresh();
    } catch {
      setApiError("We could not reach the profile service. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    if (!isLoaded || !user || automaticCompletionStarted.current) return;

    const draft = getOnboardingDraft();
    setDraftChecked(true);
    if (!draft) {
      // A verified Clerk account whose Bundleen profile is incomplete resumes
      // at the first visible signup step. `/get-started` detects the existing
      // session and skips only Clerk's already-completed verification screen.
      router.replace("/get-started");
      return;
    }

    if (draft.completionAuthorized !== true) {
      // Drafts created before the account-confirmation step was introduced
      // must not silently submit under whatever Clerk session is in the
      // browser. `/get-started` now asks the user to confirm or switch it.
      router.replace("/get-started");
      return;
    }

    automaticCompletionStarted.current = true;
    setPendingDraft(draft);
    void finishProfile({ draft });
    // This handoff runs once for the newly verified Clerk session. The complete
    // draft is passed directly, so it does not depend on changing form state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, user]);

  if (!isLoaded) return <OnboardingHandoff />;
  if (!user) return <RedirectToSignIn />;
  if (!draftChecked) return <OnboardingHandoff />;
  if (!pendingDraft) return <OnboardingHandoff />;
  if (pendingDraft) {
    return (
      <OnboardingHandoff
        error={apiError}
        working={submitting}
        onRetry={() => void finishProfile({ draft: pendingDraft })}
        onEdit={() => {
          clearOnboardingDraft();
          setPendingDraft(null);
          router.replace("/get-started");
        }}
      />
    );
  }

  return (
    <div className="signup-layout">
      <AuthShowcase
        testimonial={{
          quote:
            "Bundleen brings homeowners and local providers together around better neighborhood pricing.",
          name: "Bundleen",
          location: "Community-powered services",
          initials: "B",
        }}
      />

      <main
        className="relative flex flex-1 flex-col items-center justify-center overflow-y-auto px-5 py-8"
        style={{ background: "linear-gradient(180deg, #FAF6F0 0%, #F1ECE2 100%)" }}
      >
        <div
          className="relative w-full max-w-xl rounded-[22px] border p-8 sm:p-10"
          style={{
            background: "linear-gradient(180deg, #FFFFFF, #F6F8FA)",
            borderColor: "#E4E7EC",
            boxShadow: "0 20px 60px rgba(16,42,67,.08)",
          }}
        >
          {step === 1 ? (
            <RoleStep
              role={role}
              onBack={() => router.push("/")}
              onContinue={() => setStep(2)}
              onRoleChange={setRole}
              stepCount={stepCount}
              stepNumber={1}
            />
          ) : null}

          {step === 2 ? (
            <VerifyAreaStep
              address={address}
              role={role}
              onAddressChange={setAddress}
              onBack={() => setStep(1)}
              onConfirm={(location) => {
                setAddress(location.address);
                setNeighborhood(location.neighborhood);
                setCoords({ lat: location.latitude, lng: location.longitude });
                if (role === "provider") {
                  setProviderCoverage(
                    (current) =>
                      current ?? {
                        label: location.neighborhood || "My service area",
                        centerLatitude: location.latitude,
                        centerLongitude: location.longitude,
                        radiusMiles: SERVICE_RADIUS_DEFAULT_MILES,
                        formattedAddress: location.address,
                        locality: location.neighborhood || null,
                        region: null,
                        postalCode: null,
                        countryCode: null,
                      },
                  );
                  setStep(3);
                } else void finishProfile({ location });
              }}
              onCoordsDetected={(lat, lng) =>
                setCoords(lat === null || lng === null ? null : { lat, lng })
              }
              onNeighborhoodDetected={setNeighborhood}
              submitting={submitting && role === "homeowner"}
              stepNumber={2}
              stepCount={stepCount}
              confirmLabel={role === "provider" ? "Continue" : "Confirm my area"}
            />
          ) : null}

          {step === 3 && role === "provider" ? (
            <ProviderBusinessStep
              data={providerBusiness}
              address={address}
              onBack={() => setStep(2)}
              onChange={handleProviderBusinessChange}
              onContinue={() => setStep(4)}
              submitting={submitting}
              stepNumber={3}
              stepCount={stepCount}
              confirmLabel="Continue to your service area"
            />
          ) : null}

          {step === 4 && role === "provider" ? (
            <ProviderCoverageStep
              value={providerCoverage}
              onChange={setProviderCoverage}
              onBack={() => setStep(3)}
              onContinue={() => void finishProfile()}
              submitting={submitting}
              stepNumber={4}
              stepCount={stepCount}
              confirmLabel="Finish provider setup"
            />
          ) : null}

          {apiError ? (
            <p
              aria-live="polite"
              role="alert"
              className="mt-4 text-center text-sm"
              style={{ color: "var(--danger-600)" }}
            >
              {apiError}
            </p>
          ) : null}
        </div>
      </main>
    </div>
  );
}
