"use client";

import { SignUp, useClerk, useUser } from "@clerk/nextjs";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

import { ProviderBusinessStep } from "@/components/onboarding/ProviderBusinessStep";
import { RoleStep } from "@/components/onboarding/RoleStep";
import { StepProgress } from "@/components/onboarding/StepProgress";
import {
  VerifyAreaStep,
  type VerifiedLocation,
} from "@/components/onboarding/VerifyAreaStep";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import {
  clearSignUpName,
  fullNameFromSignUp,
  getSignUpName,
  saveSignUpName,
  type SignUpName,
} from "@/lib/display-name";
import {
  clearOnboardingDraft,
  getOnboardingDraft,
  saveOnboardingDraft,
  type OnboardingDraft,
  type ProviderBusinessDraft,
} from "@/lib/onboarding-draft";
import { MAX_NAME_LENGTH, type PublicRole } from "@/lib/validation/auth";

type NameErrors = Partial<Record<keyof SignUpName, string>>;
type SignUpStage = "session" | "name" | "role" | "location" | "provider" | "account";

const EMPTY_BUSINESS: ProviderBusinessDraft = {
  companyName: "",
  bio: "",
  services: [],
  serviceArea: "",
  licenseNumber: "",
  insuranceProvider: "",
};

function AccountStepLoading() {
  return (
    <section
      aria-label="Loading secure account form"
      aria-live="polite"
      className="w-full rounded-2xl border border-[#e4e7ec] bg-white px-7 py-8 shadow-[0_24px_60px_rgba(31,26,20,0.10)] sm:px-9"
    >
      <div className="mx-auto h-6 w-44 animate-pulse rounded-full bg-[#e7eeec]" />
      <div className="mx-auto mt-3 h-4 w-60 max-w-full animate-pulse rounded-full bg-[#eef2f1]" />
      <div className="mt-8 space-y-4">
        <div className="h-11 animate-pulse rounded-xl bg-[#eef2f1]" />
        <div className="h-11 animate-pulse rounded-xl bg-[#eef2f1]" />
        <div className="h-11 animate-pulse rounded-xl bg-[#d9efeb]" />
      </div>
      <p className="mt-6 text-center text-xs font-medium text-[#64748b]">
        Loading secure account setup…
      </p>
    </section>
  );
}

