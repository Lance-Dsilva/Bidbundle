"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { AuthShowcase } from "@/components/auth/AuthShowcase";
import { ProviderBusinessStep } from "@/components/onboarding/ProviderBusinessStep";
import { RoleStep } from "@/components/onboarding/RoleStep";
import { SignupStep } from "@/components/onboarding/SignupStep";
import { VerifyAreaStep } from "@/components/onboarding/VerifyAreaStep";
import { apiFetch } from "@/lib/api";
import { register, setToken } from "@/lib/auth";
import { saveRole, type UserRole } from "@/utils/onboardingState";

type OnboardingStep = 1 | 2 | 3 | 4;

type SignupData = {
  fullName: string;
  email: string;
  password: string;
  phone: string;
};

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

const destinationByRole: Record<UserRole, string> = {
  homeowner: "/app/homeowner/dashboard",
  provider: "/app/provider/dashboard",
  admin: "/app/admin/dashboard",
};

const testimonials = [
  {
    quote: "We saved $420 on landscaping by joining our block's group bid. Took two minutes to set up.",
    name: "Maria",
    location: "Austin, TX",
    initials: "MC",
  },
  {
    quote: "As a plumber, BidBundle sends me bulk jobs I would never have found on my own. Revenue is up 40%.",
    name: "James Kowalski",
    location: "Service Provider",
    initials: "JK",
  },
  {
    quote: "Our HOA saved the community over $8,000 last year. The analytics dashboard makes it easy to present to the board.",
    name: "Aisha Patel",
    location: "HOA Administrator",
    initials: "AP",
  },
];

export default function GetStartedPage() {
  const router = useRouter();
  const [step, setStep] = useState<OnboardingStep>(1);
  const [signup, setSignup] = useState<SignupData>({
    fullName: "",
    email: "",
    password: "",
    phone: "",
  });
  const [role, setRole] = useState<UserRole>("homeowner");
  const [address, setAddress] = useState("123 Maple St, Oakwood Heights");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [providerBusiness, setProviderBusiness] = useState<ProviderBusinessData>({
    companyName: "",
    bio: "",
    services: [],
    serviceArea: "",
    serviceRadius: 10,
    isLicensed: false,
    licenseNumber: "",
    isInsured: false,
  });
  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const testimonial = testimonials[0];
  const stepCount = role === "provider" ? 4 : 3;

  const handleSignupChange = (field: keyof SignupData, value: string) => {
    setSignup((current) => ({ ...current, [field]: value }));
  };

  const handleProviderBusinessChange = <K extends keyof ProviderBusinessData>(
    field: K,
    value: ProviderBusinessData[K]
  ) => {
    setProviderBusiness((current) => ({ ...current, [field]: value }));
  };

  const handleFinish = async () => {
    setSubmitting(true);
    setApiError(null);
    try {
      const tokens = await register({
        email: signup.email,
        password: signup.password,
        full_name: signup.fullName,
        phone: signup.phone || undefined,
        role,
        latitude: coords?.lat,
        longitude: coords?.lng,
      });
      setToken(tokens.access_token);

      if (role === "provider") {
        await apiFetch("/provider/me", {
          method: "PATCH",
          body: JSON.stringify({
            company_name: providerBusiness.companyName,
            bio: providerBusiness.bio,
            trades: providerBusiness.services.join(", "),
            neighborhood: providerBusiness.serviceArea,
            address,
            service_radius_mi: providerBusiness.serviceRadius,
            is_licensed: providerBusiness.isLicensed,
            is_insured: providerBusiness.isInsured,
            license_number: providerBusiness.isLicensed ? providerBusiness.licenseNumber : null,
          }),
          token: tokens.access_token,
        });
      }

      saveRole(role);
      router.push(destinationByRole[role]);
    } catch (e: unknown) {
      setApiError(e instanceof Error ? e.message : "Registration failed");
      setSubmitting(false);
    }
  };

  return (
    <div className="signup-layout">
      <AuthShowcase testimonial={testimonial} />

      {/* ── Right panel: form ── */}
      <div
        className="relative flex flex-1 flex-col items-center justify-center overflow-y-auto px-5 py-8"
        style={{ background: "linear-gradient(180deg, #FAF6F0 0%, #F1ECE2 100%)" }}
      >
        <div
          className="pointer-events-none absolute right-[-8%] top-[12%] h-[260px] w-[260px] rounded-full opacity-70"
          style={{ background: "radial-gradient(circle, rgba(224,135,88,0.16) 0%, transparent 68%)" }}
        />
        <div
          className="pointer-events-none absolute bottom-[10%] left-[-6%] h-[220px] w-[220px] rounded-full opacity-60"
          style={{ background: "radial-gradient(circle, rgba(122,154,126,0.14) 0%, transparent 68%)" }}
        />
        <div
          className="relative w-full max-w-xl rounded-[22px] border p-8 sm:p-10"
          style={{
            background: "linear-gradient(180deg, #FFFFFF, #F6F8FA)",
            borderColor: "#E4E7EC",
            boxShadow: "0 20px 60px rgba(16,42,67,.08)",
          }}
        >
          {step === 1 ? (
            <SignupStep
              signup={signup}
              onChange={handleSignupChange}
              onContinue={() => setStep(2)}
              stepCount={stepCount}
            />
          ) : null}

          {step === 2 ? (
            <RoleStep
              role={role}
              onBack={() => setStep(1)}
              onContinue={() => setStep(3)}
              onRoleChange={setRole}
              stepCount={stepCount}
            />
          ) : null}

          {step === 3 ? (
            <>
              <VerifyAreaStep
                address={address}
                role={role}
                onAddressChange={setAddress}
                onBack={() => setStep(2)}
                onConfirm={() => {
                  if (role === "provider") {
                    setStep(4);
                    return;
                  }
                  void handleFinish();
                }}
                onCoordsDetected={(lat, lng) => setCoords({ lat, lng })}
                submitting={submitting && role !== "provider"}
                stepNumber={3}
                stepCount={stepCount}
                confirmLabel={role === "provider" ? "Continue" : "Confirm my area"}
              />
              {apiError ? (
                <p style={{ color: "var(--danger-600)", fontSize: 13, marginTop: 8, textAlign: "center" }}>
                  {apiError}
                </p>
              ) : null}
            </>
          ) : null}

          {step === 4 && role === "provider" ? (
            <>
              <ProviderBusinessStep
                data={providerBusiness}
                address={address}
                onBack={() => setStep(3)}
                onChange={handleProviderBusinessChange}
                onContinue={() => void handleFinish()}
                submitting={submitting}
              />
              {apiError ? (
                <p style={{ color: "var(--danger-600)", fontSize: 13, marginTop: 8, textAlign: "center" }}>
                  {apiError}
                </p>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
