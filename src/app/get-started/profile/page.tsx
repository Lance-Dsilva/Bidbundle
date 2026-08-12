"use client";

import { RedirectToSignIn, useUser } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { AuthShowcase } from "@/components/auth/AuthShowcase";
import { ProviderBusinessStep } from "@/components/onboarding/ProviderBusinessStep";
import { RoleStep } from "@/components/onboarding/RoleStep";
import {
  VerifyAreaStep,
  type VerifiedLocation,
} from "@/components/onboarding/VerifyAreaStep";
import { clearSignUpName, fullNameFromSignUp, getSignUpName } from "@/lib/display-name";
import type { PublicRole } from "@/lib/validation/auth";
import { saveRole } from "@/utils/onboardingState";

type OnboardingStep = 1 | 2 | 3;

type ProviderBusinessData = {
  companyName: string;
  bio: string;
  services: string[];
  serviceArea: string;
  licenseNumber: string;
  insuranceProvider: string;
};

type ProfileResponse = {
  profileReady?: boolean;
  role?: PublicRole;
  redirectTo?: string;
  error?: string;
  fields?: Record<string, string>;
};

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
  const [providerBusiness, setProviderBusiness] = useState<ProviderBusinessData>({
    companyName: "",
    bio: "",
    services: [],
    serviceArea: "",
    licenseNumber: "",
    insuranceProvider: "",
  });

  const stepCount = role === "provider" ? 3 : 2;

  const handleProviderBusinessChange = <K extends keyof ProviderBusinessData>(
    field: K,
    value: ProviderBusinessData[K],
  ) => {
    setProviderBusiness((current) => ({ ...current, [field]: value }));
  };

  const finishProfile = async (verifiedLocation?: VerifiedLocation) => {
    if (!user) return;

    setSubmitting(true);
    setApiError(null);

    try {
      const signUpName = getSignUpName();
      const fullName = signUpName ? fullNameFromSignUp(signUpName) : user.fullName ?? undefined;

      // `initialValues` gives Clerk these fields during sign-up. Updating here
      // also covers social sign-up providers that return without applying them.
      if (signUpName && user.fullName !== fullName) {
        await user.update({ firstName: signUpName.firstName, lastName: signUpName.lastName });
      }

      const response = await fetch("/api/auth/profile", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName,
          phone: user.primaryPhoneNumber?.phoneNumber ?? undefined,
          role,
          address: verifiedLocation?.address ?? address,
          neighborhood:
            verifiedLocation?.neighborhood || neighborhood || providerBusiness.serviceArea || null,
          latitude: verifiedLocation?.latitude ?? coords?.lat ?? null,
          longitude: verifiedLocation?.longitude ?? coords?.lng ?? null,
          // Claims only. The licensed/insured checkboxes this form used to
          // collect are gone: a provider does not get to mark themselves
          // verified, so there is nothing to send.
          providerBusiness:
            role === "provider"
              ? {
                  companyName: providerBusiness.companyName,
                  bio: providerBusiness.bio,
                  trades: providerBusiness.services,
                  licenseNumber: providerBusiness.licenseNumber,
                  insuranceProvider: providerBusiness.insuranceProvider,
                }
              : undefined,
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
      router.replace(result.redirectTo);
      router.refresh();
    } catch {
      setApiError("We could not finish your profile. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!isLoaded) return null;
  if (!user) return <RedirectToSignIn />;

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
                if (role === "provider") setStep(3);
                else void finishProfile(location);
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
              onContinue={() => void finishProfile()}
              submitting={submitting}
              stepNumber={3}
              stepCount={stepCount}
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