export function NamedSignUp({ alreadyVerified = false }: { alreadyVerified?: boolean }) {
  const router = useRouter();
  const { signOut } = useClerk();
  const { user } = useUser();
  const [stage, setStage] = useState<SignUpStage>("name");
  const [name, setName] = useState<SignUpName | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [errors, setErrors] = useState<NameErrors>({});
  const [role, setRole] = useState<PublicRole>("homeowner");
  const [address, setAddress] = useState("");
  const [neighborhood, setNeighborhood] = useState("");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [providerBusiness, setProviderBusiness] =
    useState<ProviderBusinessDraft>(EMPTY_BUSINESS);
  const [hydrated, setHydrated] = useState(false);
  const [sessionAccepted, setSessionAccepted] = useState(false);
  const [switchingAccount, setSwitchingAccount] = useState(false);

  const stepCount = role === "provider" ? 5 : 4;

  useEffect(() => {
    router.prefetch("/get-started/profile");
    const draft = getOnboardingDraft();
    const savedName = draft?.name ?? getSignUpName();
    if (savedName) {
      setName(savedName);
      setFirstName(savedName.firstName);
      setLastName(savedName.lastName);
    }
    if (draft) {
      setRole(draft.role);
      setAddress(draft.address);
      setNeighborhood(draft.neighborhood);
      setCoords({ lat: draft.latitude, lng: draft.longitude });
      setProviderBusiness(draft.providerBusiness);
      setStage(alreadyVerified ? "session" : "account");
    } else if (alreadyVerified) {
      setStage("session");
    }
    setHydrated(true);
  }, [alreadyVerified, router]);

  const continueFromName = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const nextName = { firstName: firstName.trim(), lastName: lastName.trim() };
    const nextErrors: NameErrors = {};
    if (!nextName.firstName) nextErrors.firstName = "Enter your first name.";
    if (!nextName.lastName) nextErrors.lastName = "Enter your surname.";
    if (fullNameFromSignUp(nextName).length > MAX_NAME_LENGTH) {
      nextErrors.lastName = `Your full name must be ${MAX_NAME_LENGTH} characters or fewer.`;
    }

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    saveSignUpName(nextName);
    setName(nextName);
    setStage("role");
  };

  const handleBusinessChange = <K extends keyof ProviderBusinessDraft>(
    field: K,
    value: ProviderBusinessDraft[K],
  ) => setProviderBusiness((current) => ({ ...current, [field]: value }));

  const continueFromLocation = (location: VerifiedLocation) => {
    setAddress(location.address);
    setNeighborhood(location.neighborhood);
    setCoords({ lat: location.latitude, lng: location.longitude });
    if (role === "provider") setStage("provider");
    else continueToAccount(location);
  };

  const continueToAccount = (location?: VerifiedLocation) => {
    if (!name) return;
    const finalCoords = location
      ? { lat: location.latitude, lng: location.longitude }
      : coords;
    const finalAddress = location?.address ?? address;
    const finalNeighborhood = location?.neighborhood ?? neighborhood;
    if (!finalCoords || !finalAddress.trim()) return;

    const draft: OnboardingDraft = {
      name,
      role,
      address: finalAddress,
      neighborhood: finalNeighborhood,
      latitude: finalCoords.lat,
      longitude: finalCoords.lng,
      providerBusiness,
      completionAuthorized: !alreadyVerified || sessionAccepted,
    };
    saveOnboardingDraft(draft);
    setStage("account");
    if (alreadyVerified) router.replace("/get-started/profile");
  };

  if (!hydrated) {
    return (
      <div className="auth-step-enter w-full max-w-md">
        <AccountStepLoading />
      </div>
    );
  }

  if (stage === "session") {
    const accountName = user?.fullName?.trim() || "this Clerk account";
    const accountEmail = user?.primaryEmailAddress?.emailAddress;
    const draft = getOnboardingDraft();

    return (
      <section className="auth-step-enter relative w-full max-w-md rounded-2xl border border-[#d8e7e3] bg-white px-7 py-8 text-center shadow-[0_24px_60px_rgba(31,26,20,0.10)] sm:px-9">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#eaf8f5] text-xl font-bold text-[#0f8f83]">
          ✓
        </span>
        <p className="mt-5 text-[11px] font-bold uppercase tracking-[0.14em] text-[#0f8f83]">
          Existing session detected
        </p>
        <h1 className="mt-2 text-2xl font-bold tracking-[-0.03em] text-[#1f2937]">
          You’re already signed in
        </h1>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-[#667085]">
          Continue with <strong className="text-[#1f2937]">{accountName}</strong>
          {accountEmail ? <> ({accountEmail})</> : null}. Clerk has already verified this account,
          so you do not need another email code.
        </p>

        <div className="mt-7 space-y-3">
          <Button
            className="h-11 w-full rounded-xl text-sm"
            onClick={() => {
              setSessionAccepted(true);
              if (draft) {
                saveOnboardingDraft({ ...draft, completionAuthorized: true });
                router.replace("/get-started/profile");
              } else {
                setStage("name");
              }
            }}
            variant="warm"
          >
            Continue with this account
          </Button>
          <Button
            className="h-11 w-full rounded-xl text-sm"
            disabled={switchingAccount}
            onClick={async () => {
              setSwitchingAccount(true);
              clearOnboardingDraft();
              clearSignUpName();
              await signOut({ redirectUrl: "/get-started" });
            }}
            variant="secondary"
          >
            {switchingAccount ? "Signing out…" : "Use another account"}
          </Button>
        </div>

        <p className="mt-5 text-xs leading-5 text-[#98a2b3]">
          To test email verification, choose another account and use an email that is not already
          registered in Clerk.
        </p>
      </section>
    );
  }

  if (stage === "name" || !name) {
    return (
      <section className="auth-step-enter relative w-full max-w-md rounded-2xl border border-[#e4e7ec] bg-white px-7 py-8 shadow-[0_24px_60px_rgba(31,26,20,0.10)] sm:px-9">
        <StepProgress current={1} total={4} />
        <div className="mt-5 text-center">
          <h1 className="text-2xl font-bold tracking-[-0.03em] text-[#1f2937]">Create your account</h1>
          <p className="mt-2 text-sm text-[#6b7280]">Start with the name your neighbors will see.</p>
        </div>

        <form className="mt-7 space-y-4" onSubmit={continueFromName} noValidate>
          <Input
            autoComplete="given-name"
            autoFocus
            error={errors.firstName}
            id="first-name"
            label="First name"
            maxLength={MAX_NAME_LENGTH}
            onChange={(event) => {
              setFirstName(event.target.value);
              if (errors.firstName) setErrors((current) => ({ ...current, firstName: undefined }));
            }}
            placeholder="Jane"
            required
            value={firstName}
            variant="warm"
          />
          <Input
            autoComplete="family-name"
            error={errors.lastName}
            id="last-name"
            label="Surname"
            maxLength={MAX_NAME_LENGTH}
            onChange={(event) => {
              setLastName(event.target.value);
              if (errors.lastName) setErrors((current) => ({ ...current, lastName: undefined }));
            }}
            placeholder="Smith"
            required
            value={lastName}
            variant="warm"
          />
          <Button className="mt-2 h-11 w-full rounded-xl text-sm" type="submit" variant="warm">
            Continue to role
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-[#6b7280]">
          Already have an account?{" "}
          <Link className="font-semibold text-[#0f8f83] hover:underline" href="/sign-in">
            Sign in
          </Link>
        </p>
      </section>
    );
  }

  if (stage === "role") {
    return (
      <div className="auth-step-enter w-full max-w-[750px] rounded-[18px] border border-[#dfe3e7] bg-white px-7 shadow-[0_12px_38px_rgba(16,24,40,.07)] sm:px-9 lg:px-10">
        <RoleStep
          role={role}
          onBack={() => setStage("name")}
          onContinue={() => setStage("location")}
          onRoleChange={setRole}
          stepNumber={1}
          stepCount={2}
        />
      </div>
    );
  }

  if (stage === "location") {
    return (
      <div className="auth-step-enter w-full max-w-[790px] rounded-[18px] border border-[#dfe3e7] bg-white px-7 shadow-[0_12px_38px_rgba(16,24,40,.07)] sm:px-9 lg:px-10">
        <VerifyAreaStep
          address={address}
          role={role}
          onAddressChange={setAddress}
          onBack={() => setStage("role")}
          onConfirm={continueFromLocation}
          onCoordsDetected={(lat, lng) =>
            setCoords(lat === null || lng === null ? null : { lat, lng })
          }
          onNeighborhoodDetected={setNeighborhood}
          stepNumber={2}
          stepCount={2}
          confirmLabel={role === "provider" ? "Continue to business details" : "Continue to email verification"}
        />
      </div>
    );
  }

  if (stage === "provider") {
    return (
      <div className="auth-step-enter w-full max-w-xl rounded-[22px] border border-[#e4e7ec] bg-white px-7 sm:px-9">
        <ProviderBusinessStep
          data={providerBusiness}
          address={address}
          onBack={() => setStage("location")}
          onChange={handleBusinessChange}
          onContinue={() => continueToAccount()}
          stepNumber={4}
          stepCount={stepCount}
          confirmLabel="Continue to email verification"
        />
      </div>
    );
  }

  if (alreadyVerified) {
    return (
      <div className="auth-step-enter w-full max-w-md">
        <AccountStepLoading />
      </div>
    );
  }

  return (
    <div className="auth-step-enter relative w-full max-w-md">
      <div className="mb-3 rounded-xl border border-[#d8e7e3] bg-white/90 px-4 py-3 text-sm text-[#4b5563]">
        <div className="flex items-center justify-between gap-3">
          <span className="min-w-0">
            <span className="block text-[10px] font-bold uppercase tracking-[0.12em] text-[#0f8f83]">
              Final step · Account and email verification
            </span>
            <span className="block truncate">
              Signing up as <strong className="text-[#1f2937]">{fullNameFromSignUp(name)}</strong>
            </span>
          </span>
          <button
            className="shrink-0 font-semibold text-[#0f8f83] hover:underline"
            onClick={() => setStage("role")}
            type="button"
          >
            Edit details
          </button>
        </div>
        <p className="mt-2 border-t border-[#e7eeec] pt-2 text-xs text-[#64748b]">
          Your role and location are ready. Verify your email to securely save them.
        </p>
      </div>
      <SignUp
        path="/get-started"
        routing="path"
        signInUrl="/sign-in"
        forceRedirectUrl="/get-started/profile"
        fallbackRedirectUrl="/get-started/profile"
        fallback={<AccountStepLoading />}
        initialValues={{ firstName: name.firstName, lastName: name.lastName }}
        appearance={{
          variables: {
            colorPrimary: "#0f8f83",
            colorForeground: "#1f2937",
            colorBackground: "#ffffff",
            borderRadius: "1rem",
          },
          elements: {
            rootBox: "relative w-full",
            cardBox: "w-full shadow-none",
            card: "border border-[#e4e7ec] shadow-[0_24px_60px_rgba(31,26,20,0.10)]",
          },
        }}
      />
    </div>
  );
}
